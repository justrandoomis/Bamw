import { catalogueCacheKey } from "@/lib/catalogueCacheKey";
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
import { InlineMediaError, offloadInlineMedia } from "@/lib/inlineMedia.server";

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
  /*
    The Arabic name.

    Every screen of this shop is Arabic, 133 of the 150 products carry an
    Arabic name, and none of them travelled in this payload — so a customer
    typing «زيلدا» was searching a catalogue of English strings and got
    nothing. `title` and `titleEn` hold the same English string on every
    product (`buildProductSavePayload` writes `titleEn || title` into both),
    which is why the omission was invisible: the listing looked bilingual
    because the *interface* was, not the data.
  */
  "titleAr",
  "english_name",
  "subtitle",
  "slug",
  /* The series a game belongs to — how a customer asks for the next Zelda. */
  "seriesName",
  "seriesNameEn",
  "series",
  "originalPrice",
  "price",
  "status",
  "isActive",
  "kind",
  "platform",
  "switch2Enhanced",
  "category",
  "categoryId",
  "categoryTitle",
  "schemaId",
  /*
    Whether the game has English in it.

    Seventeen titles in the supplier catalogue do not — they are Japanese or
    Chinese only, and the sheet says so. A customer who buys one expecting
    English has bought the wrong thing, so the flag has to reach the page that
    sells it, which means it has to be in this projection.
  */
  "englishSupport",
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
  "nintendoCardImageTrim",
  // Legacy spellings still resolved by the square-card image contract. Home
  // uses the slim payload, so these must travel with it or valid artwork would
  // be ranked as missing and replaced by the placeholder there only.
  "nintendo_card_image",
  "squareGameImage",
  "squareImage",
  "square_card_image",
  "image",
  "coverImage",
  "coverImageTrim",
  /*
    The high-resolution cover.

    `hasUsableImage` — which decides whether a listing counts as having artwork,
    and therefore whether it is shelved first or last — reads seven fields, and
    this was the one that did not travel. Measured on the live catalogue today:
    NO product relies on it alone, so nothing moves and nothing was mislabelled.
    It is here because the contract this list keeps is "every field the listing
    rules read", not "every field some product happens to use this week".
  */
  "coverHiResImage",
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
  /*
    A gift card's own artwork, and the snake_case spellings.

    `productImages.ts` promises to read both spellings of every role — the
    import parser writes camelCase, and rows created before the schema system
    are snake_case — and this projection carried only the camelCase half. So
    the home page, which fetches `?slim=1`, and the category page, which
    fetches the whole record, could resolve the same pre-schema product
    differently. `cardArtwork` was missing outright, which is why a card
    imported with its artwork and nothing else showed a picture in one place
    and a placeholder in the other.

    A field that is absent costs nothing: the projection below copies a key
    only when the product has it.
  */
  "cardArtwork",
  "card_artwork",
  "listing_image",
  "main_image",
  "cover_image",
  "front_image",
  "packaging_front_image",
  "thumbnail_image",
  "cartridge_image",
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
  /*
    The legacy spellings of hidden.

    `isProductHidden` recognises five — `isHidden`, `is_hidden`, `hidden`,
    `visibility`, `status` — and this projection carried three of them, so a
    pre-schema row hidden through `is_hidden` alone arrived at any admin tool
    looking visible. The bundle picker labels hidden games «مخفي» precisely so
    the admin is not surprised, and that label is only as good as the flags it
    can see. Absent fields cost nothing: the projection copies a key only when
    the product has it, and the public filter runs before this.
  */
  "is_hidden",
  "hidden",
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
    /*
      The heavy collections are taken out before the walk, not after it.

      `redactPrivateKeys` recurses the whole document, and both `products` and
      `bundles` are reassigned immediately below — so at 1,706 products the walk
      spent 34 ms redacting arrays whose output is thrown away, against 42.5 ms
      for the filter and serialisation that actually produce the response. Close
      to half of this function was work nobody could ever see.
    */
    ...(redactPrivateKeys({ ...store, products: [], bundles: [] }) as StoreDoc),
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
    products = products.filter(
      (p: any) =>
        String(p?.category || "").toLowerCase() === cat ||
        String(p?.categoryId || "").toLowerCase() === cat,
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
      // The listing card needs only this legacy Switch 2 flag, not the full
      // switch2 detail object (which may contain a feature list).
      if (p?.switch2?.isSwitch2Edition === true) {
        out.switch2 = { isSwitch2Edition: true };
      }
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
  options?: { page?: number; limit?: number; category?: string },
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

/**
 * The Worker's shared cache, which the DOM's `CacheStorage` type does not name.
 *
 * `caches.default` is a Cloudflare extension: one cache per zone, shared by
 * every isolate, with no `open()` call and no `vary` negotiation. This project
 * does not install `@cloudflare/workers-types` — adding it to reach one
 * property would change how every ambient global in the tree is typed — so the
 * shape is named narrowly here instead.
 *
 * Returns undefined outside a Worker, which is what the test runner and a
 * local Node process are, so the caller falls through to building the payload.
 */
function workerCache(): Cache | undefined {
  const store = (globalThis as { caches?: { default?: Cache } }).caches;
  return store?.default;
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

          /*
            The validator first, and the catalogue only if it is needed.

            The ETag used to be computed from the serialised payload — which
            means a revalidation did every expensive thing a fresh response
            does (read 3.8 MB of chunks, parse them, normalise 876 products,
            serialise the lot) and then threw the body away and answered 304.
            Measured against production: a conditional request took **399 ms to
            return 0 bytes**, and this route was the Worker's single largest CPU
            cost — 33 seconds of it over six hours, p50 505 ms, and eight
            invocations killed with `exceededCpu`.

            Everything the response depends on is cheap to read:

            - `store_rev`, one indexed read of a one-row table, written by
              `persistStore` inside the same transaction as the catalogue. It
              moves on every mutation by construction, which is the property the
              old comment wanted the payload hash for and did not need it to get.
            - the admin's availability, already read above;
            - the shape of the query, and whether the viewer is an admin, since
              those pick which payload is built.

            So the validator is built from those, compared, and a match answers
            304 before `getStore()` is ever called.
          */
          const catalogVersion = await getCatalogVersion();
          /*
            Everything except the clock.

            `checkAdminAvailability` builds `currentBaghdadTime` from the hour
            **and the minute**, so folding the availability object into the
            validator whole gave the catalogue a new ETag every sixty seconds —
            and no returning visitor could ever be answered 304 across a minute
            boundary. That silently undid most of the saving this validator
            exists for.

            Only the key is stripped; the payload still carries the string.
            Nothing reads it from here — `AdminAvailabilityBar` has its own
            query on a fifteen-second refetch and `chat.ts` computes it fresh
            server-side — so a client holding a cached copy renders nothing
            stale, while `isAvailable` and the rest still move the validator the
            moment they change.
          */
          const availabilityKeyFor = (value: AdminAvailabilityStatus | undefined) => {
            if (!value) return "null";
            const { currentBaghdadTime: _clock, ...rest } = value;
            return JSON.stringify(rest);
          };
          const shape = [
            catalogVersion,
            slim ? "slim" : "full",
            page,
            limit,
            category ?? "",
            viewer?.isAdmin ? "admin" : "public",
            availabilityKeyFor(availability),
            JSON.stringify(availabilityConfig ?? null),
          ].join(":");
          const etag = etagFor(shape);

          if (request.headers.get("if-none-match") === etag) {
            return new Response(null, {
              status: 304,
              headers: {
                etag,
                "cache-control": viewer?.isAdmin
                  ? "private, no-store"
                  : "public, max-age=0, s-maxage=5, must-revalidate",
                "x-catalog-version": String(catalogVersion),
                "x-cache-status": "revalidated",
                "server-timing": `validator;dur=${Date.now() - startTime}`,
                vary: "cookie",
              },
            });
          }

          /*
            The public catalogue, held in the Worker's own cache and keyed on
            the revision that built it.

            A cold isolate answering a shopper used to call `getStore()`: read
            fourteen chunks out of D1, concatenate five megabytes of JSON, parse
            it, normalise seventeen hundred products, then build the slim
            payload — for a body that is byte-identical to the one the isolate
            next door just built. The edge cache could not help, because one URL
            answers admins and shoppers and so the response carries
            `vary: cookie`.

            This cache is inside the Worker, so `vary` does not apply to it and
            the admin branch simply never reaches it.

            It is keyed on `store_rev` rather than on a clock, and that is what
            makes it safe rather than a bet. `persistStore` writes the next
            revision into the *same* `d1Batch` as the catalogue chunks, so any
            change to a price, a cost, a stock figure or a visibility flag moves
            the revision, which moves the key, which means the entry built from
            the old figures is never asked for again. There is no window in
            which a cached body quotes a price the shop has changed.

            Revision zero means the revision could not be read, and an answer
            built without knowing which catalogue it came from is not one to
            keep.
          */
          const cacheKeyUrl = catalogueCacheKey({
            version: catalogVersion,
            slim,
            page,
            limit,
            category,
            isAdmin: Boolean(viewer?.isAdmin),
          });
          const cacheKey = cacheKeyUrl ? new Request(cacheKeyUrl, { method: "GET" }) : null;

          if (cacheKey) {
            const cached = await workerCache()
              ?.match(cacheKey)
              .catch(() => undefined);
            if (cached) {
              const headers = new Headers(cached.headers);
              headers.set("x-cache-status", "worker-hit");
              headers.set("server-timing", `worker-cache;dur=${Date.now() - startTime}`);
              return new Response(cached.body, { status: cached.status, headers });
            }
          }

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
            console.warn(
              `[SLOW_REQUEST] /api/data reqId=${reqId} duration=${duration}ms url=${request.url}`,
            );
          } else {
            console.log(
              `[PRODUCTS_FETCH_SUCCESS] reqId=${reqId} duration=${duration}ms productsCount=${store?.products?.length ?? 0}`,
            );
          }

          const paginationOpts = page > 0 || category ? { page, limit, category } : undefined;

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
          headers["x-cache-status"] = "fresh";
          const response = new Response(payload, { headers });

          /*
            Kept only when there is a catalogue worth keeping. An empty or
            degraded answer is refused above; this is the second guard, so a
            momentary emptiness reaching here by some route this file does not
            know about cannot be pinned to a revision and handed to everyone.

            The put is awaited rather than handed to `ctx.waitUntil`, because
            `ctx` is not published to this layer — `server.ts` publishes `env`
            and nothing else — and inventing a global to reach it would be a
            worse trade than the few milliseconds this costs once per revision.
          */
          if (cacheKey && servesProducts) {
            await workerCache()
              ?.put(cacheKey, response.clone())
              .catch(() => {});
          }
          return response;
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

          /*
            Pictures go in the bucket, not in the document.

            These three are the sections `/api/admin/store` reads on every cold
            isolate, and a `data:` URI in one of them is the image itself,
            base64, parsed again on every request. Two bundles saved with a
            photo pasted into `image` made `store:bundles` 10.9 MB — a hundred
            percent of it those two strings — and the runtime answered
            `/api/admin/store` with `exceededCpu` and a 503. The catalogue
            import running at the time got that 503 mid-batch, tried to parse
            Cloudflare's HTML error page as JSON, and reported «The string did
            not match the expected pattern», which is a sentence about none of
            this.

            A save that cannot move the picture is refused with a reason rather
            than written: the admin can try again, and the shop stays up.
            `products` is left out — it has its own media pipeline and its own
            naming rules, and reusing this one would file a box art under
            `Images/Pages`.
          */
          for (const section of ["bundles", "banners", "content"] as const) {
            if (patch[section] === undefined) continue;
            try {
              const offloaded = await offloadInlineMedia(
                patch[section],
                section === "banners" ? "Images/Banners/" : "Images/Pages/",
                section,
              );
              if (offloaded.moved > 0) {
                console.info("[store:inline_media_offloaded]", {
                  section,
                  moved: offloaded.moved,
                  bytes: offloaded.bytes,
                });
                (patch as Record<string, unknown>)[section] = offloaded.value;
              }
            } catch (err) {
              if (err instanceof InlineMediaError) {
                return json({ error: err.arabic, code: "INLINE_MEDIA" }, { status: 422 });
              }
              throw err;
            }
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
