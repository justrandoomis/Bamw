import { createFileRoute } from "@tanstack/react-router";

import {
  getCatalogVersion,
  getStore,
  getStoreCacheVersion,
  isStoreDegraded,
  updateStore,
  getAdminAvailabilityStatus,
  getAdminAvailabilityConfig,
  saveAdminAvailabilityConfig,
} from "@/lib/db.server";
import { body, guard, json } from "@/lib/http.server";
import { requireAdmin } from "@/lib/session.server";
import { getSessionUser } from "@/lib/session.server";
import { autoTranslateProduct, autoTranslateBundle } from "@/lib/translate.server";

import { forceFullImport } from "@/lib/force-import.server";
import { isProductHidden, isVisibleToPublic } from "@/lib/purchasable";
import { redactPrivateKeys, toPublicProduct } from "@/lib/public-product.server";
import type { StoreDoc, AdminAvailabilityStatus, AdminAvailabilityConfig } from "@/lib/types";

/** Cheap, stable hash used for the ETag of the catalogue payload. */
function etagFor(payload: string) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < payload.length; i++) {
    h1 = ((h1 ^ payload.charCodeAt(i)) * 16777619) >>> 0;
    h2 = ((h2 + payload.charCodeAt(i)) * 2654435761) >>> 0;
  }
  return `W/"${payload.length.toString(36)}-${h1.toString(36)}${h2.toString(36)}"`;
}

/** Fields the storefront listings need — heavy fields (galleries, long descriptions,
 * timelines, dlc arrays) are loaded on the product page only. */
const LIST_FIELDS = [
  "id",
  "title",
  "titleEn",
  "english_name",
  "subtitle",
  "slug",
  "price",
  "status",
  "isActive",
  "kind",
  "platform",
  "category",
  "categoryId",
  "categoryTitle",
  "schemaId",
  "genre",
  "genres",
  "developer",
  "publisher",
  "metacriticRating",
  "metacriticScore",
  "rating",
  // Canonical front box cover + trim
  "cartridgeImage",
  "cartridgeImageTrim",
  "nintendoCardImage",
  "image",
  "coverImage",
  "coverImageTrim",
  "coverUrl",
  "box_front_url",
  "banner",
  "bannerImage",
  /*
    The non-game image roles. A hardware, accessory, amiibo or gift-card card
    resolves `listing_image → main_image → front_image → packaging_front_image`
    (src/lib/productImages.ts), and none of those fields used to travel in the
    listing payload — so a product whose template set `listing_image` still
    showed the placeholder in a grid, and only got its real picture after the
    full record loaded on the details page.
  */
  "listingImage",
  "mainImage",
  "frontImage",
  "packagingFrontImage",
  "thumbnailImage",
  "brand",
  "releaseDate",
  "release_date",
  "releaseYear",
  "release_year",
  "createdAt",
  "created_at",
  "updatedAt",
  "updated_at",
  "stock",
  "sales",
  "displayOrder",
  "isHidden",
  "visibility",
  "options",
  "types",
  "badges",
  "tags",
] as const;

/*
  What a customer may see now lives in one place — see
  src/lib/public-product.server.ts. It used to be two inline copies, one here
  and one in /api/product, and neither knew that a supplier cost rule was
  riding along inside a variant's `description`.
*/
const publicProduct = toPublicProduct;

function publicStore(
  store: StoreDoc,
  availability?: AdminAvailabilityStatus,
): StoreDoc & { adminAvailability?: AdminAvailabilityStatus } {
  return {
    ...(redactPrivateKeys(store) as StoreDoc),
    products: (store.products ?? [])
      .filter((product) => isVisibleToPublic(product))
      .map((product) => publicProduct(product) as StoreDoc["products"][number]),
    /*
      Redacted, then filtered — not filtered from the raw store.

      The spread above redacts the whole document, and this line then replaced
      `bundles` with the original array, quietly undoing that work for the one
      collection it names. A bundle carries the products it is made of, so
      whatever a product would not have shown was reachable through here.
    */
    bundles: (
      (redactPrivateKeys(store.bundles ?? []) ?? []) as NonNullable<StoreDoc["bundles"]>
    ).filter((b) => b?.isActive !== false),
    quickReplies: [],
    autoReplies: {},
    adminPresence: { online: availability?.isAvailable ?? false },
    adminAvailability: availability,
    gameRequests: [],
    discTrades: [],
    visits: 0,
    views: 0,
  };
}

