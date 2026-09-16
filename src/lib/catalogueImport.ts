/**
 * The supplier catalogue, turned into listings.
 *
 * The owner keeps a spreadsheet of roughly fifteen hundred Switch titles — an
 * English name, what a copy costs, what it sells for, the console, the Chinese
 * name the supplier uses, and whether the game has English in it. That is the
 * whole record. There are no covers, no descriptions and no specifications,
 * and there will not be for months.
 *
 * The decision this file implements is that those go on sale anyway. A
 * customer who wants «Fire Emblem: Three Houses» can find it, see 8,000 د.ع,
 * and order it. The page carries a button asking for the details, or for an
 * online account, or for the offline account with the extras — and the admin
 * fills the rest in over time, on the games people actually ask about first.
 *
 * Two of the six columns never reach a customer: the cost, and the Chinese
 * name the supplier lists the game under. The cost is stripped by
 * `toPublicProduct` like every other cost in the shop; the Chinese name never
 * touches the product document at all and is written to
 * `product_admin_metadata`, which the storefront never loads.
 *
 * Everything here is pure, so the same parse runs in the browser to preview an
 * import and on the server to apply it — one definition of what a row means,
 * rather than a preview that can disagree with what gets written.
 */

import { categoryFilterAliases, resolveCategoryType } from "./productSection";
import type { StoreDoc } from "./types";

export interface CatalogueRow {
  /** The line number in the file, 1-based, for error messages. */
  line: number;
  /*
    The product's address, resolved against the whole file.

    Not derived from the name at import time, because two different games can
    share one. The owner's own sheet has both cases: «Railway Nippon! Real
    Pro» and «Railway Nippon! Real Pro (特快专通)» are different products at
    7,000 and 9,000 — the slug drops the Chinese and they become one — and
    «Absolute Fear -AOONI-» is listed twice, once per console. Left alone,
    each pair would collapse into a single listing and the shop would quietly
    lose a product.

    Assigned in `parseCatalogueCsv`, which is the only place that can see the
    collision.
  */
  slug: string;
  englishName: string;
  /*
    Admin-only. What a copy costs the shop.

    `null` means the sheet does not say — a file with no Cost column at all —
    which is not the same as zero and must not be written over a cost the shop
    already knows.
  */
  costIqd: number | null;
  /** Admin-only. What the supplier calls it. */
  chineseName: string;
  platform: "switch1" | "switch2";
  /** The standard offline account price — the one number the customer sees. */
  offlinePriceIqd: number;
  /** Whether the game can be played in English. */
  englishSupport: boolean;
}

export interface CatalogueParseIssue {
  line: number;
  name: string;
  message: string;
}

export interface CatalogueParseResult {
  rows: CatalogueRow[];
  issues: CatalogueParseIssue[];
  /** Header names as found, so a mis-shaped file says so rather than importing nothing. */
  headers: string[];
}

/*
  The column names the owner's export uses, and the spellings that mean the
  same thing. Matched case- and separator-insensitively, so «Offline Price
  IQD», «offline_price_iqd» and «OfflinePriceIQD» are one column.
*/
type SheetColumn = keyof Omit<CatalogueRow, "line" | "slug">;

const COLUMN_ALIASES: Record<SheetColumn, string[]> = {
  englishName: ["englishname", "name", "title", "gamename", "englishtitle"],
  costIqd: ["costiqd", "cost", "costprice", "supplier cost", "suppliercost"],
  chineseName: ["chinesename", "chinese", "zhname", "suppliername", "namezh"],
  platform: ["platform", "console", "system"],
  offlinePriceIqd: [
    "offlinepriceiqd",
    "offlineprice",
    "price",
    "priceiqd",
    "sellprice",
    "sellingprice",
  ],
  englishSupport: ["englishsupport", "english", "supportsenglish", "englang"],
};

function headerKey(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[\s_\-.]+/g, "")
    .trim();
}

/**
 * A CSV reader that handles quoted fields, embedded commas and newlines.
 *
 * Written out rather than pulled in: the file is the shop's price list, and a
 * dependency that mis-parses one quoted title silently mis-prices a game.
 * Handles `""` as an escaped quote, and both CRLF and LF.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const input = text.replace(/^\uFEFF/, "");

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A trailing newline must not produce a row of one empty string.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      endField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Arabic-Indic digits, so a price typed in Arabic still parses as a number. */
function westernDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * A number from a spreadsheet cell, or NaN.
 *
 * The strip-then-`Number` this used to do reported **zero** for a cell with no
 * digits in it, because `Number("")` is 0 rather than NaN. So «N/A», «-» and
 * «غير معروف» in the Cost column all parsed as a cost of zero, the
 * «التكلفة غير مقروءة» branch below became unreachable — and worse, the loss
 * guard beneath it is fenced behind `cost > 0`, so it was skipped too. A row
 * whose real cost is 12,000 against a sheet price of 9,000 is refused when the
 * cost parses, and was imported and published at a loss when somebody had
 * typed «N/A» instead.
 */
