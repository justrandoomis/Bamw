/**
 * The games database's reads, and the edge cache in front of them.
 *
 * Twenty thousand titles are rows in D1 (`nintendo_titles`), read a page at a
 * time. They are deliberately not in the catalogue: `/api/data` ships the
 * whole catalogue to every visitor, and this section is opened by a few.
 *
 * Before the loader has run there is no table. That is answered as
 * `ready: false` — the page says the database is being prepared — never as a
 * 500 and never as «no results», and it is never cached, so the first answer
 * after the load is the real one.
 */
import { d1All, getD1 } from "./d1.server";
import {
  GAMES_DB_PAGE_SIZE,
  shopPathFor,
  type GamesDbFacet,
  type GamesDbListResponse,
  type GamesDbQuery,
  type GamesDbTitleResponse,
} from "./games-db";
import {
  anyTitleStatement,
  countStatement,
  facetsStatement,
  listStatement,
  revisionStatement,
  titleStatement,
  toFacets,
  toListItem,
  toTitle,
  type GamesDbStatement,
} from "./games-db.sql";

const all = (statement: GamesDbStatement) =>
  d1All<Record<string, unknown>>(statement.sql, ...statement.binds);

export const isMissingTable = (error: unknown) =>
  /no such table/i.test(error instanceof Error ? error.message : String(error));

/*
  The load's revision: the stamp the loader writes into `nintendo_titles_meta`
  after a load's last batch. The edge cache and the genre counts below are
  keyed on it. A load rewrites rows for minutes, and on 2026-11-05 an answer
  cached halfway through one (8,800 titles of 20,065) went on being served
  for the cache's full hour. Keyed on the revision, whatever was cached during
  a load is left behind the moment its stamp lands. Each isolate reads the
  stamp at most once a minute, so a finished load reaches every answer within
  a minute.
*/
const REVISION_TTL_MS = 60_000;
let revisionMemo: { at: number; revision: string } | null = null;

/**
 * The stamp, or "" when there is none (no load has stamped this database, or
 * it was loaded before the table existed). Null when it could not be read: the
 * caller then does without the cache rather than file an answer under a guess.
 */
async function loadRevision(): Promise<string | null> {
  if (revisionMemo && Date.now() - revisionMemo.at < REVISION_TTL_MS) return revisionMemo.revision;
  if (!getD1()) return null;
  let revision = "";
  try {
    const [row] = await all(revisionStatement());
    revision = String(row?.["value"] ?? "");
  } catch (error) {
    if (!isMissingTable(error)) return null;
  }
  revisionMemo = { at: Date.now(), revision };
  return revision;
}

/*
  The genre counts change only when the loader runs, and they are the same for
  every page and every filter — so one isolate asks once per quarter hour, or
  as soon as the load's revision changes, rather than once per cache miss
  (each ask reads every genre row).
*/
const FACETS_TTL_MS = 15 * 60_000;
let facetsMemo: { at: number; revision: string; facets: GamesDbFacet[] } | null = null;

async function genreFacets(): Promise<GamesDbFacet[]> {
  const revision = await loadRevision();
  if (
    revision !== null &&
    facetsMemo !== null &&
    facetsMemo.revision === revision &&
    Date.now() - facetsMemo.at < FACETS_TTL_MS
  ) {
    return facetsMemo.facets;
  }
  const facets = toFacets(await all(facetsStatement()));
  if (facets.length && revision !== null) facetsMemo = { at: Date.now(), revision, facets };
  return facets;
}

let loadedSeen = false;
async function anyTitle(): Promise<boolean> {
  if (loadedSeen) return true;
  loadedSeen = (await all(anyTitleStatement())).length > 0;
  return loadedSeen;
}

/** Test seam: forget what this isolate remembers between requests. */
export function resetGamesDbMemo(): void {
  revisionMemo = null;
  facetsMemo = null;
  loadedSeen = false;
}

const notReadyList = (query: GamesDbQuery): GamesDbListResponse => ({
  ready: false,
  items: [],
  total: 0,
  page: query.page,
  pages: 0,
  pageSize: GAMES_DB_PAGE_SIZE,
  genres: [],
});

