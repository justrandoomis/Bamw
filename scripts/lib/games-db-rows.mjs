/**
 * The games database loader's decisions, apart from the loader so they can be
 * tested without Nintendo or Cloudflare: which product a title links to, what
 * its row holds, which rows need writing, and the statements that write them.
 *
 * ## HOW A ROW IS WRITTEN
 *
 * D1 over REST runs each statement on its own — there is no transaction across
 * them — and refuses more than 100 bound parameters in one. So a batch of rows
 * travels as ONE parameter: a JSON array, unpacked by `json_each` inside a
 * single `INSERT OR REPLACE … SELECT`. One statement is atomic in SQLite, so a
 * reader sees all of a batch or none of it, and the parameter count is one
 * however many rows the batch holds.
 *
 * Per batch, the genres are written first and the title rows last. The title
 * row carries `content_hash`, and a second load skips a row whose hash already
 * matches — so the hash has to be the last thing to land. A load that stops
 * between the two leaves the title on its old hash, and the next load writes
 * that batch again. The other order would leave a title marked done with its
 * genres missing, and nothing would ever come back for them.
 */
import { createHash } from "node:crypto";

import { foldTitle, genreId, slugFor } from "../../src/lib/games-db.ts";
import { indexMaps, matchProduct } from "./nintendo-eu-index.mjs";

/** The table's columns, in the order every statement and every row array uses. */
export const COLUMNS = [
  "eu_id",
  "slug",
  "title",
  "norm_title",
  "platform",
  "release_date",
  "publisher",
  "developer",
  "description",
  "genres",
  "series",
  "age_rating",
  "players",
  "languages",
  "size",
  "nsuid",
  "product_code",
  "physical",
  "digital",
  "delisted",
  "image_box",
  "image_square",
  "image_wide",
  "eu_url",
  "shop_product_id",
  "content_hash",
  "loaded_at",
];

/** The columns the digest covers: everything except the digest and the clock. */
const HASHED = COLUMNS.filter((c) => c !== "content_hash" && c !== "loaded_at");

/**
 * Rows per statement. A row is about 1.2 KB of JSON, so a batch is about
 * 120 KB — far under D1's 2 MB value limit, and small enough that a failure
 * costs one batch.
 */
export const BATCH_ROWS = 100;

/**
 * Fewer titles than this from Nintendo is a broken answer, not a smaller
 * catalogue: the index has held about twenty thousand since Switch 2 launched.
 * An apply refuses to run on less.
 */
export const MIN_INDEX_TITLES = 15000;

const PLATFORMS = new Set(["switch1", "switch2", "both"]);

/**
 * Nintendo files a game with no announced date as 2050-12-31 (nine titles on
 * 2026-11-05). Stored, that would put them at the top of «newest first» and
 * print a date nobody announced, so a date this far out is stored as none.
 */
export const PLACEHOLDER_DATE_FROM = "2045-01-01";