function money(value: string): number {
  // Thousands separators and a currency word are both common in this sheet.
  const cleaned = westernDigits(String(value ?? ""))
    .replace(/[,٬\s]/g, "")
    .replace(/[^0-9.]/g, "");
  if (!/[0-9]/.test(cleaned)) return NaN;
  return Number(cleaned);
}

function readPlatform(value: string): "switch1" | "switch2" | null {
  const key = String(value ?? "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (!key) return null;
  if (key.includes("switch2") || key.includes("ns2") || key === "2") return "switch2";
  if (key.includes("switch") || key.includes("ns1") || key === "1") return "switch1";
  return null;
}

/**
 * Whether the row says the game has English in it.
 *
 * The sheet writes «نعم» or «لا — يابانية/صينية». Anything that is not
 * recognisably a yes is treated as a no, which is the safe direction: telling
 * a customer a Japanese-only game has English is a refund, and the reverse is
 * a question.
 */
function readEnglishSupport(value: string): boolean {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!text) return false;
  if (text.startsWith("لا") || text.startsWith("no")) return false;
  return text.startsWith("نعم") || text.startsWith("yes") || text === "true" || text === "1";
}

/**
 * Reads the file into rows, reporting every line it could not use.
 *
 * Nothing is dropped silently. A row with an unreadable price is an issue with
 * its line number and its name, because the alternative — importing 1,527 of
 * 1,530 and saying "done" — is how a game ends up missing from the shop with
 * nobody able to say which.
 */
export function parseCatalogueCsv(text: string): CatalogueParseResult {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], issues: [], headers: [] };

  const headers = (table[0] ?? []).map((h) => h.trim());
  const keys = headers.map(headerKey);
  const columnOf = (field: SheetColumn): number => {
    const aliases = COLUMN_ALIASES[field].map(headerKey);
    return keys.findIndex((key) => aliases.includes(key));
  };

  const index = {
    englishName: columnOf("englishName"),
    costIqd: columnOf("costIqd"),
    chineseName: columnOf("chineseName"),
    platform: columnOf("platform"),
    offlinePriceIqd: columnOf("offlinePriceIqd"),
    englishSupport: columnOf("englishSupport"),
  };

  const issues: CatalogueParseIssue[] = [];

  /*
    The three columns a listing cannot be built without. The Chinese name and
    the English-support flag are optional: a sheet that lacks them still makes
    a sellable listing, and refusing the whole file over a missing admin note
    would be the wrong trade.
  */
  const required: Array<[keyof typeof index, string]> = [
    ["englishName", "English Name"],
    ["offlinePriceIqd", "Offline Price IQD"],
    ["platform", "Platform"],
  ];
  for (const [field, label] of required) {
    if (index[field] < 0) {
      issues.push({ line: 1, name: "", message: `العمود «${label}» غير موجود في الملف` });
    }
  }
  if (issues.length > 0) return { rows: [], issues, headers };

  const rows: Array<Omit<CatalogueRow, "slug">> = [];
  const cell = (record: string[], at: number): string =>
    at >= 0 ? String(record[at] ?? "").trim() : "";

  for (let r = 1; r < table.length; r++) {
    const record = table[r]!;
    const line = r + 1;
    const englishName = cell(record, index.englishName);
    // A blank line in the middle of a spreadsheet is not an error.
    if (!englishName && record.every((value) => !String(value ?? "").trim())) continue;

    if (englishName.length < 2) {
      issues.push({ line, name: englishName, message: "اسم اللعبة مفقود" });
      continue;
    }

    const price = money(cell(record, index.offlinePriceIqd));
    if (!Number.isFinite(price) || price <= 0) {
      issues.push({ line, name: englishName, message: "سعر البيع غير صالح" });
      continue;
    }

    const platform = readPlatform(cell(record, index.platform));
    if (!platform) {
      issues.push({ line, name: englishName, message: "المنصة غير معروفة" });
      continue;
    }

    /*
      A cost cell with something unreadable in it refuses the row.

      Not an issue-and-import. The margin rule below is the only protection
      this file has against publishing at a loss, and it can only run on a cost
      it could read — so importing the row anyway means publishing a price
      nothing checked. An empty cell, or a file with no Cost column at all, is
      a different thing: the sheet is not claiming a cost, and `null` says so.
    */
    const rawCost = cell(record, index.costIqd);
    let cost: number | null = null;
    if (rawCost) {
      const parsed = money(rawCost);
      if (!Number.isFinite(parsed) || parsed < 0) {
        issues.push({
          line,
          name: englishName,
          message: `التكلفة «${rawCost}» غير مقروءة — لم تُستورد`,
        });
        continue;
      }
      cost = parsed;
    }
    /*
      A price at or below cost is refused outright, not imported and flagged.

      This is the one rule in the file that is about money rather than about
      shape, and it is the same rule `publishGate.ts` applies before publishing
      anything: a product selling at its supplier figure is a loss on every
      order, and fifteen hundred of them arriving at once is not something an
      admin will catch by reading a list.
    */
    if (cost !== null && cost > 0 && price <= cost) {
      issues.push({
        line,
        name: englishName,
        message: `سعر البيع (${price}) لا يزيد عن التكلفة (${cost}) — لم تُستورد`,
      });
      continue;
    }

    rows.push({
      line,
      englishName,
      costIqd: cost,
      chineseName: cell(record, index.chineseName),
      platform,
      offlinePriceIqd: price,
      englishSupport: readEnglishSupport(cell(record, index.englishSupport)),
    });
  }

  return { rows: assignSlugs(rows), issues, headers };
}

