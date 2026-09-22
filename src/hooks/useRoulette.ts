import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";

/**
 * The roulette's state, and the two things a member can do to it.
 *
 * Every number here arrives from the server and none of it is recomputed on
 * this side. The odds in particular: the screen prints what `/api/roulette`
 * says the chances are for the chosen ticket count, so the member and the
 * engine can never be reading two different sets.
 */

export interface RouletteCardData {
  id: string;
  title: string;
  /** null when the shop has no square art for this game — print the name. */
  image: string | null;
}

export interface RoulettePrizeData {
  id: string;
  spinId: string;
  productId: string;
  productTitle: string;
  productImage: string | null;
  productPrice: number;
  bucket: string;
  status: "available" | "claiming" | "claimed" | "expired";
  wonAt: string;
  claimedAt: string | null;
  orderId: string | null;
  threadId: string | null;
}

export interface OddsRow {
  key: string;
  label: string;
  /** A real percentage of the whole, after normalisation. Never a weight. */
  percent: number;
  games: number;
}

export interface RouletteState {
  tickets: number;
  bananas: number;
  prizes: RoulettePrizeData[];
  strip: RouletteCardData[];
  poolSize: number;
  population: Record<string, number>;
  odds: OddsRow[];
  emptied?: string[];
  ticketPriceBananas: number;
  maxTicketsPerSpin: number;
  priceBoundary: number;
  marketPrice: number;
}

export interface SpinResponse {
  ok?: boolean;
  won?: boolean;
  spinId?: string;
  tickets?: number;
  ticketsLeft?: number;
  replay?: boolean;
  prize?: RoulettePrizeData | null;
  odds?: OddsRow[];
  message?: string;
  error?: string;
  code?: string;
}

async function read(tickets: number): Promise<RouletteState> {
  const res = await fetch(`/api/roulette?tickets=${tickets}`, { credentials: "include" });
  const data = (await res.json().catch(() => ({}))) as RouletteState & { error?: string };
  if (!res.ok) throw new Error(data.error || "تعذّر تحميل الروليت");
  return data;
}

/**
 * A fresh id per press of a button.
 *
 * `crypto.randomUUID` where it exists, and a composed fallback where it does
 * not — this has to work in an older in-app browser, and a member whose phone
 * cannot mint an id would otherwise be one whose spin cannot be deduplicated.
 */
export function pressId(prefix: string): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${uuid}`.replace(/[^\w-]/g, "").slice(0, 64);
}

export function useRoulette(tickets: number) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["roulette", tickets],
    queryFn: () => read(tickets),
    staleTime: 10_000,
    /*
      Keep the previous answer on screen while a new ticket count loads. The
      odds table redraws when the member moves the selector, and blanking the
      whole screen to change one column would be a worse answer than a stale
      one for a moment.
    */
    placeholderData: (previous) => previous,
  });

  /*
    ONE ID PER PRESS, HELD ACROSS RETRIES.

    A new id on every attempt would make the server's idempotency useless: two
    attempts at the same press would be two spins and two charges. So the id is
    minted when the press begins and kept in a ref until that press resolves.
  */
  const pending = useRef<string | null>(null);

  const spin = useMutation({
    mutationFn: async (count: number): Promise<SpinResponse> => {
      if (!pending.current) pending.current = pressId("spin");
      const res = await fetch("/api/roulette", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "spin", tickets: count, requestId: pending.current }),
      });
      const data = (await res.json().catch(() => ({}))) as SpinResponse;
      if (!res.ok) throw new Error(data.error || "تعذّر تنفيذ الدورة");
      return data;
    },
    onSettled: () => {
      pending.current = null;
      void queryClient.invalidateQueries({ queryKey: ["roulette"] });
    },
  });

  const importPrize = useMutation({
    mutationFn: async (prizeId: string) => {
      const res = await fetch("/api/roulette", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "import_prize", prizeId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        orderId?: string;
        threadId?: string;
        alreadyImported?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "تعذّر استيراد اللعبة");
      return data;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["roulette"] });
    },
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["roulette"] });
  }, [queryClient]);

  return { state: query.data, isPending: query.isPending, error: query.error, spin, importPrize, refresh };
}
