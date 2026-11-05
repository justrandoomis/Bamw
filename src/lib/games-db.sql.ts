/**
 * The games database's statements, and the rows they return turned into what
 * the API answers.
 *
 * Pure — no D1, no Worker — so the statements can be run against a real
 * SQLite in tests, exactly as written (`src/lib/games-db.test.ts`). The part
 * that talks to D1 is `games-db.server.ts`.
 *
 * Every statement has a fixed ceiling of bound parameters, set in the source:
 * the console filter is two, the genre one, the query at most
 * GAMES_DB_MAX_TOKENS, the relevance order three, the page two — fourteen at
 * most, against D1's hundred.
 */
import {
  GAMES_DB_PAGE_SIZE,
  euIdFromSlug,
  genreLabel,
  imageOrEmpty,
  isGamesDbPlatform,
  platformsFor,
  shopPathFor,
  splitLanguages,
  type GamesDbFacet,
  type GamesDbListItem,
  type GamesDbQuery,
  type GamesDbTitle,
} from "./games-db.ts";

export interface GamesDbStatement {
  sql: string;
  binds: (string | number)[];
}

/**
 * The shop's product for a title — only while a customer can still buy it.
 *
 * `shop_product_id` was right when the loader ran; this re-checks it against
 * `product_index`, the catalogue's own projection, on every read. A product
 * hidden, unpriced or switched off since then simply stops matching, and the
 * page offers the request button instead of a link to a page that cannot sell.
 * The status words are the ones `isVisibleToPublic` and `isProductHidden`
 * refuse (`src/lib/purchasable.ts`).
 */
const SHOP_JOIN = `LEFT JOIN product_index p
    ON t.shop_product_id <> ''
   AND p.id = t.shop_product_id
   AND p.hidden = 0
   AND COALESCE(p.price, 0) > 0
   AND lower(trim(p.status)) NOT IN ('inactive', 'disabled', 'draft', 'hidden', 'deleted', 'غير نشط', 'موقوف', 'مخفي', 'محذوف')`;

/** The filters every list and count share. */
function filters(query: GamesDbQuery): { where: string; binds: string[] } {
  const clauses: string[] = [];
  const binds: string[] = [];
  const platforms = platformsFor(query.platform);
  if (platforms.length === 2) {
    clauses.push("t.platform IN (?, ?)");
    binds.push(platforms[0]!, platforms[1]!);
  }
  if (query.genre) {
    // The genre table's primary key leads with the genre: an index lookup.
    clauses.push("t.eu_id IN (SELECT g.eu_id FROM nintendo_title_genres g WHERE g.genre = ?)");
    binds.push(query.genre);
  }
  // Every word must appear. Folded words hold only letters and digits, so no
  // `%` or `_` of the visitor's can reach the pattern.
  for (const token of query.tokens) {
    clauses.push("t.norm_title LIKE ?");
    binds.push(`%${token}%`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", binds };
}

/**
 * One page of titles, and how many there are in all (`total_rows`, a window
 * over the filtered set — one statement where a separate count would be two).
 *
 * With a query, the title that IS the query comes first, then the ones that
 * start with it, then the ones with a word that starts with it. Otherwise
 * newest first — upcoming games at the top — or A to Z.
 */
export function listStatement(query: GamesDbQuery): GamesDbStatement {
  const { where, binds } = filters(query);
  const order: string[] = [];
  const orderBinds: string[] = [];
  if (query.tokens.length) {
    const phrase = query.tokens.join(" ");
    order.push(
      "CASE WHEN t.norm_title = ? THEN 0 WHEN t.norm_title LIKE ? THEN 1 WHEN t.norm_title LIKE ? THEN 2 ELSE 3 END",
    );
    orderBinds.push(phrase, `${phrase}%`, `% ${phrase}%`);
  }
  if (query.sort === "az") order.push("t.norm_title", "t.eu_id");
  else order.push("t.release_date = ''", "t.release_date DESC", "t.norm_title", "t.eu_id");
  const sql = `SELECT t.slug, t.title, t.platform, t.release_date, t.publisher, t.genres, t.image_square,
       t.delisted, p.id AS shop_id, p.slug AS shop_slug, COUNT(*) OVER () AS total_rows
  FROM nintendo_titles t
  ${SHOP_JOIN}
  ${where}
 ORDER BY ${order.join(", ")}
 LIMIT ? OFFSET ?`;
  return {
    sql,
    binds: [...binds, ...orderBinds, GAMES_DB_PAGE_SIZE, (query.page - 1) * GAMES_DB_PAGE_SIZE],
  };
}

/** The total alone — only needed for a page past the end, where the window has no row to ride on. */
export function countStatement(query: GamesDbQuery): GamesDbStatement {
  const { where, binds } = filters(query);
  return { sql: `SELECT COUNT(*) AS n FROM nintendo_titles t ${where}`, binds };
}

/** Every genre and how many titles carry it, largest first. */
export function facetsStatement(): GamesDbStatement {
  return {
    sql: "SELECT genre, COUNT(*) AS n FROM nintendo_title_genres GROUP BY genre ORDER BY n DESC, genre LIMIT 60",
    binds: [],
  };
}

/** Whether the loader has written anything yet. */
export function anyTitleStatement(): GamesDbStatement {
  return { sql: "SELECT 1 AS present FROM nintendo_titles LIMIT 1", binds: [] };
}

/**
 * One title by its address. The whole slug first; failing that, the id it ends
 * in, so a link made before Nintendo renamed the game still arrives.
 */
export function titleStatement(slug: string): GamesDbStatement {
  const wanted = String(slug ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 160);
  return {
    sql: `SELECT t.*, p.id AS shop_id, p.slug AS shop_slug
  FROM nintendo_titles t
  ${SHOP_JOIN}
 WHERE t.slug = ? OR t.eu_id = ?
 ORDER BY t.slug = ? DESC
 LIMIT 1`,
    binds: [wanted, euIdFromSlug(wanted) || wanted, wanted],
  };
}

/* ------------------------------------------------------------------ */
/* Rows → answers                                                      */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));