function slimStore(store: any, options?: { page?: number; limit?: number; category?: string }) {
  let products = Array.isArray(store?.products) ? store.products : [];

  if (options?.category) {
    const cat = options.category.toLowerCase();
    products = products.filter((p: any) => 
      String(p?.category || "").toLowerCase() === cat ||
      String(p?.categoryId || "").toLowerCase() === cat
    );
  }

  const total = products.length;

  if (options?.page && options.page > 0 && options?.limit && options.limit > 0) {
    const start = (options.page - 1) * options.limit;
    products = products.slice(start, start + options.limit);
  }

  return {
    ...store,
    totalProducts: total,
    bundles: Array.isArray(store?.bundles) ? store.bundles : [],
    products: products.map((p: any) => {
      const out: Record<string, unknown> = {};
      for (const key of LIST_FIELDS) if (p?.[key] !== undefined) out[key] = p[key];
      return out;
    }),
  };
}

/**
 * Serialised public catalogue, memoised per store snapshot.
 */
let publicPayloadCache:
  | {
      store: StoreDoc;
      version: number;
      availabilityKey: string;
      visible: ReturnType<typeof publicStore>;
      full?: string;
      slim?: string;
    }
  | undefined;

export function invalidatePublicPayloadCache() {
  publicPayloadCache = undefined;
}

function publicPayload(
  store: StoreDoc,
  availability: AdminAvailabilityStatus | undefined,
  slim: boolean,
  options?: { page?: number; limit?: number; category?: string }
): string {
  const availabilityKey = JSON.stringify(availability ?? null);
  const currentVersion = getStoreCacheVersion();
  if (
    publicPayloadCache?.store !== store ||
    publicPayloadCache?.version !== currentVersion ||
    publicPayloadCache?.availabilityKey !== availabilityKey
  ) {
    publicPayloadCache = {
      store,
      version: currentVersion,
      availabilityKey,
      visible: publicStore(store, availability),
    };
  }

  const cache = publicPayloadCache;
  if (options?.page || options?.category) {
    return JSON.stringify(slimStore(cache.visible, options));
  }
  if (slim) return (cache.slim ??= JSON.stringify(slimStore(cache.visible)));
  return (cache.full ??= JSON.stringify(cache.visible));
}

