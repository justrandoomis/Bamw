/**
 * The admin products table, as a real D1 query.
 *
 * ## Why this table exists
 *
 * There is no relational `products` table in this database. The catalogue lives
 * in `store_kv` as one JSON document, split into `store:products#NNN` chunks
 * (400 KB each) plus per-product `store:product:<id>` overlay rows. Reading one
 * product therefore meant reading *all* of them:
 *
 *     SELECT key, value FROM store_kv
 *      WHERE key = 'store' OR key LIKE 'store:%' OR key LIKE 'analytics:%'
 *
 * …then joining the chunks, `JSON.parse`-ing several megabytes, validating and
 * normalising every product, and merging the granular overlays into the base
 * array. That is what `/api/admin/products` was doing to render fifteen rows,
 * and it is where the twenty seconds went.
 *
 * Rewriting the catalogue into relational tables would be a migration that
 * touches every product, every order line and every relation — far too much
 * risk for a slow list. So this is a **projection**: a narrow, indexed table
 * carrying only what the table renders, derived from the document and rebuilt
 * from it. `store_kv` stays the source of truth; nothing here can lose data,
 * and dropping this table costs one rebuild.
 *
 * ## Keeping it true
 *
 * `persistStore` writes the projection in the same D1 batch as the catalogue,
 * so the index cannot commit without the products it describes, and it carries
 * the `rev` it was written at. A read that finds the table empty while the
 * document has products rebuilds it from the products rows alone — the one
 * remaining slow path, taken once.
 */

import { d1All, d1BatchRun, d1First } from "./d1.server";
import { assertBoundParameters, chunkForParams } from "./sql-params";
import { requiresPerformanceReview } from "./devicePerformance";
import { categoryFilterAliases, isGameProduct } from "./productSection";
import { lastModifiedAt, sortableName, sortableNameKey, type ProductSort } from "./productSort";
import { isProductHidden } from "./purchasable";

type Row = Record<string, unknown>;

/**
 * A listing row. Deliberately the columns the table draws and nothing else —
 * adding `description` here would put the payload back where it started.
 */
export interface ProductIndexRow {
  id: string;
  slug: string;
  title: string;
  titleEn: string;
  category: string;
  categoryId: string;
  kind: string;
  schemaId: string;
  platform: string;
  price: number | null;
  cost: number | null;
  stock: number | null;
  isInfiniteStock: boolean;
  isHidden: boolean;
  status: string;
  sales: number;
  image: string;
  displayOrder: number;
  updatedAt: string;
  createdAt: string;
  releaseDate: string;
  /** A Switch 2 game whose performance data is still incomplete. */
  performanceRequired: boolean;
}

export interface ProductIndexFacets {
  hidden: number;
  unpriced: number;
  performanceRequired: number;
}

