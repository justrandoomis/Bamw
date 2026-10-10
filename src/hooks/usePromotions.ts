import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { DEFAULT_PROMOTIONS, normalizePromotions, type PromotionsData } from "@/lib/promotions";

/**
 * The shop's offer switches, as the cart and the home page preview them.
 *
 * Off until the answer arrives, and off if it never does: a cart that showed
 * a free game the checkout then charged for would be worse than one that
 * showed nothing and gave it anyway. The checkout decides from the server's
 * own copy either way.
 */
export function usePromotions(): PromotionsData {
  const query = useQuery({
    queryKey: ["promotions"],
    queryFn: async () => normalizePromotions(await api.promotions()),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  return query.data ?? DEFAULT_PROMOTIONS;
}
