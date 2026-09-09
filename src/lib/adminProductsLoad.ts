/**
 * How a `/api/admin/products` response becomes one of three admin-table states.
 *
 * The rule that matters here is the one the old loader got wrong: **an empty
 * list is only an empty catalogue when the server says the catalogue is
 * empty.** `d1Count` is the total D1 holds before pagination, so a zero-length
 * page next to a non-zero count is a failed read wearing the shape of a
 * success. Treating it as success is how the admin page reported
 * "0 من أصل 0 منتج مسجل في D1" while the products were still there.
 *
 * A 200 that carries no `products` array at all — an auth redirect, a truncated
 * response — is `unusable` too. The previous loader accepted it, set no state,
 * and left the table spinning with nothing left to change it.
 *
 * Kept out of the component so the decision can be tested against real payload
 * shapes rather than through a rendered dashboard.
 */

export interface AdminProductRow {
  id: string;
  title: string;
  titleEn: string;
  slug: string;
  [key: string]: unknown;
}

export interface PaginationFacts {
  page: number;
  limit: number;
  hasMore: boolean;
  /** Chip counts over the whole catalogue; absent on an older response. */
  facets?: { hidden: number; unpriced: number; performanceRequired: number };
  /*
    Rows in the projection, ignoring the filter — `d1Count` is the match count.
    Absent on an older response, and the header falls back to saying only what
    it can stand behind rather than guessing.
  */
  catalogueTotal?: number;
}

export type ProductsPayloadVerdict =
  | ({ state: "loaded"; products: AdminProductRow[]; d1Count: number } & PaginationFacts)
  | ({ state: "empty"; products: []; d1Count: number } & PaginationFacts)
  /** Retry-worthy: the response cannot be believed, whatever its status was. */
  | { state: "unusable"; reason: string };

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Fills the identity fields the table sorts and links on, without inventing data. */
function normalizeRow(raw: Record<string, unknown>): AdminProductRow {
  const id = text(raw["id"]) || String(raw["id"] ?? "");
  const title = text(raw["title"]);
  const titleEn = text(raw["titleEn"]);
  return {
    ...raw,
    id,
    title: title || titleEn || id,
    titleEn: titleEn || title || id,
    slug: typeof raw["slug"] === "string" ? raw["slug"] : id,
  };
}

/**
 * Whether the table should warn that a game needs a performance review.
 *
 * The answer comes from the server, which computed it in `toIndexRow` against
 * the whole product document. The table row is a `product_index` projection and
 * has no `devicePerformance` at all, so re-running
 * `requiresPerformanceReview` on it here found no records, decided every
 * Switch 2 game was missing its performance data, and showed the warning on all
 * of them — while the documents themselves passed validation and the stored
 * flag was zero.
 */
export function showsPerformanceWarning(row: Record<string, unknown>): boolean {
  return row["performanceRequired"] === true;
}

export function interpretProductsPayload(payload: unknown): ProductsPayloadVerdict {
  if (!payload || typeof payload !== "object") {
    return { state: "unusable", reason: "payload is not an object" };
  }
  const body = payload as {
    items?: unknown;
    products?: unknown;
    total?: unknown;
    d1Count?: unknown;
    page?: unknown;
    limit?: unknown;
    hasMore?: unknown;
    catalogueTotal?: unknown;
    error?: unknown;
  };
  // `items` is what the endpoint means; `products` is the name the admin page
  // shipped with, and both are sent so a page loaded before the rename keeps
  // reading the same response.
  const rows = Array.isArray(body.items) ? body.items : body.products;
  if (!Array.isArray(rows)) {
    return {
      state: "unusable",
      reason: text(body.error) || "response carries no products array",
    };
  }

  const products = rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map(normalizeRow);

  const declaredTotal = Number(body.total ?? body.d1Count);
  if (rows.length > 0 && !Number.isFinite(declaredTotal)) {
    // A page without a total cannot be paginated against, and silently
    // substituting the page length is how a first page became "the catalogue".
    return { state: "unusable", reason: "response carries rows but no total" };
  }
  const d1Count = Number.isFinite(declaredTotal) ? declaredTotal : products.length;

  const page = Number(body.page);
  const limit = Number(body.limit);
  const facets = (payload as { facets?: unknown }).facets;
  const catalogueTotal = Number(body.catalogueTotal);
  const pagination: PaginationFacts = {
    ...(Number.isFinite(catalogueTotal) && catalogueTotal >= 0 ? { catalogueTotal } : {}),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: Number.isFinite(limit) && limit > 0 ? limit : products.length,
    ...(facets && typeof facets === "object"
      ? { facets: facets as PaginationFacts["facets"] }
      : {}),
    hasMore:
      typeof body.hasMore === "boolean"
        ? body.hasMore
        : products.length > 0 && products.length < d1Count,
  };

  if (products.length > 0) return { state: "loaded", products, d1Count, ...pagination };

  /*
    An empty page is an empty catalogue only when the server says the catalogue
    is empty — with one exception the paginated endpoint introduces: page 3 of
    a two-page list is legitimately empty and is not a failed read.
  */
  if (d1Count > 0) {
    if (pagination.page > 1) {
      return { state: "empty", products: [], d1Count, ...pagination };
    }
    return {
      state: "unusable",
      reason: `empty page while D1 reports ${d1Count} products`,
    };
  }

  return { state: "empty", products: [], d1Count: 0, ...pagination };
}