/**
 * Gives every row an address that is unique across the file.
 *
 * Collisions are broken by the console first, because that is what actually
 * distinguishes the pair the sheet has — the same game listed for Switch and
 * for Switch 2 — and it makes the URL say something true. A pair the console
 * cannot separate falls back to a counter.
 *
 * Both are assigned in a **sorted** order, not the file's. If the owner
 * reorders their spreadsheet, a counter assigned by file position would move
 * between the two games and the next import would create duplicates of both
 * instead of updating either.
 */
/**
 * A short, stable tag derived from the text itself.
 *
 * Used to separate two games whose names produce the same slug. A counter
 * would have been simpler and wrong: it is assigned by position, so adding a
 * third «Railway Nippon» to the sheet shifts the tag on the other two, their
 * ids change, and the next import creates fresh copies of games that already
 * exist while the originals stay behind. This depends only on the name, so it
 * never moves.
 */
function nameTag(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).slice(0, 5);
}

/**
 * The slug for one row, with no knowledge of the rest of the file.
 *
 * `sanitizeSlug` falls back to `Date.now()` when a name has no Latin letters
 * or digits at all — every run would mint a new id for the same game, and the
 * shop would fill with copies. The sheet is mostly English, but it carries
 * Japanese and Chinese titles, so this is reachable.
 */
function catalogueSlug(row: Pick<CatalogueRow, "englishName">): string {
  const cleaned = row.englishName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || `game-${nameTag(row.englishName)}`;
}

function assignSlugs(rows: Array<Omit<CatalogueRow, "slug">>): CatalogueRow[] {
  const groups = new Map<string, Array<Omit<CatalogueRow, "slug">>>();
  for (const row of rows) {
    const base = catalogueSlug(row);
    const group = groups.get(base);
    if (group) group.push(row);
    else groups.set(base, [row]);
  }

  const slugOf = new Map<Omit<CatalogueRow, "slug">, string>();
  for (const [base, group] of groups) {
    if (group.length === 1) {
      slugOf.set(group[0]!, base);
      continue;
    }
    /*
      A tag from the row's own name and console, for every row in the group.

      Not "console first, name tag on a clash": that reads better and moves.
      Whoever came first got the clean `-ns2` and everyone else got a tag, so
      re-sorting the sheet — or adding a third «Railway Nippon» — handed the
      suffix to a different game. Its id would change, and the next import
      would create a fresh copy of a game already in the shop while the
      original sat there orphaned. My own test caught it.

      Keyed on the name *and* the console because the sheet lists «Absolute
      Fear -AOONI-» twice, once per machine, under one name — so the name
      alone gives both rows the same tag and they collapse again. Two rows that
      match on both are the same product, and sharing a slug is correct.
    */
    for (const row of group) {
      slugOf.set(row, `${base}-${nameTag(`${row.englishName}|${row.platform}`)}`);
    }
  }

  return rows.map((row) => ({ ...row, slug: slugOf.get(row) ?? catalogueSlug(row) }));
}

