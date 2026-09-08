/**
 * Reading a bundle's game list out of the description the admin already wrote.
 *
 * A bundle description is a numbered list of titles:
 *
 *     1. Mario Kart 8 Deluxe
 *     2. Ultra Street Fighter II: The Final Challengers
 *     3. Xenoblade Chronicles 2
 *
 * The admin then searched the catalogue for each of those by hand and ticked
 * it, one at a time, for a bundle of a dozen games. The list was already in
 * front of them; this reads it.
 *
 * Two things it deliberately does not do. It does not decide on its own that a
 * line means a particular game when it is not reasonably sure — an almost-match
 * silently added to a bundle is a game the customer paid for and does not
 * receive. And it does not touch the database: it reports what it found and
 * what it could not, and the admin saves.
 */

import { buildProductIndex, searchProducts, type IndexedProduct } from "./search/products";
import { normalize } from "./search/normalize";

/**
 * Lines that are a heading rather than a game.
 *
 * Descriptions open with a sentence — «الألعاب المتضمنة», «Includes:» — and it
 * is not a title however confidently it is numbered.
 */
const HEADING = /[:：]\s*$/;

/** Leading list markers, in either script's digits. */
const BULLET = /^[\s‏‎]*(?:[0-9٠-٩]{1,3}\s*[.)\-–—:]|[-–—•*·●▪◦])\s*/;

/** Trailing decoration: a price, a platform tag, a parenthetical note. */
const TRAILING_NOISE = /\s*[-–—|]\s*(?:\d[\d,،.]*\s*(?:د\.?ع|iqd|usd|\$)?)\s*$/i;

/** No bundle has this many games; a description pasted wholesale might. */
const MAX_LINES = 60;

/**
 * Above this many words a line is prose, not a title.
 *
 * A character cap does not survive both scripts — «تسليم فوري وتلقائي في محادثة
 * الطلب…» is a sentence at eighty-odd characters and «Ultra Street Fighter II:
 * The Final Challengers» is a title at forty-six. Words separate them cleanly:
 * the longest Nintendo title in this catalogue is seven.
 */
const MAX_TITLE_WORDS = 9;

export interface BundleGameMatch {
  /** The line as the admin wrote it, cleaned of numbering. */
  line: string;
  /** The catalogue product this line means, when one was found. */
  product?: Record<string, unknown>;
  /** 0–1. 1 is an exact name. */
  score: number;
  /**
   * `missing` is not a failure — it is the shop not carrying the game yet, and
   * it is what the admin needs to see in red.
   */
  status: "matched" | "missing";
}

/**
 * The candidate titles in a description, in the order they appear.
 *
 * Blank lines, headings and duplicates are dropped. Nothing else is: a line
 * this cannot make sense of is still returned, because the admin needs to see
 * that it was considered and came back empty rather than silently skipped.
 */
export function parseBundleGameLines(description: string): string[] {
  if (!description) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of description.split(/\r?\n/)) {
    const line = raw
      .replace(BULLET, "")
      .replace(TRAILING_NOISE, "")
      .replace(/\s+/g, " ")
      .trim();

    if (line.length < 2) continue;
    /* «الألعاب المتضمنة:» announces the list; it is not in it. */
    if (HEADING.test(line)) continue;
    if (line.split(/\s+/).length > MAX_TITLE_WORDS) continue;

    const key = normalize(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= MAX_LINES) break;
  }

  return out;
}

/**
 * How sure the match has to be before a line counts as found.
 *
 * A bundle line is a whole title, not a half-typed query, so the bar is set
 * well above the storefront's: there the cost of a loose match is a slightly
 * odd search result, here it is the wrong game in something somebody bought.
 */
const CONFIDENT = 0.82;

/**
 * How much of the matched title the admin's line has to actually be.
 *
 * Score alone is not enough. A single common word — «Warriors» — matches the
 * name field of *Fire Emblem Warriors* perfectly and scores 1, because there is
 * only one word in the query and it landed. Selling that as the game is the
 * exact failure this module exists to avoid, so a line must also account for
 * most of the title it claims.
 */
const MIN_TITLE_COVERAGE = 0.55;

export interface MatchOptions {
  /** Override the confidence bar. Mostly for tests. */
  threshold?: number;
}

/** The names a product answers to, folded. */
function namesOf(product: Record<string, unknown>): string[] {
  return (["titleEn", "titleAr", "title", "english_name"] as const)
    .map((key) => (typeof product[key] === "string" ? normalize(product[key] as string) : ""))
    .filter(Boolean);
}

/** The best share of any of the product's names that this line covers. */
function coverage(line: string, product: Record<string, unknown>): number {
  const folded = normalize(line);
  if (!folded) return 0;
  let best = 0;
  for (const name of namesOf(product)) {
    if (!name) continue;
    const ratio = folded.length >= name.length ? 1 : folded.length / name.length;
    if (ratio > best) best = ratio;
  }
  return best;
}

/**
 * Resolve each line against the catalogue.
 *
 * An exact name — after Arabic folding, so «ماريو كارت ٨ ديلوكس» matches its
 * own record — is taken outright. Anything else goes through the storefront's
 * search engine and is accepted only above `CONFIDENT`.
 */
export function matchBundleGames(
  lines: readonly string[],
  products: readonly Record<string, unknown>[],
  options: MatchOptions = {},
): BundleGameMatch[] {
  const threshold = options.threshold ?? CONFIDENT;
  const index: IndexedProduct[] = buildProductIndex(products);

  /* Exact names first, so a title that exists is never merely "searched for". */
  const byName = new Map<string, Record<string, unknown>>();
  for (const product of products) {
    for (const folded of namesOf(product)) {
      if (!byName.has(folded)) byName.set(folded, product);
    }
  }

  const used = new Set<string>();

  return lines.map((line) => {
    const exact = byName.get(normalize(line));
    if (exact && !used.has(String(exact["id"]))) {
      used.add(String(exact["id"]));
      return { line, product: exact, score: 1, status: "matched" as const };
    }

    /*
      Skipping products already claimed by an earlier line keeps a bundle
      listing two entries of a series from collapsing onto the same record.
    */
    const hit = searchProducts(index, line, { limit: 5 }).find(
      (row) => !used.has(String(row.product["id"])),
    );

    if (hit && hit.score >= threshold && coverage(line, hit.product) >= MIN_TITLE_COVERAGE) {
      used.add(String(hit.product["id"]));
      return { line, product: hit.product, score: hit.score, status: "matched" as const };
    }

    return { line, score: hit?.score ?? 0, status: "missing" as const };
  });
}

/** Everything in one call, for the button the admin presses. */
export function extractBundleGames(
  description: string,
  products: readonly Record<string, unknown>[],
  options?: MatchOptions,
): BundleGameMatch[] {
  return matchBundleGames(parseBundleGameLines(description), products, options);
}
