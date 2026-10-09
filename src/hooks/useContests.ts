import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { ContestEntryMethod } from "@/lib/contests";

/**
 * Contests on the member's side: the list, the viewer's own tickets, the
 * games they have won (roulette and contests alike), and the three things
 * they can do — take tickets, claim a game won on Instagram, import a game.
 */
export function useContests() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["contests"],
    queryFn: () => api.contests(),
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const settle = () => {
    void queryClient.invalidateQueries({ queryKey: ["contests"] });
    void queryClient.invalidateQueries({ queryKey: ["roulette"] });
  };

  const enter = useMutation({
    mutationFn: (payload: {
      contestId: string;
      method: ContestEntryMethod;
      count?: number;
      requestId?: string;
      code?: string;
    }) => api.enterContest(payload),
    onSettled: () => {
      settle();
      // A banana entry moves the balance the header and the market show.
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      void queryClient.invalidateQueries({ queryKey: ["banana"] });
    },
  });

  const claim = useMutation({
    mutationFn: (code: string) => api.claimContestPrize(code),
    onSettled: settle,
  });

  /* The roulette's own import: a contest's game is a roulette prize row. */
  const importPrize = useMutation({
    mutationFn: async (prizeId: string) => {
      const res = await fetch("/api/roulette", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "import_prize", prizeId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        orderId?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "تعذّر استيراد اللعبة");
      return data;
    },
    onSettled: settle,
  });

  return {
    contests: query.data?.contests ?? [],
    prizes: query.data?.prizes ?? [],
    isPending: query.isPending,
    error: query.error,
    enter,
    claim,
    importPrize,
    refresh: () => query.refetch(),
  };
}

/** The current time, ticking — for countdowns. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