export const Route = createFileRoute("/api/data")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          const startTime = Date.now();
          const reqId = `req_${Math.random().toString(36).slice(2, 8)}`;
          const url = new URL(request.url);
          const slim = url.searchParams.has("slim");
          const page = parseInt(url.searchParams.get("page") || "0", 10);
          const limit = parseInt(url.searchParams.get("limit") || "0", 10);
          const category = url.searchParams.get("category") || undefined;

          const viewer = await getSessionUser(request);
          const availability = await getAdminAvailabilityStatus();
          const availabilityConfig = viewer?.isAdmin
            ? await getAdminAvailabilityConfig()
            : undefined;

          const store = await getStore();
          const duration = Date.now() - startTime;

          /*
            The catalogue could not be read and there was nothing left to serve
            in its place. Answering 200 with an empty `products` array is what
            put bare section headings on the storefront: the client cannot tell
            it from a shop with no stock, so it renders the emptiness, the edge
            caches it for five seconds and the service worker keeps it for
            hours. A 503 that is never stored says the true thing — come back
            in a moment — and every cache along the way declines to keep it.
          */
          if (isStoreDegraded(store)) {
            console.error(
              `[CATALOG_UNAVAILABLE] reqId=${reqId} duration=${duration}ms — refusing to serve an empty catalogue`,
            );
            return new Response(
              JSON.stringify({ error: "catalog_unavailable", ref: reqId, retryable: true }),
              {
                status: 503,
                headers: {
                  "content-type": "application/json; charset=utf-8",
                  "cache-control": "no-store",
                  "retry-after": "2",
                  "x-data-source": "degraded",
                  vary: "cookie",
                },
              },
            );
          }

          if (duration > 2000) {
            console.warn(`[SLOW_REQUEST] /api/data reqId=${reqId} duration=${duration}ms url=${request.url}`);
          } else {
            console.log(`[PRODUCTS_FETCH_SUCCESS] reqId=${reqId} duration=${duration}ms productsCount=${store?.products?.length ?? 0}`);
          }

          const paginationOpts = (page > 0 || category) ? { page, limit, category } : undefined;

          let payload: string;
          if (viewer?.isAdmin) {
            const visibleStore = {
              ...store,
              adminAvailability: availability,
              adminAvailabilityConfig: availabilityConfig,
            };
            payload = JSON.stringify(slim ? slimStore(visibleStore, paginationOpts) : visibleStore);
          } else {
            payload = publicPayload(store, availability, slim, paginationOpts);
          }
          /*
            The catalogue version rides on the response so a client can tell a
            changed catalogue from an unchanged one, and so stale data can be
            traced to a layer. It is `store_rev` — written by `persistStore` in
            the same transaction as the catalogue, so every isolate and every
            edge agrees on it. Folding it into the ETag means a mutation always
            produces a new validator, even in the rare case where the serialised
            payload is byte-identical.
          */
          const catalogVersion = await getCatalogVersion();
          const etag = etagFor(`${catalogVersion}:${payload}`);
          /*
            Only a catalogue with something in it is worth holding at the edge.
            A shop with no products has no traffic to protect, and if emptiness
            ever gets here by a route this file does not know about, five
            seconds of it must not be handed to everyone who asks.
          */
          const servesProducts = (store.products?.length ?? 0) > 0;
          const headers: Record<string, string> = {
            "content-type": "application/json; charset=utf-8",
            etag,
            "cache-control": viewer?.isAdmin
              ? "private, no-store"
              : servesProducts
                ? "public, max-age=0, s-maxage=5, must-revalidate"
                : "no-store",
            "server-timing": `db;dur=${duration}`,
            // Diagnostics: which catalogue this is, and where it came from.
            // No secrets — a version number and the name of a code path.
            "x-catalog-version": String(catalogVersion),
            /*
              How many products the catalogue this answer was built from held.
              The service worker keeps a response only when this is above zero,
              so a momentary emptiness cannot become hours of an empty shop on
              somebody's phone. Read from a header because parsing the payload
              on every request costs more than the check is worth.
            */
            "x-catalog-size": String(store.products?.length ?? 0),
            "x-data-source": viewer?.isAdmin ? "d1:admin" : "d1:public",
            vary: "cookie",
          };
          if (request.headers.get("if-none-match") === etag) {
            headers["x-cache-status"] = "revalidated";
            return new Response(null, { status: 304, headers });
          }
          headers["x-cache-status"] = "fresh";
          return new Response(payload, { headers });
        }),

      POST: async ({ request }) =>
        guard(async () => {
          await requireAdmin(request);
          const patch = await body<
            Partial<StoreDoc> & { adminAvailabilityConfig?: Partial<AdminAvailabilityConfig> }
          >(request);

          if (patch.adminAvailabilityConfig) {
            await saveAdminAvailabilityConfig(patch.adminAvailabilityConfig);
            delete patch.adminAvailabilityConfig;
          }

          if (Array.isArray(patch.products)) {
            patch.products = await Promise.all(patch.products.map(autoTranslateProduct));
          }

          if (Array.isArray(patch.bundles)) {
            patch.bundles = await Promise.all(patch.bundles.map(autoTranslateBundle));
          }

          const updated = await updateStore((prev) => ({
            ...prev,
            ...patch,
          }));

          publicPayloadCache = undefined;

          return json({ ok: true, store: updated });
        }),
    },
  },
});