/** Text safe to store: well-formed, no control characters, bounded. */
export function text(value, max = 500) {
  const raw = String(value ?? "");
  const wellFormed = typeof raw.toWellFormed === "function" ? raw.toWellFormed() : raw;
  return wellFormed
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

const url = (value) => {
  const s = text(value, 600);
  return /^https:\/\//i.test(s) ? s : "";
};

/**
 * Which product each Nintendo title is, for the titles the shop sells.
 *
 * Only products a customer can buy are offered (`isSellable`): linking a
 * hidden or unpriced product would send the visitor to a page that cannot
 * sell them the game, in place of the request button that could. When two
 * products are the same title, the stronger match wins — a store link over an
 * nsuid over a title — and on a tie the one listed first.
 *
 * Returns Map(euId → { productId, how }).
 */
export function linkShopProducts(index, products, { isSellable = () => true } = {}) {
  const maps = indexMaps(index);
  const rank = { "store-link": 0, nsuid: 1, title: 2 };
  const links = new Map();
  for (const product of products ?? []) {
    if (!product || !product.id || !isSellable(product)) continue;
    const match = matchProduct(product, maps);
    if (!match?.game?.euId) continue;
    const previous = links.get(match.game.euId);
    if (!previous || rank[match.how] < rank[previous.how]) {
      links.set(match.game.euId, { productId: String(product.id), how: match.how });
    }
  }
  return links;
}

/** A digest of the stored facts, so an unchanged title is not written again. */
export function contentHash(row) {
  const hash = createHash("sha256");
  for (const column of HASHED) hash.update(`${column}\u0000${row[column]}\u0001`);
  return hash.digest("hex").slice(0, 32);
}

/**
 * One Nintendo title as a row, or null when it cannot be keyed (no id or no
 * name). Every value is a string or 0/1, never null, so a JSON round trip
 * through `json_each` gives back exactly what was sent.
 */
export function toRow(facts, link, loadedAt) {
  // Lowercase, so the key is exactly the id the slug ends in (`slugFor`).
  const euId = text(facts?.euId, 40)
    .toLowerCase()
    .replace(/[^0-9a-z]/g, "");
  const title = text(facts?.title, 300);
  if (!euId || !title) return null;
  const list = (values, max) =>
    JSON.stringify(
      (Array.isArray(values) ? values : [])
        .map((v) => text(v, 80))
        .filter(Boolean)
        .slice(0, max),
    );
  const releaseDate = text(facts.releaseDate, 10);
  const row = {
    eu_id: euId,
    slug: slugFor(title, euId),
    title,
    norm_title: foldTitle(title),
    platform: PLATFORMS.has(facts.platform) ? facts.platform : "switch1",
    release_date:
      /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) && releaseDate < PLACEHOLDER_DATE_FROM ? releaseDate : "",
    publisher: text(facts.publisher, 200),
    developer: text(facts.developer, 200),
    description: text(facts.description, 2000),
    genres: list(facts.genres, 8),
    series: list(facts.series, 8),
    age_rating: text(facts.ageRating, 40),
    players: text(facts.numberOfPlayers, 20),
    languages: text(facts.supportedLanguages, 600),
    size: text(facts.size, 40),
    nsuid: text(facts.nsuid, 40),
    product_code: text(facts.productCode, 40),
    physical: facts.physical ? 1 : 0,
    digital: facts.digital ? 1 : 0,
    delisted: facts.delisted ? 1 : 0,
    image_box: url(facts.images?.frontBox),
    image_square: url(facts.images?.square),
    image_wide: url(facts.images?.wide),
    eu_url: url(facts.euUrl),
    shop_product_id: text(link?.productId, 120),
  };
  row.content_hash = contentHash(row);
  row.loaded_at = loadedAt;
  return row;
}

/**
 * Every title as a row, one row per Nintendo id. A title that appears twice —
 * an index that shifted while it was being paged — keeps its later copy.
 */
export function rowsFor(index, links, loadedAt) {
  const byId = new Map();
  for (const facts of index ?? []) {
    const row = toRow(facts, links?.get(String(facts?.euId ?? "")), loadedAt);
    if (row) byId.set(row.eu_id, row);
  }
  return [...byId.values()];
}

/**
 * Which rows to write: new ones and changed ones. `existing` is
 * Map(eu_id → content_hash) as the table holds it now. Titles the table has
 * and Nintendo no longer lists are counted, never deleted — a game Nintendo
 * stopped listing is still a game somebody may look up.
 */
export function planWrites(rows, existing) {
  const toWrite = [];
  let fresh = 0;
  let changed = 0;
  let unchanged = 0;
  const seen = new Set();
  for (const row of rows) {
    seen.add(row.eu_id);
    const stored = existing.get(row.eu_id);
    if (stored === undefined) {
      fresh += 1;
      toWrite.push(row);
    } else if (stored !== row.content_hash) {
      changed += 1;
      toWrite.push(row);
    } else {
      unchanged += 1;
    }
  }
  let notInIndex = 0;
  for (const id of existing.keys()) if (!seen.has(id)) notInIndex += 1;
  return { toWrite, fresh, changed, unchanged, notInIndex };
}