/**
 * The same name twice in one file.
 *
 * Both rows would build the same slug and the second would overwrite the
 * first, so the caller is told rather than left with a count that does not
 * match the spreadsheet. Returns the duplicate names, in file order.
 */
export function duplicateNames(rows: CatalogueRow[]): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const row of rows) {
    /*
      Keyed on the name *and the console*.

      The same title listed once for Switch and once for Switch 2 is two
      products with two costs, not a mistake in the spreadsheet — and calling
      it one was how the second of them would have been dropped.
    */
    const key = `${row.englishName.trim().toLowerCase()}|${row.platform}`;
    if (seen.has(key)) {
      if (!dupes.includes(row.englishName)) dupes.push(row.englishName);
      continue;
    }
    seen.add(key);
  }
  return dupes;
}

export const CATALOGUE_SOURCE = "supplier-catalogue";

/** The one option a bare listing carries: the standard offline account. */
export const OFFLINE_OPTION_ID = "offline_account";

export interface BuiltListing {
  /** The product document, ready for the store. */
  product: Record<string, unknown>;
  /** Written to `product_admin_metadata`, never to the product. */
  chineseName: string;
}

/**
 * What a re-run is allowed to change on a game that already exists.
 *
 * Nothing, by default. The importer is additive: it creates the games that are
 * not in the shop and leaves the ones that are completely alone, which is what
 * makes running it twice safe and what makes running it after a failure the
 * obvious thing to do.
 *
 * `refreshPrices` is the deliberate exception, and it is deliberately narrow.
 * It updates the price and the cost, and only on listings this importer
 * created — nothing else, on nothing else. Everything the first draft of this
 * file also overwrote was a standing rule broken:
 *
 *   - `isHidden` / `isActive` / `status`: an admin takes a game off sale
 *     because the supplier ran out, and the next import quietly puts it back.
 *   - `stock` / `isInfiniteStock`: same.
 *   - `options`: an online account somebody priced by hand.
 *   - `title`: a name somebody corrected.
 *
 * The comment at the top of this file claimed the update "touches nothing
 * else" while the code wrote all of them, which is worse than either.
 */
export type ImportMode = "create-only" | "refresh-prices";

export interface BuildOptions {
  categoryId: string;
  categoryTitle?: string;
  /** The product already in the catalogue under this slug or name. */
  existing?: Record<string, unknown>;
  mode?: ImportMode;
}

export type BuildOutcome =
  | { action: "create"; product: Record<string, unknown>; chineseName: string }
  | { action: "update"; product: Record<string, unknown>; chineseName: string }
  | { action: "skip"; reason: string };

/**
 * Turns one catalogue row into a listing, or declines to.
 *
 * A row with no matching product becomes a new one. A row that matches
 * something already in the shop is refused unless the run asked for a price
 * refresh *and* the match is a listing this importer made — a product somebody
 * built by hand is never touched by a spreadsheet, whatever its name.
 */
