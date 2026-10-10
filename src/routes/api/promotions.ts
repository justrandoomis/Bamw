import { createFileRoute } from "@tanstack/react-router";

import { getStoreMeta } from "@/lib/db.server";
import { guard, json } from "@/lib/http.server";
import { normalizePromotions } from "@/lib/promotions";

/**
 * The shop's offer switches, for the cart and the home page — a few bytes,
 * rather than the whole content document they are stored in.
 *
 * Only what a customer may know: whether the offer is on and how it repeats.
 * The checkout never asks this endpoint; it reads the same content from the
 * store it already loaded, so a cached answer here can only ever be a preview.
 */
export const Route = createFileRoute("/api/promotions")({
  server: {
    handlers: {
      GET: async () =>
        guard(async () => {
          const store = (await getStoreMeta()) as { content?: { promotions?: unknown } };
          return json(normalizePromotions(store.content?.promotions), {
            headers: { "cache-control": "public, max-age=15, stale-while-revalidate=60" },
          });
        }),
    },
  },
});
