import { createFileRoute } from "@tanstack/react-router";

import { getStore } from "@/lib/db.server";
import { guard, json } from "@/lib/http.server";
import { getSessionUser } from "@/lib/session.server";
import { isVisibleToPublic } from "@/lib/purchasable";
import { findProductByIdOrSlug } from "@/lib/productRouting";
import { toPublicProduct } from "@/lib/public-product.server";
import { applyDealToProduct, readDealsConfig } from "@/lib/deals";


function etagFor(payload: string) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < payload.length; i++) {
    h1 = ((h1 ^ payload.charCodeAt(i)) * 16777619) >>> 0;
    h2 = ((h2 + payload.charCodeAt(i)) * 2654435761) >>> 0;
  }
  return `W/"${payload.length.toString(36)}-${h1.toString(36)}${h2.toString(36)}"`;
}

/**
 * Dedicated high-performance single product retrieval endpoint.
 * Returns only the requested product's complete data (~3KB) with ETag caching.
 */
export const Route = createFileRoute("/api/product")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          const url = new URL(request.url);
          const lookup = url.searchParams.get("id") || url.searchParams.get("slug") || "";

          if (!lookup.trim()) {
            return json({ error: "missing_product_identifier" }, { status: 400 });
          }

          const viewer = await getSessionUser(request);
          const store = await getStore();
          const products = store.products || [];

          const match = findProductByIdOrSlug(products, lookup);
          if (!match) {
            return json({ error: "product_not_found" }, { status: 404 });
          }

          if (!viewer?.isAdmin && !isVisibleToPublic(match)) {
            return json({ error: "product_not_found" }, { status: 404 });
          }

          /*
            One serializer, shared with /api/data. The inline filter this
            replaces only removed private *key names* — which is why a supplier
            cost rule sitting in a variant's `description` sailed straight
            through to the product page.
          */
          /*
            A live occasion deal is applied exactly as the catalogue applies it
            (before the private fields go — the cost floor needs them), so the
            product page shows the price the card showed and checkout charges.
            Never for an admin: their copy is the one the editor saves back.
          */
          const deals = readDealsConfig(store.settings as Record<string, unknown> | undefined);
          const sanitized = viewer?.isAdmin
            ? match
            : toPublicProduct(
                applyDealToProduct(match as unknown as Record<string, unknown>, deals),
              );

          const payload = JSON.stringify({ ok: true, product: sanitized });
          const etag = etagFor(payload);
          const headers = {
            "content-type": "application/json; charset=utf-8",
            etag,
            "cache-control": viewer?.isAdmin
              ? "private, no-store"
              : deals.enabled
                ? // A deal opens and closes by the clock: keep shared copies short.
                  "public, max-age=60, stale-while-revalidate=60"
                : "public, max-age=120, stale-while-revalidate=600",
          };

          if (request.headers.get("if-none-match") === etag) {
            return new Response(null, { status: 304, headers });
          }

          return new Response(payload, { headers });
        }),
    },
  },
});