export interface ProductIndexPage {
  items: ProductIndexRow[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  /*
    Counts over the whole catalogue, not the page. The filter chips show these,
    and computing them from the loaded rows would have made "المخفية (0)" mean
    "none on this page" — which is worse than no number at all.
  */
  facets: ProductIndexFacets;
}

export interface ProductIndexQuery {
  page?: number;
  limit?: number;
  sort?: ProductSort;
  /** Free text, matched against the folded title/slug key. */
  search?: string;
  categoryId?: string;
  /** `true` → only hidden rows, `false` → only visible, undefined → all. */
  hidden?: boolean;
  onlyUnpriced?: boolean;
  performanceRequired?: boolean;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const numberOrNull = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * The one image the table shows.
 *
 * A thumbnail chain, never a banner or a screenshot — the admin row should look
 * like the product, and picking a different field here from the storefront's is
 * how the same product ended up with two faces.
 */
function listingImage(product: Row): string {
  for (const field of [
    "listingImage",
    "cartridgeImage",
    "mainImage",
    "image",
    "coverImage",
    "frontImage",
    "imageUrl",
  ]) {
    const value = product[field];
    if (typeof value === "string" && value.trim().length > 3) return value.trim();
  }
  return "";
}

/** Projects one catalogue product onto its listing row. */
export function toIndexRow(product: Row): ProductIndexRow {
  const id = text(product["id"]) || String(product["id"] ?? "");
  const title = text(product["title"]);
  const titleEn = text(product["titleEn"]) || text(product["english_name"]);
  const isLegacyGiftCard = Boolean(
    text(product["cardValue"]) ||
    text(product["card_value"]) ||
    text(product["cardCurrency"]) ||
    text(product["card_currency"]),
  );
  return {
    id,
    slug: text(product["slug"]) || id,
    title: title || titleEn || id,
    titleEn: titleEn || title || id,
    category: text(product["category"]),
    categoryId: text(product["categoryId"]) || text(product["category"]),
    kind: text(product["kind"]) || (isLegacyGiftCard ? "digital_code" : ""),
    schemaId:
      text(product["schemaId"]) ||
      text(product["schema_id"]) ||
      (isLegacyGiftCard ? "gift_card" : ""),
    platform: text(product["platform"]),
    price: numberOrNull(product["price"]) ?? numberOrNull(product["basePrice"]),
    cost: numberOrNull(product["cost"]),
    stock: numberOrNull(product["stock"]),
    isInfiniteStock: product["isInfiniteStock"] === true,
    isHidden: isProductHidden(product),
    status: text(product["status"]),
    sales: numberOrNull(product["sales"]) ?? 0,
    image: listingImage(product),
    displayOrder: numberOrNull(product["displayOrder"]) ?? 0,
    updatedAt: text(product["updatedAt"]) || text(product["updated_at"]),
    createdAt: text(product["createdAt"]) || text(product["created_at"]),
    releaseDate: text(product["releaseDate"]) || text(product["release_date"]),
    /*
      Computed once at write time. The check walks a game's performance modes,
      so running it per row per request — which is what the browser filter did —
      is work the projection can do once instead.
    */
    performanceRequired: isGameProduct(product) && requiresPerformanceReview(product),
  };
}

/**
 * The sort columns, precomputed at write time.
 *
 * Sorting has to happen in SQL — the endpoint paginates, and sorting a slice is
 * sorting fifteen arbitrary products. `sort_name` is the folded key from
 * `productSort.ts`, so `ORDER BY sort_name` gives the sequence the browser's
 * comparator gives; `sort_updated` is epoch milliseconds so the ordering is
 * numeric rather than string-wise over mixed date spellings.
 */
function sortKeys(product: Row, row: ProductIndexRow) {
  const modified = lastModifiedAt(product);
  const released = Date.parse(row.releaseDate);
  const sortRelease = Number.isFinite(released) ? released : null;
  return {
    sortName: sortableNameKey(sortableName(product)),
    sortUpdated: modified,
    sortRelease,
    /*
      The default ordering's second term, precomputed. Written as a column
      rather than left as `COALESCE(...)` in the ORDER BY because SQLite cannot
      use an index for an expression the index does not declare, and that one
      COALESCE was enough to make the default sort scan the whole table.
    */
    sortRank: sortRelease ?? modified ?? 0,
  };
}

const COLUMNS = [
  "id",
  "slug",
  "title",
  "title_en",
  "category",
  "category_id",
  "kind",
  "schema_id",
  "platform",
  "price",
  "cost",
  "stock",
  "infinite_stock",
  "hidden",
  "status",
  "sales",
  "image",
  "display_order",
  "updated_at",
  "created_at",
  "release_date",
  "sort_name",
  "sort_updated",
  "sort_release",
  "sort_rank",
  "performance_required",
  "rev",
] as const;

function bindsFor(product: Row, rev: number): unknown[] {
  const row = toIndexRow(product);
  const keys = sortKeys(product, row);
  return [
    row.id,
    row.slug,
    row.title,
    row.titleEn,
    row.category,
    row.categoryId,
    row.kind,
    row.schemaId,
    row.platform,
    row.price,
    row.cost,
    row.stock,
    row.isInfiniteStock ? 1 : 0,
    row.isHidden ? 1 : 0,
    row.status,
    row.sales,
    row.image,
    row.displayOrder,
    row.updatedAt,
    row.createdAt,
    row.releaseDate,
    keys.sortName,
    keys.sortUpdated,
    keys.sortRelease,
    keys.sortRank,
    row.performanceRequired ? 1 : 0,
    rev,
  ];
}

/**
 * A short signature of a projected row, so a save can tell what changed.
 *
 * Cheap and order-stable: the values that end up in the table, joined. It is
 * not a cryptographic hash and does not need to be — a collision costs one
 * unnecessary row write, not a wrong row.
 */
function fingerprint(binds: unknown[]): string {
  let hash = 5381;
  const text = binds.slice(0, -1).join("\u0000");
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${hash.toString(36)}:${text.length.toString(36)}`;
}

function insertStatement(group: Row[], rev: number): { sql: string; params: unknown[] } {
  const params = group.flatMap((product) => bindsFor(product, rev));
  assertBoundParameters("product_index.insert", params);
  return {
    sql: `INSERT INTO product_index (${COLUMNS.join(",")}) VALUES ${group
      .map(() => `(${COLUMNS.map(() => "?").join(",")})`)
      .join(",")}`,
    params,
  };
}

/**
 * Statements that bring the projection in line with `products`, for
 * `persistStore` to append to the catalogue's own batch.
 *
 * **Only what changed.** A save edits one product, and `persistStore` rewrites
 * the whole catalogue blob because that is how the document is stored — but the
 * projection is a table, and rewriting four hundred rows to change one is both
 * wasteful and, at D1's 100-variable ceiling, hundreds of statements riding on
 * every save. `current` is what the table already holds, keyed by id with each
 * row's fingerprint; anything whose fingerprint still matches is left alone.
 *
 * Row groups are sized by {@link chunkForParams}, and every statement passes
 * {@link assertBoundParameters} before it leaves this function. The previous
 * version grouped twenty 27-column rows into one INSERT — 540 bound variables,
 * which D1 refused at the hundredth with `too many SQL variables at offset 488`.
 */
export function productIndexStatements(
  products: Row[],
  rev: number,
  current?: Map<string, string>,
): { sql: string; params: unknown[] }[] {
  const statements: { sql: string; params: unknown[] }[] = [];
  const valid = products.filter((p) => text(p?.["id"]));

  if (!current) {
    // No prior state to compare against: replace the table wholesale.
    statements.push({ sql: `DELETE FROM product_index`, params: [] });
    for (const group of chunkForParams(valid, COLUMNS.length)) {
      statements.push(insertStatement(group, rev));
    }
    return statements;
  }

  const changed: Row[] = [];
  const live = new Set<string>();
  for (const product of valid) {
    const id = text(product["id"]);
    live.add(id);
    if (current.get(id) !== fingerprint(bindsFor(product, rev))) changed.push(product);
  }

  const removed = [...current.keys()].filter((id) => !live.has(id));
  // Deletes bind one variable each, so they chunk against the same budget.
  for (const group of chunkForParams(removed, 1)) {
    const params = group;
    assertBoundParameters("product_index.delete", params);
    statements.push({
      sql: `DELETE FROM product_index WHERE id IN (${group.map(() => "?").join(",")})`,
      params,
    });
  }

  for (const group of chunkForParams(changed, COLUMNS.length)) {
    // `INSERT OR REPLACE`, because a changed row already exists.
    const statement = insertStatement(group, rev);
    statements.push({ ...statement, sql: statement.sql.replace(/^INSERT/, "INSERT OR REPLACE") });
  }

  return statements;
}

/**
 * What the projection currently holds: id → fingerprint.
 *
 * One indexed read of two narrow columns. It is what lets a save write one row
 * instead of the whole table.
 */
export async function readProductIndexFingerprints(): Promise<Map<string, string>> {
  const rows = await d1All<Record<string, unknown>>(
    `SELECT ${COLUMNS.filter((c) => c !== "rev").join(",")} FROM product_index`,
  );
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = String(row["id"] ?? "");
    if (!id) continue;
    // Rebuilt from the stored columns in the same order `bindsFor` emits them,
    // minus `rev` — which changes on every save and would make every row look
    // changed.
    map.set(id, fingerprint([...COLUMNS.filter((c) => c !== "rev").map((c) => row[c] ?? null), 0]));
  }
  return map;
}

/** Writes the projection on its own, outside a catalogue save (bootstrap, repair). */
export async function rebuildProductIndex(products: Row[], rev: number): Promise<number> {
  const statements = productIndexStatements(products, rev);
  // Chunked so a very large catalogue does not exceed the batch limit. Note
  // the key: `d1BatchRun` reads `binds`, and passing `params` would run every
  // statement with its placeholders unbound.
  for (let offset = 0; offset < statements.length; offset += 25) {
    await d1BatchRun(
      statements.slice(offset, offset + 25).map(({ sql, params }) => ({ sql, binds: params })),
    );
  }
  return products.filter((p) => text(p?.["id"])).length;
}

export async function productIndexCount(): Promise<number> {
  const row = await d1First<{ n: number }>(`SELECT COUNT(*) AS n FROM product_index`);
  return Number(row?.n ?? 0);
}

/**
 * Brings one product's projection row in line with the document just written.
 *
 * The full-store path writes the projection in the same batch as the
 * catalogue, but a granular `store:product:<id>` save never touched it: an
 * admin could unhide a product, get a success toast, and watch the listing —
 * which reads this table — flip it back to hidden on the next load, because
 * the row still carried the old flags until the next full rebuild.
 *
 * A tombstone deletes the row; anything else is one INSERT OR REPLACE at the
 * catalogue's current revision. Failures are logged and swallowed: a stale
 * projection row is recoverable by the rebuild, a failed save is not.
 */
export async function refreshProductIndexRow(product: Row): Promise<void> {
  const id = text(product?.["id"]);
  if (!id) return;
  try {
    if (product["_deleted"] === true || product["isDeleted"] === true) {
      await d1BatchRun([{ sql: `DELETE FROM product_index WHERE id = ?`, binds: [id] }]);
      return;
    }
    const row = await d1First<{ rev: number | null }>(`SELECT MAX(rev) AS rev FROM store_rev`);
    const rev = Number(row?.rev ?? 0);
    const statement = insertStatement([product], rev);
    await d1BatchRun([
      { sql: statement.sql.replace(/^INSERT/, "INSERT OR REPLACE"), binds: statement.params },
    ]);
  } catch (err) {
    console.warn(`[product_index:row_refresh_failed] id=${id}`, err);
  }
}

/**
 * `ORDER BY` per sort field.
 *
 * Missing values sort last in *both* directions — a product with no price yet
 * is not the cheapest, and reversing the column should not promote it to the
 * top — which is why the null test is a separate leading term rather than
 * relying on SQLite's own null ordering. Every clause ends on `id` so equal
 * rows keep a fixed order and a product cannot appear on two pages or on none.
 */
function orderClause(sort: ProductSort): string {
  const dir = sort.direction === "asc" ? "ASC" : "DESC";
  switch (sort.field) {
    case "price":
      return `price IS NULL, price ${dir}, id ASC`;
    case "updated":
      return `sort_updated IS NULL, sort_updated ${dir}, id ASC`;
    case "name":
      return `sort_name = '', sort_name ${dir}, id ASC`;
    case "order":
    default:
      return `display_order ${dir}, sort_rank ${dir}, id ASC`;
  }
}

function fromRow(row: Record<string, unknown>): ProductIndexRow {
  return {
    id: String(row["id"] ?? ""),
    slug: String(row["slug"] ?? ""),
    title: String(row["title"] ?? ""),
    titleEn: String(row["title_en"] ?? ""),
    category: String(row["category"] ?? ""),
    categoryId: String(row["category_id"] ?? ""),
    kind: String(row["kind"] ?? ""),
    schemaId: String(row["schema_id"] ?? ""),
    platform: String(row["platform"] ?? ""),
    price: row["price"] == null ? null : Number(row["price"]),
    cost: row["cost"] == null ? null : Number(row["cost"]),
    stock: row["stock"] == null ? null : Number(row["stock"]),
    isInfiniteStock: Number(row["infinite_stock"] ?? 0) === 1,
    isHidden: Number(row["hidden"] ?? 0) === 1,
    status: String(row["status"] ?? ""),
    sales: Number(row["sales"] ?? 0),
    image: String(row["image"] ?? ""),
    displayOrder: Number(row["display_order"] ?? 0),
    updatedAt: String(row["updated_at"] ?? ""),
    createdAt: String(row["created_at"] ?? ""),
    releaseDate: String(row["release_date"] ?? ""),
    performanceRequired: Number(row["performance_required"] ?? 0) === 1,
  };
}

/**
 * One page of the admin table: two indexed queries, whatever the catalogue size.
 *
 * The count and the page are read together so `total` describes the same filter
 * the rows came from — a `hasMore` computed against an unfiltered total is what
 * makes a "next page" button lead to an empty screen.
 */
export async function readProductIndexPage(query: ProductIndexQuery): Promise<ProductIndexPage> {
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query.limit ?? DEFAULT_PAGE_SIZE)));
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: unknown[] = [];

  const search = text(query.search).toLowerCase();
  if (search) {
    // Matched against the same folded key the name column is sorted by, so an
    // Arabic search with a different alef still finds the product.
    where.push("(sort_name LIKE ? OR slug LIKE ? OR id LIKE ?)");
    const needle = "%" + sortableNameKey(search) + "%";
    params.push(needle, "%" + search + "%", "%" + search + "%");
  }
  if (text(query.categoryId)) {
    /*
      Store categories and imported products have used different ids for the
      same section over time (gift-cards vs cat_gift_cards,
      nintendo-switch-games vs cat_nintendo, etc.). The storefront already
      treats them as aliases; the admin query must do the same or selecting a
      visible category produces an empty table.
    */
    const aliases = categoryFilterAliases(query.categoryId);
    // A fixed predicate keeps D1 bindings bounded and auditable. The largest
    // alias family currently has six ids; unused slots can never match a real
    // category.
    const aliasSlots = [...aliases.slice(0, 6)];
    while (aliasSlots.length < 6) aliasSlots.push("__no_category_alias__");
    const categoryPredicate =
      "(category_id = ? OR category_id = ? OR category_id = ? OR category_id = ? OR category_id = ? OR category_id = ?" +
      " OR category = ? OR category = ? OR category = ? OR category = ? OR category = ? OR category = ?)";
    const isGiftCardSection = aliases.some((alias) =>
      ["gift-cards", "gift_cards", "cat_gift_cards", "gift_card", "cards"].includes(alias),
    );
    if (isGiftCardSection) {
      /*
        Old eShop cards can predate category normalization while still carrying
        a stable schema/kind identity. Include those identities so storefront
        cards do not disappear from the admin table.
      */
      where.push(
        "(" +
          categoryPredicate +
          " OR schema_id = ? OR kind = ? OR kind = ? OR kind = ? OR kind = ?)",
      );
      params.push(
        ...aliasSlots,
        ...aliasSlots,
        "gift_card",
        "digital_code",
        "gift_card",
        "gift-card",
        "giftcard",
      );
    } else {
      where.push(categoryPredicate);
      params.push(...aliasSlots, ...aliasSlots);
    }
  }
  if (query.hidden === true) where.push("hidden = 1");
  if (query.hidden === false) where.push("hidden = 0");
  if (query.onlyUnpriced) where.push("(price IS NULL OR price <= 0)");
  if (query.performanceRequired) where.push("performance_required = 1");

  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const sort = query.sort ?? { field: "order" as const, direction: "desc" as const };

  const [countRow, rows, facetRow] = await Promise.all([
    d1First<{ n: number }>(`SELECT COUNT(*) AS n FROM product_index ${whereSql}`, ...params),
    d1All<Record<string, unknown>>(
      `SELECT ${COLUMNS.filter((c) => c !== "rev").join(",")} FROM product_index ${whereSql}
       ORDER BY ${orderClause(sort)} LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    ),
    // One aggregate row for all three chips, rather than three round trips.
    d1First<{ hidden: number; unpriced: number; perf: number }>(
      `SELECT SUM(hidden) AS hidden,
              SUM(CASE WHEN price IS NULL OR price <= 0 THEN 1 ELSE 0 END) AS unpriced,
              SUM(performance_required) AS perf
         FROM product_index`,
    ),
  ]);

  const total = Number(countRow?.n ?? 0);
  return {
    items: rows.map(fromRow),
    total,
    page,
    limit,
    hasMore: offset + rows.length < total,
    facets: {
      hidden: Number(facetRow?.hidden ?? 0),
      unpriced: Number(facetRow?.unpriced ?? 0),
      performanceRequired: Number(facetRow?.perf ?? 0),
    },
  };
}