export function buildListing(row: CatalogueRow, options: BuildOptions): BuildOutcome {
  // Resolved against the whole file by the parser; see `CatalogueRow.slug`.
  const slug = row.slug || catalogueSlug(row);
  const existing = options.existing;

  if (existing) {
    const mine = existing["catalogueSource"] === CATALOGUE_SOURCE;
    if (!mine) {
      return {
        action: "skip",
        reason: "موجود مسبقاً كمنتج أُنشئ يدوياً — لم يُلمس",
      };
    }
    if (options.mode !== "refresh-prices") {
      return { action: "skip", reason: "موجود مسبقاً — لم يتغيّر شيء" };
    }
    /*
      Two fields, by name, onto a copy. Not a spread of a freshly built record
      over the stored one: that is how the first draft of this quietly carried
      visibility, stock and options along with the price.
    */
    return {
      action: "update",
      product: {
        ...existing,
        price: row.offlinePriceIqd,
        /*
          Only when the sheet actually states one. A file with no Cost column
          says nothing about cost, and writing a zero over a figure the shop
          knows would lose it — and, since the loss guard reads the cost,
          disarm the check on every later run too.
        */
        ...(row.costIqd !== null ? { cost: row.costIqd } : {}),
        accountPrice: row.offlinePriceIqd,
        updatedAt: new Date().toISOString(),
      },
      chineseName: row.chineseName,
    };
  }

  /*
    The offline option carries no price of its own: `resolveUnitPrice` treats
    an unpriced option as "use the price above me", so the one number in the
    spreadsheet stays the single source of the game's price instead of being
    copied into two places that can then disagree.
  */
  const offlineOption = {
    id: OFFLINE_OPTION_ID,
    name: "حساب أوفلاين",
    description: "حساب مخصص للعب دون اتصال بعد إكمال خطوات التفعيل.",
    stock: 9999,
    isInfiniteStock: true,
  };

  const now = new Date().toISOString();
  const product: Record<string, unknown> = {
    id: `prd_cat_${slug}`,
    slug,
    title: row.englishName,
    titleEn: row.englishName,
    kind: "game",
    categoryId: options.categoryId,
    category: options.categoryTitle || options.categoryId,
    platform: row.platform,
    price: row.offlinePriceIqd,
    // A sheet that states no cost leaves the field at zero on a new listing:
    // there is nothing to lose, and the admin fills it in.
    cost: row.costIqd ?? 0,

    /*
      Infinite stock, because an account is not a shelf.

      This is load-bearing rather than cosmetic: `readOffers` reads
      `accountStock || stock`, and a record with no stock field resolves to 0,
      marks the derived offline offer unavailable, and the game renders with
      its buy button dead. A catalogue published unbuyable is the one failure
      this whole change exists to avoid.
    */
    stock: 9999,
    isInfiniteStock: true,
    accountEnabled: true,
    accountPrice: row.offlinePriceIqd,
    accountStock: 9999,
    options: [offlineOption],

    isActive: true,
    isHidden: false,
    status: "active",

    /** Shown to the customer: 17 of these titles have no English in them. */
    englishSupport: row.englishSupport,
    /** Where this listing came from, so a re-run can recognise its own work. */
    catalogueSource: CATALOGUE_SOURCE,
    updatedAt: now,
    createdAt: now,
  };

  return { action: "create", product, chineseName: row.chineseName };
}

/* ------------------------------------------------------------------ */
/* Deciding a batch against a snapshot                                 */
/* ------------------------------------------------------------------ */

/*
  `decide` used to live inside the route file, which meant only a Worker could
  reach it — and a Worker is the one place this import cannot finish, because
  the shop is on a plan whose CPU ceiling a catalogue write cannot fit inside.
  Anything else that wanted to run this import would have had to reimplement
  the matching rules, and a second implementation of "which existing product is
  this row?" is how an import creates duplicates of games the shop already
  sells.

  So it lives here, beside `buildListing` and `parseCatalogueCsv`, in a module
  with no server imports: the browser preview, the Worker route and a script on
  a runner all decide identically because they all call this.
*/
export type Outcome = "created" | "updated" | "skipped";

export interface RowResult {
  line: number;
  name: string;
  outcome: Outcome;
  /** Present on `skipped`, always in Arabic — the admin reads this list. */
  reason?: string;
  id?: string;
}

function slugOf(product: Record<string, unknown>): string {
  return String(product["slug"] ?? "")
    .trim()
    .toLowerCase();
}

/**
 * The Nintendo Switch Games category, as this store actually spells it.
 *
 * The section has six accepted spellings (`SECTION_CATEGORY_ALIASES`), and
 * guessing the wrong one puts fifteen hundred games in a category the sidebar
 * does not list. So the store's own categories are consulted first and only
 * the canonical id is used as a fallback.
 */
function resolveGamesCategory(categories: unknown): { id: string; title: string } {
  const list = Array.isArray(categories) ? (categories as Record<string, unknown>[]) : [];
  const aliases = categoryFilterAliases("nintendo-switch-games");
  for (const category of list) {
    const id = String(category?.["id"] ?? "")
      .trim()
      .toLowerCase();
    if (id && aliases.includes(id)) {
      return { id: String(category["id"]), title: String(category["title"] ?? "") };
    }
  }
  return { id: "nintendo-switch-games", title: "ألعاب نينتندو سويتش" };
}

/** What one pass over a store snapshot decided. */
export interface Decision {
  products: Record<string, unknown>[];
  results: RowResult[];
  created: number;
  updated: number;
  categoryId: string;
  names: { productId: string; supplierNameZhCn: string; englishTitle: string }[];
}

/**
 * Every row in the batch, decided against one snapshot of the catalogue.
 *
 * Pure, and re-runnable: `updateStore` re-reads the store and re-applies the
 * mutation when another writer wins the revision, so the decision has to be a
 * function of the snapshot it is handed rather than of one taken earlier. That
 * is also what makes the preview honest — it is this same function, run and
 * thrown away.
 */
