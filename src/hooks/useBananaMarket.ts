import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type BananaListing = {
  id: string;
  userId: string;
  user: string;
  avatar: string;
  verified: boolean;
  quantity: number;
  pricePer: number;
  total: number;
  isPrivate: boolean;
  isPromoted: boolean;
  promotedUntil?: string | undefined;
  isLive: boolean;
  diff: number;
  createdAt: string;
};

export type BananaReward = {
  id: string;
  title: string;
  cost: number;
  stock: number;
  icon: string;
  category: string;
  description?: string;
  couponValue?: number;
  couponType?: string;
  rewardCode?: string;
};

export type BananaSnapshot = {
  /*
    The bounds the market enforces, so a refusal can name the number rather
    than only say no. Sent by `marketLimits` in banana.server.ts.
  */
  minPrice: number;
  maxPrice: number;
  minListingQuantity: number;
  maxListingQuantity: number;

  price: number;
  changePct: number;
  chart: { time: string; t: string; price: number }[];
  listings: BananaListing[];
  myListings: BananaListing[];
  balance: number;
  rewards: BananaReward[];
  signedIn: boolean;
  profileComplete: boolean;
  promoRatePerMinute: number;
  unlockedThemes: string[];
};

async function fetchSnapshot(range: string): Promise<BananaSnapshot> {
  const res = await fetch(`/api/banana?range=${encodeURIComponent(range)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("failed_to_load_market");
  return (await res.json()) as BananaSnapshot;
}

/** Single source of truth for the three Banana Market screens. */
export function useBananaMarket(range = "1D") {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["banana", range],
    queryFn: () => fetchSnapshot(range),
    staleTime: 15_000,
    // Keep the previous snapshot on screen while a new range loads, so switching
    // the chart range never blanks or reshuffles the market listings.
    placeholderData: (previous) => previous,
  });

  const act = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/banana", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, range }),
      });
      const data = (await res.json().catch(() => ({}))) as BananaSnapshot & { error?: string };
      if (!res.ok) throw new Error(data.error || "تعذّر تنفيذ العملية");
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["banana", range], data);
      void queryClient.invalidateQueries({ queryKey: ["banana"] });
    },
  });

  return { snapshot: query.data, isPending: query.isPending, error: query.error, act };
}
