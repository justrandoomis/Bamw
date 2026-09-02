/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "@/hooks/useAuth";
import { profileRedirectTarget } from "@/lib/authRedirect";

const meMock = vi.fn();
const updateProfileMock = vi.fn();
const logoutMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    me: (...a: unknown[]) => meMock(...a),
    updateProfile: (...a: unknown[]) => updateProfileMock(...a),
    logout: (...a: unknown[]) => logoutMock(...a),
    login: vi.fn(),
    register: vi.fn(),
    sendOtp: vi.fn(),
    verifyOtp: vi.fn(),
  },
}));

const baseUser = {
  id: "u-5220",
  name: "عضو 5220",
  email: "bananq67xx@example.com",
  phoneVerifiedAt: "2026-01-01T00:00:00Z",
  profileCompletedAt: "2026-01-01T00:00:00Z",
};

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { Wrapper, client };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAuth session integration", () => {
  it("fetches the session exactly once and keeps it cached", async () => {
    meMock.mockResolvedValue({ user: baseUser });
    const { Wrapper } = wrapper();
    const { result, rerender } = renderHook(() => useAuth(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.user).toBeTruthy());
    rerender();
    rerender();

    expect(meMock).toHaveBeenCalledTimes(1);
  });

  it("never exposes a transient null before the first response resolves", async () => {
    let resolve!: (v: unknown) => void;
    meMock.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });

    // While loading, /profile must not redirect even though user is null.
    expect(result.current.isLoading).toBe(true);
    expect(
      profileRedirectTarget({
        user: result.current.isLoading ? undefined : result.current.user,
        isLoading: result.current.isLoading,
        isFetching: result.current.isFetching,
        isClient: true,
      }),
    ).toBeNull();

    await act(async () => {
      resolve({ user: baseUser });
    });
    await waitFor(() => expect(result.current.user).toBeTruthy());
  });

  it("commits the server copy on profile update without refetching", async () => {
    meMock.mockResolvedValue({ user: baseUser });
    updateProfileMock.mockResolvedValue({ user: { ...baseUser, name: "اسم جديد" } });

    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.user).toBeTruthy());

    await act(async () => {
      await result.current.updateProfile.mutateAsync({ name: "اسم جديد" });
    });

    await waitFor(() => expect(result.current.user?.name).toBe("اسم جديد"));
    expect(meMock).toHaveBeenCalledTimes(1); // no extra GET raced the update
  });

  it("rolls back an optimistic update when the server rejects it", async () => {
    meMock.mockResolvedValue({ user: baseUser });
    updateProfileMock.mockRejectedValue(new Error("nope"));

    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.user).toBeTruthy());

    await act(async () => {
      await result.current.updateProfile.mutateAsync({ name: "خطأ" }).catch(() => {});
    });

    expect(result.current.user?.name).toBe(baseUser.name);
  });

  it("logout clears the session so /profile redirects once", async () => {
    meMock.mockResolvedValue({ user: baseUser });
    logoutMock.mockResolvedValue({ user: null });

    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.user).toBeTruthy());

    await act(async () => {
      await result.current.logout.mutateAsync();
    });

    await waitFor(() => expect(result.current.user).toBeNull());
    expect(
      profileRedirectTarget({
        user: result.current.user,
        isLoading: result.current.isLoading,
        isFetching: result.current.isFetching,
        isClient: true,
      }),
    ).toBe("/auth");
    expect(meMock).toHaveBeenCalledTimes(1);
  });
});
