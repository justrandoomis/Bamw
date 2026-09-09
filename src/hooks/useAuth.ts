import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { clearCatalogSnapshot } from "@/lib/catalog-cache";
import type { PublicUser } from "@/lib/types";

export function useAuth() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.me();
      } catch {
        // Network/timeout failure means "no usable session" — never hang the UI.
        return { user: null } as { user: PublicUser | null };
      }
    },
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["me"] }),
      queryClient.invalidateQueries({ queryKey: ["wallet"] }),
      queryClient.invalidateQueries({ queryKey: ["banana-balance"] }),
      queryClient.invalidateQueries({ queryKey: ["orders"] }),
      queryClient.invalidateQueries({ queryKey: ["threads"] }),
      queryClient.invalidateQueries({ queryKey: ["reviews"] }),
    ]);

  /** Write the authoritative session payload straight into the cache. */
  const setSession = (data: { user: PublicUser | null; legacyClaimed?: boolean } | undefined) => {
    if (data && "user" in data) {
      queryClient.setQueryData(["me"], { user: data.user ?? null });
      if (data.legacyClaimed) {
        void invalidate();
        toast.success("تم العثور على بيانات حسابك السابق واستعادتها بنجاح 🍌", {
          duration: 6000,
        });
      }
    } else {
      void invalidate();
    }
  };

  const login = useMutation({
    mutationFn: ({ identifier, password }: { identifier: string; password: string }) =>
      api.login(identifier, password),
    onSuccess: (data) => setSession(data as { user: PublicUser | null }),
  });

  const sendOtp = useMutation({
    mutationFn: ({
      phone,
      purpose,
      channel = "telegram",
    }: {
      phone: string;
      purpose: "signup" | "reset" | "verify";
      channel?: "whatsapp" | "telegram";
    }) => api.sendOtp(phone, purpose, channel),
  });

  const verifyOtp = useMutation({
    mutationFn: (input: Parameters<typeof api.verifyOtp>[0]) => api.verifyOtp(input),
    onSuccess: (data: any) => {
      if (data?.user) setSession({ user: data.user, legacyClaimed: Boolean(data.legacyClaimed) });
    },
  });

  const register = useMutation({
    mutationFn: (input: { name: string; email: string; password: string; phone?: string }) =>
      api.register(input),
    onSuccess: (data) => setSession(data as { user: PublicUser | null }),
  });

  const logout = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      queryClient.setQueryData(["me"], { user: null });
    },
    /*
      The catalogue a session was shown does not belong to the next one.

      `/api/data` answers admins and shoppers at the same URL, and the admin
      answer carries hidden products and raw variant rows with their costs.
      Two copies of it outlived the session that fetched it: the query cache,
      whose `gcTime` is a day, and the `localStorage` snapshot. Signing out
      cleared neither, so the shop that came back after an admin signed out on
      a shared machine was still the admin's.

      `onSettled` rather than `onSuccess`: a logout whose request failed may
      still have cleared the cookie, and the cost of dropping these when it did
      not is one refetch.
    */
    onSettled: () => {
      clearCatalogSnapshot();
      queryClient.removeQueries({ queryKey: ["store"] });
    },
  });

  /**
   * Safe profile sync: cancel any in-flight "me" fetch, apply an optimistic
   * patch, roll back on error, and commit the server copy on success.
   * This prevents a stale in-flight GET from overwriting a fresh update.
   */
  const updateProfile = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.updateProfile(patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ["me"] });
      const previous = queryClient.getQueryData<{ user: PublicUser | null }>(["me"]);
      if (previous?.user) {
        queryClient.setQueryData(["me"], {
          user: { ...previous.user, ...(patch as Partial<PublicUser>) },
        });
      }
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(["me"], context.previous);
    },
    onSuccess: (data) => {
      if (data?.user) queryClient.setQueryData(["me"], { user: data.user });
    },
  });

  const user: PublicUser | null = query.data?.user ?? null;

  return {
    user,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    login,
    register,
    logout,
    updateProfile,
    sendOtp,
    verifyOtp,
    refetch: invalidate,
  };
}