/* -------------------------------- bootstrap ------------------------------- */

/**
 * Builds the projection straight from the catalogue's own rows.
 *
 * Deliberately *not* `getStore()`. That reads every store row — banners,
 * content, bundles, analytics — stitches the chunks, validates and normalises
 * every product, merges the granular overlays, and races a 25-second internal
 * timeout. On a large catalogue it is the twenty seconds this whole change is
 * about, and taking it to build the index would mean the index could never be
 * built on the database that needs it most.
 *
 * So this reads only the product rows, parses them, and projects. Nothing is
 * written back to `store_kv`; a product that will not parse is skipped and
 * logged by id rather than failing the build, because one malformed record
 * must not cost the admin the other four hundred.
 */
export async function bootstrapProductIndex(rev: number): Promise<{
  built: number;
  skipped: string[];
  ms: number;
}> {
  const startedAt = Date.now();
  const rows = await d1All<{ key: string; value: string }>(
    `SELECT key, value FROM store_kv
      WHERE key = 'store:products' OR key LIKE 'store:products#%' OR key LIKE 'store:product:%'
      ORDER BY key ASC`,
  );

  const chunks: { index: number; value: string }[] = [];
  const overlays: Row[] = [];
  const skipped: string[] = [];
  let base = "";

  for (const row of rows) {
    if (row.key === "store:products") {
      base = row.value ?? "";
      continue;
    }
    const chunk = /^store:products#(\d+)$/.exec(row.key);
    if (chunk?.[1]) {
      chunks.push({ index: Number.parseInt(chunk[1], 10), value: row.value ?? "" });
      continue;
    }
    try {
      const parsed = JSON.parse(row.value) as Row;
      if (parsed && typeof parsed === "object") overlays.push(parsed);
    } catch {
      skipped.push(row.key);
    }
  }

  let products: Row[] = [];
  const joined =
    chunks
      .sort((a, b) => a.index - b.index)
      .map((c) => c.value)
      .join("") || base;
  if (joined.trim()) {
    try {
      const parsed = JSON.parse(joined);
      if (Array.isArray(parsed)) products = parsed as Row[];
    } catch {
      skipped.push("store:products (unparseable)");
    }
  }

  /*
    Overlays win, and an overlay marked `_deleted` removes the product — the
    same precedence `loadStore` applies, so the index cannot show a product the
    catalogue considers gone.
  */
  const byId = new Map<string, Row>();
  for (const product of products) {
    const id = text(product?.["id"]);
    if (id) byId.set(id, product);
  }
  for (const overlay of overlays) {
    const id = text(overlay?.["id"]);
    if (!id) continue;
    if (overlay["_deleted"]) byId.delete(id);
    else byId.set(id, overlay);
  }

  const built = await rebuildProductIndex([...byId.values()], rev);
  const ms = Date.now() - startedAt;
  console.log(
    `[product_index.bootstrap] built=${built} chunks=${chunks.length}` +
      ` overlays=${overlays.length} skipped=${skipped.length} ms=${ms}`,
  );
  if (skipped.length > 0) console.warn("[product_index.bootstrap:skipped]", skipped.slice(0, 20));
  return { built, skipped, ms };
}