export async function listGamesDb(query: GamesDbQuery): Promise<GamesDbListResponse> {
  if (!getD1()) return notReadyList(query);
  try {
    const [rows, genres] = await Promise.all([all(listStatement(query)), genreFacets()]);
    let total = Number(rows[0]?.["total_rows"] ?? 0);
    if (!rows.length && query.page > 1) {
      total = Number((await all(countStatement(query)))[0]?.["n"] ?? 0);
    }
    const ready = total > 0 || (await anyTitle());
    if (!ready) return notReadyList(query);
    return {
      ready: true,
      items: rows.map(toListItem),
      total,
      page: query.page,
      pages: Math.ceil(total / GAMES_DB_PAGE_SIZE),
      pageSize: GAMES_DB_PAGE_SIZE,
      genres,
    };
  } catch (error) {
    if (isMissingTable(error)) return notReadyList(query);
    throw error;
  }
}

export async function getGamesDbTitle(slug: string): Promise<GamesDbTitleResponse> {
  if (!getD1()) return { ready: false, title: null, shopPath: null };
  try {
    const [row] = await all(titleStatement(slug));
    if (!row) return { ready: await anyTitle(), title: null, shopPath: null };
    return {
      ready: true,
      title: toTitle(row),
      shopPath: row["shop_id"] ? shopPathFor(row["shop_slug"], row["shop_id"]) : null,
    };
  } catch (error) {
    if (isMissingTable(error)) return { ready: false, title: null, shopPath: null };
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* The edge cache                                                      */
/* ------------------------------------------------------------------ */

/**
 * The Worker's shared cache (`caches.default`, a Cloudflare extension the DOM
 * types do not name). A Worker's own responses are not cached by Cloudflare's
 * CDN on their own — the Worker runs in front of it — so «edge-cacheable»
 * means putting the answer here explicitly. Undefined outside a Worker: the
 * test runner and a local Node process simply build every answer.
 */
type EdgeCache = {
  match: (request: Request) => Promise<Response | undefined>;
  put: (request: Request, response: Response) => Promise<void>;
};
const edgeCache = (): EdgeCache | undefined =>
  (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;

/** Bumped when the shape of an answer changes, so no edge holds the old one. */
export const GAMES_DB_CACHE_VERSION = "v1";

/** An hour at the edge, five minutes in the browser: the rows change only when the loader runs. */
export const GAMES_DB_CACHE_CONTROL = "public, max-age=300, s-maxage=3600";

/**
 * Where an answer is kept at the edge: the answers' version, the load's
 * revision ("0" before any stamp), then the validated filters (`keyPath`) —
 * never the raw URL, so `?page=1&q=Zelda` and `?q=zelda` share one entry and
 * a made-up parameter cannot mint a new one.
 */
export function edgeCacheUrl(requestUrl: string, revision: string, keyPath: string): string {
  const origin = new URL(requestUrl).origin;
  return `${origin}/__edge/games-db/${GAMES_DB_CACHE_VERSION}/${encodeURIComponent(revision || "0")}/${keyPath}`;
}

/**
 * A JSON answer, served from the edge when it is there and stored there when
 * it may be, at `edgeCacheUrl`. When the load's revision cannot be read, the
 * answer is built and sent without the edge cache.
 */
export async function cachedJson(
  request: Request,
  keyPath: string,
  build: () => Promise<{ body: unknown; status?: number; cacheable: boolean }>,
): Promise<Response> {
  const cache = edgeCache();
  const revision = cache ? await loadRevision() : null;
  const key =
    cache && revision !== null
      ? new Request(edgeCacheUrl(request.url, revision, keyPath), { method: "GET" })
      : null;
  if (cache && key) {
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set("x-cache-status", "edge-hit");
      /*
        Cloudflare hands a stored answer back with its max-age raised to the
        zone's Browser Cache TTL (4 hours on 2026-11-05), so every edge hit
        told browsers to keep it for 4 hours, past the next load. Restated
        here, the browser keeps it for 5 minutes, like a fresh answer.
      */
      headers.set("cache-control", GAMES_DB_CACHE_CONTROL);
      return new Response(hit.body, { status: hit.status, headers });
    }
  }
  const { body, status = 200, cacheable } = await build();
  const response = new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheable ? GAMES_DB_CACHE_CONTROL : "no-store",
      "x-cache-status": "fresh",
    },
  });
  if (cache && key && cacheable) await cache.put(key, response.clone()).catch(() => undefined);
  return response;
}