/* ------------------------------ retry policy ------------------------------ */

export interface EndpointAttempt {
  ok: boolean;
  data: unknown;
  /** One line naming the path, status and timing — logged and shown to the admin. */
  detail: string;
}

export type FetchJson = (path: string, signal: AbortSignal) => Promise<EndpointAttempt>;

export type LoadOutcome =
  | ({
      state: "loaded";
      products: AdminProductRow[];
      d1Count: number;
      attempts: number;
    } & PaginationFacts)
  | ({ state: "empty"; d1Count: number; attempts: number } & PaginationFacts)
  | { state: "failed"; detail: string; attempts: number }
  /** The caller navigated away; the UI must keep whatever it already showed. */
  | { state: "aborted" };

/** Attempts per endpoint. Bounded on purpose — see {@link loadAdminProducts}. */
export const LOAD_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fetches the product list until it can be believed, or until the attempts run
 * out — and then says so.
 *
 * The loop is bounded, and every exit assigns a terminal state. That is the
 * whole fix for the spinner that never stopped: previously a 200 carrying no
 * `products` array was recorded as a success, no state was written, and nothing
 * remained that could ever change the "جاري تحميل قائمة المنتجات من قاعدة
 * البيانات D1..." row. There are now exactly three endings — rows, a catalogue
 * the server confirms is empty, or an error carrying the failing path and
 * status next to a Retry button — plus `aborted`, which only happens when the
 * caller has navigated away and no longer has a table to update.
 */
export async function loadAdminProducts({
  fetchJson,
  path,
  signal,
  attempts = LOAD_ATTEMPTS,
  delay = sleep,
}: {
  fetchJson: FetchJson;
  path: string;
  signal: AbortSignal;
  attempts?: number;
  /** Injectable so tests do not wait out the real backoff. */
  delay?: (ms: number) => Promise<void>;
}): Promise<LoadOutcome> {
  let detail = "";

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal.aborted) return { state: "aborted" };
    const result = await fetchJson(path, signal);
    if (signal.aborted) return { state: "aborted" };

    if (result.ok) {
      const verdict = interpretProductsPayload(result.data);
      if (verdict.state === "loaded") {
        return {
          state: "loaded",
          products: verdict.products,
          d1Count: verdict.d1Count,
          page: verdict.page,
          limit: verdict.limit,
          hasMore: verdict.hasMore,
          ...(verdict.facets ? { facets: verdict.facets } : {}),
          ...(verdict.catalogueTotal !== undefined
            ? { catalogueTotal: verdict.catalogueTotal }
            : {}),
          attempts: attempt + 1,
        };
      }
      if (verdict.state === "empty") {
        return {
          state: "empty",
          d1Count: verdict.d1Count,
          page: verdict.page,
          limit: verdict.limit,
          hasMore: verdict.hasMore,
          ...(verdict.facets ? { facets: verdict.facets } : {}),
          ...(verdict.catalogueTotal !== undefined
            ? { catalogueTotal: verdict.catalogueTotal }
            : {}),
          attempts: attempt + 1,
        };
      }
      detail = `${result.detail} — ${verdict.reason}`;
    } else {
      detail = result.detail;
    }

    if (attempt < attempts - 1) await delay(1000 * 2 ** attempt);
  }

  if (signal.aborted) return { state: "aborted" };
  return { state: "failed", detail, attempts };
}

/* --------------------------- request lifecycle ---------------------------- */

/**
 * The identity of a products request: page, size, order, filters.
 *
 * Two loads with the same key are the same question, and asking it twice
 * concurrently is how a sort change that fired from both a click handler and a
 * state effect produced two requests whose answers raced — the slower one
 * winning and putting the table back in the previous order.
 */
export interface ProductsRequestKey {
  page: number;
  limit: number;
  sort: string;
  dir: string;
  search: string;
}

export function productsRequestKey(key: ProductsRequestKey): string {
  return [key.page, key.limit, key.sort, key.dir, key.search.trim().toLowerCase()].join("|");
}

/**
 * Runs one load per distinct key, sharing the promise with anything that asks
 * for the same key while it is in flight.
 *
 * Deliberately not a cache: the entry is dropped the moment the request
 * settles, so a Retry after a failure really re-asks, and a refresh after a
 * save really re-reads. It only collapses *simultaneous* duplicates.
 */
export function createProductsRequestGate() {
  const inFlight = new Map<string, Promise<LoadOutcome>>();

  return {
    run(key: string, load: () => Promise<LoadOutcome>): Promise<LoadOutcome> {
      const existing = inFlight.get(key);
      if (existing) return existing;
      const promise = load().finally(() => {
        // Only clear our own entry: a later request for the same key that
        // started after this one settled owns the slot now.
        if (inFlight.get(key) === promise) inFlight.delete(key);
      });
      inFlight.set(key, promise);
      return promise;
    },
    get size() {
      return inFlight.size;
    },
  };
}

/** Everything that identifies one products request. */
export interface ProductsQuery {
  page?: number;
  search?: string;
  hidden?: boolean;
  unpriced?: boolean;
  performance?: boolean;
  category?: string;
  sort?: { field: "updated" | "price" | "name" | "order"; direction: "asc" | "desc" };
}
