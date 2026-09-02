/* Banana Store service worker — Cloudflare-only asset + data caching. */
const VERSION = "banana-v9";
const IMAGE_CACHE = `${VERSION}-images`;
/*
  The generation is on the data cache alone. Devices that visited while the
  server was serving an empty catalogue as a success are holding one, and it is
  good on their machine for six hours; renaming the cache drops it on the next
  activation. Bumping VERSION instead would take every cached image with it,
  which this fault gives no reason to do.
*/
const DATA_CACHE = `${VERSION}-data2`;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                !key.startsWith(VERSION) ||
                // A superseded data cache of the current version, which is how
                // a catalogue cached during an outage is dropped.
                (key.includes("-data") && key !== DATA_CACHE),
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

const isImage = (request, url) =>
  !url.pathname.startsWith("/api/files") &&
  (request.destination === "image" ||
    url.pathname.startsWith("/api/img") ||
    /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(url.pathname));

/** Cache first, refresh in the background. */
async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.status === 200) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

/*
  How long a cached catalogue may still be served after the network fails.

  The catalogue is the one response that must never outlive the truth: a stale
  copy shows products that were deleted and prices that changed. Network-first
  already means an online visitor cannot see a stale catalogue at all, and this
  bounds the offline case — past it, failing is more honest than serving a
  catalogue from last week.
*/
const DATA_MAX_OFFLINE_AGE_MS = 6 * 60 * 60 * 1000;

/*
  Whether a stored catalogue response came from a catalogue that had products.

  The server stamps every `/api/data` answer with how many products the store
  it was built from held. A response stamped zero is either a shop with nothing
  in it or — the case this exists for — a read that failed and was served as if
  it had succeeded. Keeping one turns a momentary fault into six hours of an
  empty storefront on that device, so it is neither stored nor served. Read
  from a header rather than by parsing the body: this runs on every catalogue
  request, and the payload is hundreds of kilobytes.
*/
function catalogueHasProducts(response) {
  const stamped = response?.headers?.get("x-catalog-size");
  if (stamped === null || stamped === undefined) return true; // not a catalogue response
  return Number(stamped) > 0;
}

/** Network first for data queries. Never serves stale data to an online visitor. */
async function networkFirst(cacheName, request) {
  const cache = await caches.open(cacheName);

  const servableCached = async () => {
    const cached = await cache.match(request);
    if (!cached) return undefined;
    const cachedAt = Number(cached.headers.get("x-sw-cached-at") || 0);
    const tooOld = cachedAt && Date.now() - cachedAt > DATA_MAX_OFFLINE_AGE_MS;
    if (tooOld || !catalogueHasProducts(cached)) {
      await cache.delete(request);
      return undefined;
    }
    return cached;
  };

  try {
    const response = await fetch(request);

    /*
      A conditional request answered 304 has no body. Returning it to the page
      would look like an empty catalogue, so the cached copy the validator
      refers to is served instead — which is what 304 means.
    */
    if (response && response.status === 304) {
      const cached = await servableCached();
      if (cached) return cached;
      // No usable body to pair with the validator: ask again unconditionally.
      return fetch(new Request(request.url, { cache: "reload", credentials: request.credentials }));
    }

    /*
      The server says it could not read the catalogue (503) or failed outright.
      The last good copy is a better answer than an error page, and it is
      bounded by the same six hours as the offline case.
    */
    if (response && response.status >= 500) {
      const cached = await servableCached();
      if (cached) return cached;
      return response;
    }

    /*
      The cache is keyed by URL alone, and `/api/data` answers admins and
      shoppers at the same URL — an admin payload carries hidden products and
      costs, so storing one lets it be replayed to the storefront on that
      device. The server already marks those responses `private, no-store`;
      honour it rather than keeping a copy it asked us not to keep.
    */
    const directive = response?.headers?.get("cache-control") || "";
    const mayStore = !/no-store|private/i.test(directive);

    if (response && response.status === 200 && mayStore && catalogueHasProducts(response)) {
      // The stored copy is stamped so its age can be judged on the way out.
      const body = await response.clone().blob();
      const headers = new Headers(response.headers);
      headers.set("x-sw-cached-at", String(Date.now()));
      cache.put(request, new Response(body, { status: 200, headers }));
    }
    return response;
  } catch (error) {
    const cached = await servableCached();
    if (cached) return cached;
    throw error;
  }
}

/*
  Targeted invalidation. After a product is created, edited, hidden or deleted,
  the admin page tells the worker to drop just the catalogue cache — rather than
  bumping VERSION, which would throw away every cached image as well.
*/
self.addEventListener("message", (event) => {
  const type = event?.data?.type;
  if (type === "catalog-changed") {
    event.waitUntil(caches.delete(DATA_CACHE));
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // NEVER cache navigations/HTML to prevent white screen cycles or stale chunk script tags
  if (request.mode === "navigate") return;

  // NEVER cache scripts, styles, or module chunks - let the browser manage module chunks natively
  if (
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "font" ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".mjs") ||
    url.pathname.endsWith(".ts") ||
    url.pathname.endsWith(".tsx") ||
    url.pathname.includes("/_build/") ||
    url.pathname.includes("/assets/") ||
    url.pathname.startsWith("/@") ||
    url.pathname.startsWith("/src/") ||
    url.pathname.includes("/node_modules/")
  ) {
    return;
  }

  // Never cache authenticated endpoints, session responses, or private files.
  if (
    url.pathname.startsWith("/api/auth") ||
    url.pathname.startsWith("/api/chat") ||
    url.pathname.startsWith("/api/orders") ||
    url.pathname.startsWith("/api/profile") ||
    url.pathname.startsWith("/api/otp") ||
    url.pathname.startsWith("/api/wallet") ||
    url.pathname.startsWith("/api/telegram") ||
    url.pathname.startsWith("/api/upload") ||
    url.pathname.startsWith("/api/files") ||
    url.pathname.startsWith("/api/admin") ||
    url.pathname.startsWith("/_serverFn")
  ) {
    return;
  }

  if (isImage(request, url)) {
    event.respondWith(staleWhileRevalidate(IMAGE_CACHE, request));
  } else if (url.pathname.startsWith("/api/data")) {
    event.respondWith(networkFirst(DATA_CACHE, request));
  }
});