function list(value: unknown): string[] {
  try {
    const parsed = JSON.parse(str(value) || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function toListItem(row: Row): GamesDbListItem {
  const platform = str(row["platform"]);
  return {
    slug: str(row["slug"]),
    title: str(row["title"]),
    platform: isGamesDbPlatform(platform) ? platform : "switch1",
    releaseDate: str(row["release_date"]),
    publisher: str(row["publisher"]),
    genres: list(row["genres"]),
    image: imageOrEmpty(row["image_square"]),
    shopPath: row["shop_id"] ? shopPathFor(row["shop_slug"], row["shop_id"]) : null,
    delisted: Number(row["delisted"] ?? 0) === 1,
  };
}

export function toTitle(row: Row): GamesDbTitle {
  const platform = str(row["platform"]);
  return {
    euId: str(row["eu_id"]),
    slug: str(row["slug"]),
    title: str(row["title"]),
    platform: isGamesDbPlatform(platform) ? platform : "switch1",
    releaseDate: str(row["release_date"]),
    publisher: str(row["publisher"]),
    developer: str(row["developer"]),
    description: str(row["description"]),
    genres: list(row["genres"]),
    series: list(row["series"]),
    ageRating: str(row["age_rating"]),
    players: str(row["players"]),
    languages: splitLanguages(row["languages"]),
    size: str(row["size"]),
    nsuid: str(row["nsuid"]),
    productCode: str(row["product_code"]),
    physical: Number(row["physical"] ?? 0) === 1,
    digital: Number(row["digital"] ?? 0) === 1,
    delisted: Number(row["delisted"] ?? 0) === 1,
    images: {
      box: imageOrEmpty(row["image_box"]),
      square: imageOrEmpty(row["image_square"]),
      wide: imageOrEmpty(row["image_wide"]),
    },
    euUrl: imageOrEmpty(row["eu_url"]),
  };
}

export function toFacets(rows: Row[]): GamesDbFacet[] {
  return rows
    .map((row) => ({ id: str(row["genre"]), count: Number(row["n"] ?? 0) }))
    .filter((facet) => facet.id && facet.count > 0)
    .map((facet) => ({ ...facet, label: genreLabel(facet.id) }));
}