export function chunk(list, size = BATCH_ROWS) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** [genre id, eu_id] for every genre of every row, once each. */
export function genrePairs(rows) {
  const pairs = new Map();
  for (const row of rows) {
    let names = [];
    try {
      names = JSON.parse(row.genres);
    } catch {
      names = [];
    }
    for (const name of Array.isArray(names) ? names : []) {
      const id = genreId(name);
      if (id) pairs.set(`${id}\u0000${row.eu_id}`, [id, row.eu_id]);
    }
  }
  return [...pairs.values()];
}

const PICK = COLUMNS.map((_, i) => `json_extract(value, '$[${i}]')`).join(", ");

/** The batch's title rows, in one statement with one parameter. Written last. */
export function upsertTitlesStatement(rows) {
  return {
    sql: `INSERT OR REPLACE INTO nintendo_titles (${COLUMNS.join(", ")}) SELECT ${PICK} FROM json_each(?)`,
    params: [JSON.stringify(rows.map((row) => COLUMNS.map((column) => row[column])))],
  };
}

/** The batch's genres, added. Written first. */
export function insertGenresStatement(rows) {
  return {
    sql:
      "INSERT OR IGNORE INTO nintendo_title_genres (genre, eu_id) " +
      "SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)",
    params: [JSON.stringify(genrePairs(rows))],
  };
}

/**
 * The genres a batch's titles no longer have, removed — after the new ones are
 * in, so a load that stops between the two leaves a title with a genre too
 * many for one run rather than with none.
 */
export function pruneGenresStatement(rows) {
  return {
    sql:
      "DELETE FROM nintendo_title_genres WHERE eu_id IN (SELECT value FROM json_each(?)) " +
      "AND NOT EXISTS (SELECT 1 FROM json_each(?) AS keep " +
      "WHERE json_extract(keep.value, '$[0]') = nintendo_title_genres.genre " +
      "AND json_extract(keep.value, '$[1]') = nintendo_title_genres.eu_id)",
    params: [JSON.stringify(rows.map((row) => row.eu_id)), JSON.stringify(genrePairs(rows))],
  };
}

/**
 * A migration file as statements: comments removed, split on the semicolons
 * that end statements. Quotes are tracked so a `'--'` or a `';'` inside a
 * string literal is left where it is.
 */
export function migrationStatements(sql) {
  const statements = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (quoted) {
      current += char;
      if (char === "'") quoted = false;
      continue;
    }
    if (char === "'") {
      quoted = true;
      current += char;
      continue;
    }
    if (char === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      current += "\n";
      continue;
    }
    if (char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

/** What the index holds, for the report: counts and nothing private. */
export function describeRows(rows) {
  const byPlatform = { switch1: 0, switch2: 0, both: 0 };
  const genres = new Map();
  let withBox = 0;
  let withSquare = 0;
  let withWide = 0;
  let withoutPicture = 0;
  let delisted = 0;
  let linked = 0;
  let undated = 0;
  let newest = "";
  let oldest = "";
  for (const row of rows) {
    byPlatform[row.platform] = (byPlatform[row.platform] ?? 0) + 1;
    if (row.image_box) withBox += 1;
    if (row.image_square) withSquare += 1;
    if (row.image_wide) withWide += 1;
    if (!row.image_box && !row.image_square && !row.image_wide) withoutPicture += 1;
    if (row.delisted) delisted += 1;
    if (row.shop_product_id) linked += 1;
    if (!row.release_date) undated += 1;
    else {
      if (!newest || row.release_date > newest) newest = row.release_date;
      if (!oldest || row.release_date < oldest) oldest = row.release_date;
    }
  }
  for (const [id] of genrePairs(rows)) genres.set(id, (genres.get(id) ?? 0) + 1);
  return {
    titles: rows.length,
    byPlatform,
    withBox,
    withSquare,
    withWide,
    withoutPicture,
    delisted,
    linked,
    undated,
    oldest,
    newest,
    genres: [...genres.entries()].sort((a, b) => b[1] - a[1]),
  };
}
