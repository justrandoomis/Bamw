/**
 * The games database's statements, and the rows they return turned into what
 * the API answers.
 *
 * Pure — no D1, no Worker — so the statements can be run against a real
 * SQLite in tests, exactly as written (`src/lib/games-db.test.ts`). The part
 * that talks to D1 is `games-db.server.ts`.
 *
 * Every statement has a fixed ceiling of bound parameters, set in the source:
 * the console filter is two, the genre one, «coming soon» one, the query at
 * most GAMES_DB_MAX_TOKENS, the relevance order three, the release order one,
 * the page two — sixteen at most, against D1's hundred.
 */
import {
  GAMES_DB_PAGE_SIZE,
  GAMES_DB_REVISION_KEY,
  euIdFromSlug,
  genreLabel,
  imageOrEmpty,
  isGamesDbPlatform,
  parseGamesDbDetails,
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

export interface GamesDbStatementOptions {
  /**
   * The Nintendo genres a shop genre (`query.shopGenre`) widened to, worked
   * out by the server from the genres the table holds. An empty list is a
   * shop genre no Nintendo genre folds into: it matches nothing. Null: the
   * query names no shop genre.
   */
  genreIds?: string[] | null;
  /**
   * Whether `nintendo_title_details` can be read. It is created by the first
   * load that writes it; before that, «popular» orders like «new» and a
   * title has no details.
   */
  details?: boolean;
}

/** Most Nintendo genres one shop genre widens to (sports: six). A ceiling on bound parameters. */
const MAX_GENRE_IDS = 12;

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

/**
 * Today as the stored dates spell it: the line between released and upcoming.
 * A parameter rather than SQLite's `date('now')`, so a test can fix the day.
 */
export const todayIso = (now: Date = new Date()) => now.toISOString().slice(0, 10);

/** The filters every list and count share. */
function filters(
  query: GamesDbQuery,
  today: string,
  genreIds: string[] | null = null,
): { where: string; binds: string[] } {
  const clauses: string[] = [];
  const binds: string[] = [];
  if (query.shop === "exclude") {
    // The titles the shop does not sell live: SHOP_JOIN found no product.
    clauses.push("p.id IS NULL");
  }
  if (genreIds) {
    const ids = genreIds.slice(0, MAX_GENRE_IDS);
    if (ids.length) {
      clauses.push(
        `t.eu_id IN (SELECT g.eu_id FROM nintendo_title_genres g WHERE g.genre IN (${ids.map(() => "?").join(", ")}))`,
      );
      binds.push(...ids);
    } else {
      clauses.push("0 = 1");
    }
  }
  if (query.sort === "soon") {
    // Only the games still to come. A game with no date is not «soon»: nobody announced when.
    clauses.push("t.release_date > ?");
    binds.push(today);
  }
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
 * start with it, then the ones with a word that starts with it. Then:
 *
 *   - «new»: games already out, newest first — then the ones still to come,
 *     then the undated. Upcoming games first would have opened the database on
 *     three pages of 2027 releases nobody can play yet; they have «soon».
 *   - «soon»: only the games still to come, soonest first.
 *   - «az»: everything by name.
 *   - «popular»: Nintendo's downloads rank, most downloaded first; the
 *     unranked half after them, in the «new» order.
 */
export function listStatement(
  query: GamesDbQuery,
  today: string = todayIso(),
  options: GamesDbStatementOptions = {},
): GamesDbStatement {
  const { where, binds } = filters(query, today, options.genreIds ?? null);
  const popular = query.sort === "popular" && options.details !== false;
  const order: string[] = [];
  const orderBinds: string[] = [];
  if (query.tokens.length) {
    const phrase = query.tokens.join(" ");
    order.push(
      "CASE WHEN t.norm_title = ? THEN 0 WHEN t.norm_title LIKE ? THEN 1 WHEN t.norm_title LIKE ? THEN 2 ELSE 3 END",
    );
    orderBinds.push(phrase, `${phrase}%`, `% ${phrase}%`);
  }
  if (query.sort === "az") {
    order.push("t.norm_title", "t.eu_id");
  } else if (query.sort === "soon") {
    order.push("t.release_date", "t.norm_title", "t.eu_id");
  } else {
    if (popular) {
      order.push("CASE WHEN COALESCE(d.downloads_rank, 0) > 0 THEN 0 ELSE 1 END", "d.downloads_rank");
    }
    order.push(
      "CASE WHEN t.release_date = '' THEN 2 WHEN t.release_date > ? THEN 1 ELSE 0 END",
      "t.release_date DESC",
      "t.norm_title",
      "t.eu_id",
    );
    orderBinds.push(today);
  }
  const sql = `SELECT t.slug, t.title, t.platform, t.release_date, t.publisher, t.genres, t.image_square,
       t.delisted, p.id AS shop_id, p.slug AS shop_slug, COUNT(*) OVER () AS total_rows
  FROM nintendo_titles t
  ${SHOP_JOIN}
  ${popular ? "LEFT JOIN nintendo_title_details d ON d.eu_id = t.eu_id" : ""}
  ${where}
 ORDER BY ${order.join(", ")}
 LIMIT ? OFFSET ?`;
  return {
    sql,
    binds: [...binds, ...orderBinds, GAMES_DB_PAGE_SIZE, (query.page - 1) * GAMES_DB_PAGE_SIZE],
  };
}

/** The total alone — only needed for a page past the end, where the window has no row to ride on. */
export function countStatement(
  query: GamesDbQuery,
  today: string = todayIso(),
  options: GamesDbStatementOptions = {},
): GamesDbStatement {
  const { where, binds } = filters(query, today, options.genreIds ?? null);
  // «Not in the shop» is decided by the product join, so the count needs it too.
  const join = query.shop === "exclude" ? SHOP_JOIN : "";
  return { sql: `SELECT COUNT(*) AS n FROM nintendo_titles t ${join} ${where}`, binds };
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

/** The stamp the last finished load left (`GAMES_DB_REVISION_KEY`): no row before the first. */
export function revisionStatement(): GamesDbStatement {
  return { sql: "SELECT value FROM nintendo_titles_meta WHERE key = ?", binds: [GAMES_DB_REVISION_KEY] };
}

/**
 * One title by its address. The whole slug first; failing that, the id it ends
 * in, so a link made before Nintendo renamed the game still arrives.
 */
export function titleStatement(slug: string, options: GamesDbStatementOptions = {}): GamesDbStatement {
  const wanted = String(slug ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 160);
  const details = options.details !== false;
  return {
    sql: `SELECT t.*, p.id AS shop_id, p.slug AS shop_slug${details ? ", d.downloads_rank AS downloads_rank, d.details AS details" : ""}
  FROM nintendo_titles t
  ${SHOP_JOIN}
  ${details ? "LEFT JOIN nintendo_title_details d ON d.eu_id = t.eu_id" : ""}
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
    downloadsRank: Math.max(0, Math.floor(Number(row["downloads_rank"] ?? 0)) || 0),
    details: parseGamesDbDetails(row["details"]),
  };
}

export function toFacets(rows: Row[]): GamesDbFacet[] {
  return rows
    .map((row) => ({ id: str(row["genre"]), count: Number(row["n"] ?? 0) }))
    .filter((facet) => facet.id && facet.count > 0)
    .map((facet) => ({ ...facet, label: genreLabel(facet.id) }));
}
