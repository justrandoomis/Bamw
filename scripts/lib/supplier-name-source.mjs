/**
 * Nintendo Hong Kong, read as a source of Chinese supplier names.
 *
 * Separated from `scripts/supplier-name-fill.mjs` so the matching can be tested
 * against the catalogue that is actually committed, rather than only being
 * exercised by a run that writes to production.
 *
 * The rule this file exists to hold: a name is either found in Nintendo's own
 * catalogue, or it is not found. There is no third branch that derives one, and
 * the English title is never returned as a Chinese name — an order placed
 * against an English title is an order placed for the wrong thing.
 */

import { comparableTitle, latinFragments } from "./region-language.mjs";

/*
  CJK Unified Ideographs plus the Extension A and compatibility blocks — the
  same range `checkSupplierNameZh` uses, so a name this file calls Chinese is
  one the application also reads as Chinese.
*/
const HAN = /[一-鿿㐀-䶿豈-﫿]/;

export const HK_TITLE_URL = (nsuid) => `https://ec.nintendo.com/HK/zh/titles/${nsuid}`;

/**
 * Every name a Hong Kong row can be found under, keyed by the audit's own
 * normalisation.
 *
 * Wider than the language audit's index, which skips a row carrying no language
 * list: a row that cannot say which languages it ships still says what Nintendo
 * calls the game in Chinese, and that is the only question here.
 */
export function hkNameIndex(titles) {
  const byTitle = new Map();
  for (const row of titles ?? []) {
    for (const name of [row?.storeName, row?.catalogueTitle]) {
      for (const form of [name, ...latinFragments(name)]) {
        const key = comparableTitle(form);
        if (key && !byTitle.has(key)) byTitle.set(key, row);
      }
    }
  }
  return byTitle;
}

/** The Chinese name on a Hong Kong row, or "" when it sells under a Latin one. */
export function chineseNameOf(row) {
  for (const candidate of [row?.storeName, row?.catalogueTitle]) {
    const name = String(candidate ?? "").trim();
    if (name && HAN.test(name)) return name;
  }
  return "";
}

/** Every English-ish name this product could be listed under in Hong Kong. */
export function candidateTitles(game) {
  const out = [];
  for (const value of [game?.titleEn, game?.title, game?.slug]) {
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    out.push(raw);
    /*
      A slug is the title with hyphens. The normaliser drops them anyway, so
      this changes no outcome — it keeps the candidate readable in the report,
      which is what an admin checking a wrong match will be reading.
    */
    if (raw.includes("-")) out.push(raw.split("-").join(" "));
  }
  return out;
}

/**
 * One game against the catalogue.
 *
 * `outcome` is one of:
 *   found          — Nintendo publishes a Chinese name for it
 *   latin_name     — it is in the catalogue, sold under a Latin name
 *   not_in_catalogue
 */
export function matchSupplierName(game, byTitle) {
  for (const candidate of candidateTitles(game)) {
    const key = comparableTitle(candidate);
    if (!key || !byTitle.has(key)) continue;
    const row = byTitle.get(key);
    const name = chineseNameOf(row);
    if (!name) return { outcome: "latin_name", via: candidate, row };
    return { outcome: "found", via: candidate, row, name, sourceUrl: HK_TITLE_URL(row.nsuid) };
  }
  return { outcome: "not_in_catalogue" };
}
