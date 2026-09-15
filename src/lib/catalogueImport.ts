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

import { sanitizeSlug } from "./productSlug";

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
  /** Admin-only. What a copy costs the shop. */
  costIqd: number;
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

function money(value: string): number {
  // Thousands separators and a currency word are both common in this sheet.
  const cleaned = westernDigits(String(value ?? ""))
    .replace(/[,٬\s]/g, "")
    .replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
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
  const text = String(value ?? "").trim().toLowerCase();
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
      A missing cost is an issue, not a refusal. The listing still sells; what
      it loses is the margin check, and the admin can see which rows lost it.
    */
    const rawCost = cell(record, index.costIqd);
    let cost = rawCost ? money(rawCost) : 0;
    if (!Number.isFinite(cost) || cost < 0) {
      issues.push({ line, name: englishName, message: "التكلفة غير صالحة — استُوردت بدون تكلفة" });
      cost = 0;
    }
    /*
      A price at or below cost is refused outright, not imported and flagged.

      This is the one rule in the file that is about money rather than about
      shape, and it is the same rule `publishGate.ts` applies before publishing
      anything: a product selling at its supplier figure is a loss on every
      order, and fifteen hundred of them arriving at once is not something an
      admin will catch by reading a list.
    */
    if (cost > 0 && price <= cost) {
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
function assignSlugs(rows: Array<Omit<CatalogueRow, "slug">>): CatalogueRow[] {
  const groups = new Map<string, Array<Omit<CatalogueRow, "slug">>>();
  for (const row of rows) {
    const base = sanitizeSlug(row.englishName, row.englishName);
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
    const ordered = [...group].sort(
      (a, b) =>
        a.englishName.localeCompare(b.englishName) || a.platform.localeCompare(b.platform),
    );
    const taken = new Set<string>();
    for (const row of ordered) {
      const byConsole = `${base}-${row.platform === "switch2" ? "ns2" : "ns1"}`;
      let slug = taken.has(byConsole) ? "" : byConsole;
      if (!slug) {
        let n = 2;
        while (taken.has(`${base}-${n}`)) n += 1;
        slug = `${base}-${n}`;
      }
      taken.add(slug);
      slugOf.set(row, slug);
    }
  }

  return rows.map((row) => ({ ...row, slug: slugOf.get(row) ?? sanitizeSlug(row.englishName, row.englishName) }));
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
 * Turns one catalogue row into a listing.
 *
 * `existing` is the product already in the catalogue under this slug, when
 * there is one. Re-running the import must update the price and the cost
 * rather than mint a second copy of the game — and it must **not** undo an
 * admin's work: anything already written onto the product is kept, and only
 * the six columns the spreadsheet is authoritative about are overwritten.
 * That is what makes this safe to run again every time the sheet changes.
 */
export function buildBareListing(
  row: CatalogueRow,
  options: { categoryId: string; categoryTitle?: string; existing?: Record<string, unknown> },
): BuiltListing {
  // Resolved against the whole file by the parser; see `CatalogueRow.slug`.
  const slug = row.slug || sanitizeSlug(row.englishName, row.englishName);
  const existing = options.existing;
  const id = String(existing?.["id"] ?? `prd_cat_${slug}`).trim() || `prd_cat_${slug}`;

  /*
    The offline option, preserved if the admin has already edited it.

    It carries no price of its own: `resolveUnitPrice` treats an unpriced
    option as "use the price above me", so the one number in the spreadsheet
    stays the single source of the game's price instead of being copied into
    two places that can then disagree.
  */
  const existingOptions = Array.isArray(existing?.["options"])
    ? (existing!["options"] as Record<string, unknown>[])
    : [];
  const existingOffline = existingOptions.find((o) => o?.["id"] === OFFLINE_OPTION_ID);
  const offlineOption = {
    ...existingOffline,
    id: OFFLINE_OPTION_ID,
    name: "حساب أوفلاين",
    description: "حساب مخصص للعب دون اتصال بعد إكمال خطوات التفعيل.",
    stock: 9999,
    isInfiniteStock: true,
  };
  const options_ = existingOptions.some((o) => o?.["id"] === OFFLINE_OPTION_ID)
    ? existingOptions.map((o) => (o?.["id"] === OFFLINE_OPTION_ID ? offlineOption : o))
    : [offlineOption, ...existingOptions];

  const product: Record<string, unknown> = {
    // An admin's edits survive a re-import; the spreadsheet's columns do not.
    ...(existing ?? {}),
    id,
    slug: String(existing?.["slug"] ?? slug),
    title: row.englishName,
    titleEn: row.englishName,
    kind: "game",
    categoryId: options.categoryId,
    category: options.categoryTitle || options.categoryId,
    platform: row.platform,
    price: row.offlinePriceIqd,
    cost: row.costIqd,

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
    options: options_,

    isActive: true,
    isHidden: false,
    status: "active",

    /** Shown to the customer: 17 of these titles have no English in them. */
    englishSupport: row.englishSupport,
    /** Where this listing came from, so a re-import can recognise its own work. */
    catalogueSource: CATALOGUE_SOURCE,
    /*
      The record did change, so it was updated now. `createdAt` is the one
      stamp a re-import must not move — it is what tells the admin table which
      games have been in the shop since the first import.
    */
    updatedAt: new Date().toISOString(),
    createdAt: existing?.["createdAt"] ?? new Date().toISOString(),
  };

  return { product, chineseName: row.chineseName };
}