export function decide(current: StoreDoc, rows: CatalogueRow[], mode: ImportMode): Decision {
  const products = [...((current.products ?? []) as unknown as Record<string, unknown>[])];
  const category = resolveGamesCategory(current.categories);
  const out: Decision = {
    products,
    results: [],
    created: 0,
    updated: 0,
    categoryId: category.id,
    names: [],
  };

  /*
    One pass over the catalogue, not one lookup per row. A `find` per row over
    seventeen hundred products is eighty-five thousand string comparisons per
    batch, and there are sixteen batches.
  */
  const bySlug = new Map<string, number>();
  const byId = new Map<string, number>();
  const byTitle = new Map<string, number>();
  for (let at = 0; at < products.length; at++) {
    const product = products[at]!;
    const slug = slugOf(product);
    if (slug && !bySlug.has(slug)) bySlug.set(slug, at);
    const id = String(product["id"] ?? "").trim();
    if (id && !byId.has(id)) byId.set(id, at);

    /*
      Only games are looked up by title.

      The title index exists to stop a second «Fire Emblem: Three Houses»
      being created beside one an admin added by hand. It was built over every
      product in the shop — hardware, accessories, amiibo, gift cards, bundles
      — so a console accessory or a bundle that happens to share a name with a
      game was taken as "the same game". That costs the row twice over: the
      import declines to touch the accessory (rightly), and the game it was
      supposed to create is never created, because the row has been answered.

      A slug or id match still works across every kind, which is the precise
      case: a collision there is a URL or key collision and a real conflict.
    */
    const isGame =
      resolveCategoryType(
        String(product["categoryId"] ?? ""),
        String(product["category"] ?? product["categoryTitle"] ?? ""),
        String(product["kind"] ?? ""),
        String(product["schemaId"] ?? ""),
      ) === "game";
    if (!isGame) continue;

    const title = String(product["titleEn"] ?? product["title"] ?? "")
      .trim()
      .toLowerCase();
    if (title && !byTitle.has(title)) byTitle.set(title, at);
  }

  for (const row of rows) {
    const name = String(row?.englishName ?? "").trim();
    const line = Number(row?.line) || 0;
    if (!name || !(Number(row?.offlinePriceIqd) > 0)) {
      out.results.push({ line, name, outcome: "skipped", reason: "صف غير صالح" });
      continue;
    }

    /*
      Matched by slug, then by the id this importer would mint, then by name.

      The slug is what a re-run of the same sheet produces, so it is the
      reliable key. The id lookup closes the gap the first version left: a
      listing whose slug was later corrected still owns `prd_cat_<slug>`, and
      creating a second product under an id already in the catalogue is a
      duplicate key, not a new game. The title lookup is what stops a second
      «Fire Emblem: Three Houses» beside one an admin added by hand.
    */
    const desiredSlug = String(row.slug ?? "")
      .trim()
      .toLowerCase();
    const at =
      (desiredSlug ? bySlug.get(desiredSlug) : undefined) ??
      (desiredSlug ? byId.get(`prd_cat_${desiredSlug}`) : undefined) ??
      byTitle.get(name.toLowerCase());
    const existing = at === undefined ? undefined : products[at];

    const outcome = buildListing(row, {
      categoryId: category.id,
      categoryTitle: category.title,
      mode,
      ...(existing ? { existing } : {}),
    });

    if (outcome.action === "skip") {
      out.results.push({ line, name, outcome: "skipped", reason: outcome.reason });
      continue;
    }

    const id = String(outcome.product["id"]);
    if (outcome.action === "create") {
      products.push(outcome.product);
      const added = products.length - 1;
      if (desiredSlug) bySlug.set(desiredSlug, added);
      byId.set(id, added);
      byTitle.set(name.toLowerCase(), added);
      out.created += 1;
    } else {
      products[at!] = outcome.product;
      out.updated += 1;
    }

    /*
      The Chinese name goes to its own admin-only table and never onto the
      product. `getStore()` does not load that table, so there is no path by
      which the storefront could serialise it — which is the whole reason it
      lives there.
    */
    if (outcome.chineseName) {
      out.names.push({ productId: id, supplierNameZhCn: outcome.chineseName, englishTitle: name });
    }
    out.results.push({
      line,
      name,
      outcome: outcome.action === "create" ? "created" : "updated",
      id,
    });
  }

  return out;
}
