/**
 * The curated Chinese names — the source of record, and the first one asked.
 *
 * The automated sources answer for the games that happen to have a Wikidata
 * label, and they answer with the *base game's* name: they have no way to know
 * that `Cyberpunk 2077: Ultimate Edition` and `Cyberpunk 2077` are two things
 * to order, or that the Switch 2 release of a game is a different SKU from the
 * Switch 1 one. A supplier needs the name of the thing being bought.
 *
 * So the names in `data/supplier-names-zh.json` are researched one game at a
 * time — Nintendo or the publisher in Simplified Chinese first, then the
 * official Chinese store page, then Steam's Simplified listing, then Hong Kong
 * or Taiwan converted, and only then the trade name the Chinese market uses,
 * confirmed in two places. Each entry carries the source it came from.
 *
 * Keyed by the shelf title, matched exactly first and then through the same
 * normalisation the language audit uses, so punctuation and case in the
 * catalogue cannot silently orphan an entry.
 */

import { comparableTitle } from "./region-language.mjs";

/** CJK Unified Ideographs, the Extension A block, and the compatibility block. */
const HAN = /[一-鿿㐀-䶿豈-﫿]/;

/**
 * Build the lookup, refusing anything malformed rather than storing it.
 *
 * A curated file is edited by hand, and the two mistakes that follow from that
 * are an entry with no Chinese in it and an entry with no source. Both are
 * refused loudly here rather than written to production quietly.
 */
export function curatedIndex(file) {
  const byTitle = new Map();
  const problems = [];

  for (const [title, entry] of Object.entries(file?.names ?? {})) {
    const name = String(entry?.zh ?? "").trim();
    const source = String(entry?.source ?? "").trim();
    const status = String(entry?.status ?? "needs_review").trim();

    if (!name) {
      problems.push(`${title}: no name`);
      continue;
    }
    /*
      Every name carries Chinese, with no exception and no flag to opt out of it.
      A handful of games have no Chinese title at all — `1-2-Switch` is called
      that on Nintendo's own Hong Kong and Taiwan pages, `Go-Go Town!` on every
      Chinese listing — and an earlier version let those through as bare Latin
      under a `latin: true` flag. That is a value a supplier cannot act on: it
      looks exactly like the English title nobody meant to send.

      What goes in the field instead says so, in Chinese:
      `Go-Go Town!（中国区官方沿用英文名）` — the name China actually uses, and a
      note that this is why. The official Latin title is untouched; it lives on
      the product's own `titleEn`, which is what the admin reads on the card.
      No invented translation is ever presented as an official one.
    */
    if (!HAN.test(name)) {
      problems.push(`${title}: the name carries no Chinese at all`);
      continue;
    }
    if (!source) {
      problems.push(`${title}: no source`);
      continue;
    }
    if (status !== "verified" && status !== "needs_review") {
      problems.push(`${title}: status ${status} is neither verified nor needs_review`);
      continue;
    }

    const record = { name, sourceUrl: source, status, title };
    byTitle.set(title, record);
    const key = comparableTitle(title);
    if (key && !byTitle.has(key)) byTitle.set(key, record);
  }

  return { byTitle, problems };
}

/**
 * This game's curated name, or null.
 *
 * The exact shelf title first, then the normalised one — an entry written
 * `Pokémon Pokopia` should still find a product titled `Pokemon Pokopia`.
 */
export function curatedNameFor(game, byTitle) {
  for (const value of [game?.titleEn, game?.title]) {
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    if (byTitle.has(raw)) return byTitle.get(raw);
    const key = comparableTitle(raw);
    if (key && byTitle.has(key)) return byTitle.get(key);
  }
  return null;
}
