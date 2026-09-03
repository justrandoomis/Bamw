/**
 * Wikidata, read as a second source of Chinese supplier names.
 *
 * Nintendo's Hong Kong catalogue is the first source and the better one — it is
 * the storefront the game is actually sold on — but it can only be reached from
 * a Latin title, and it writes most of its Chinese-named games in Chinese on
 * every field. Our catalogue is titled in English and Arabic, so those rows are
 * unreachable however good the names on them are.
 *
 * Wikidata is reachable from an English title by construction, publishes
 * `zh-hans` separately from `zh-hant`, and gives a URL per item that a person
 * can open and check. What it does not give is any guarantee that the item it
 * returned is the game: `wbsearchentities` will happily hand back a film, a
 * novel or a different game in the series.
 *
 * So every rule here is a way of refusing a wrong item:
 *
 *   - the item must be an instance of a video game;
 *   - its English label or one of its English aliases must match the title we
 *     asked for, whole, under the same normalisation the language audit uses;
 *   - the Chinese label must actually be Chinese.
 *
 * A candidate that fails any of those is not returned at all. There is no
 * "closest match" branch: a near-miss once wrote one game's data onto another
 * in this codebase, and a wrong supplier name gets an order placed for the
 * wrong game.
 */

import { comparableTitle } from "./region-language.mjs";

/* The same range `checkSupplierNameZh` uses, so a name this file calls Chinese
   is one the application also reads as Chinese. */
const HAN = /[一-鿿㐀-䶿豈-﫿]/;

/** `instance of` → `video game`. The one claim that says this is a game. */
const P_INSTANCE_OF = "P31";
const Q_VIDEO_GAME = "Q7889";

const API = "https://www.wikidata.org/w/api.php";

export const wikidataItemUrl = (id) => `https://www.wikidata.org/wiki/${id}`;

/**
 * The game, with the platform this shop sells it for taken off the end.
 *
 * The catalogue distinguishes products Wikidata does not have items for: the
 * Switch 1 and Switch 2 releases of one game are two things to sell and one
 * thing to look up. Searching `Hollow Knight switch 1` finds nothing at all,
 * so the suffix has to come off before the search or the whole source is
 * unreachable for a third of the shelf.
 *
 * Only suffixes are stripped, and only the shapes the catalogue actually uses.
 * `Nintendo Switch Sports` and `Nintendo Switch 2 Welcome Tour` are games whose
 * names contain the console; `EA SPORTS FIFA 23 Nintendo Switch Legacy Edition`
 * is an edition Nintendo itself named. None of them match, and none of them
 * should: a normaliser that eats part of a real name is how one game's data
 * gets written onto another.
 */
export function baseTitle(text) {
  let out = String(text ?? "").trim();
  /* `Zelda [Switch 2]` — the shop's own platform tag. */
  out = out.replace(/\s*\[\s*switch\s*2?\s*\]\s*$/i, "");
  /*
    `… — Nintendo Switch 2 Edition`, and anything after it: one title carries
    `+ Jamboree TV` past the edition, which is a bundle, not a different game.
    The dash is required — without it this would eat `Nintendo Switch Sports`.
  */
  out = out.replace(/\s*[-–—]\s*Nintendo Switch\s*2?\s*Edition\b.*$/i, "");
  /* `Tomb Raider … switch 1&2`, `Hollow Knight switch 1`, `Stray switch 2`. */
  out = out.replace(/\s+switch\s*1\s*&\s*2\s*$/i, "");
  out = out.replace(/\s+switch\s*[12]\s*$/i, "");
  return out.trim();
}

export function searchUrl(title, limit = 5) {
  const params = new URLSearchParams({
    action: "wbsearchentities",
    search: String(title ?? ""),
    language: "en",
    uselang: "en",
    type: "item",
    limit: String(limit),
    format: "json",
    origin: "*",
  });
  return `${API}?${params}`;
}

export function entitiesUrl(ids) {
  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: ids.join("|"),
    props: "labels|aliases|claims",
    languages: "en|zh|zh-hans|zh-cn|zh-hant",
    format: "json",
    origin: "*",
  });
  return `${API}?${params}`;
}

/** Is this item an instance of a video game? */
export function isVideoGame(entity) {
  const claims = entity?.claims?.[P_INSTANCE_OF] ?? [];
  return claims.some((claim) => claim?.mainsnak?.datavalue?.value?.id === Q_VIDEO_GAME);
}

/** Every English name this item answers to — its label and its aliases. */
export function englishNames(entity) {
  const out = [];
  const label = entity?.labels?.en?.value;
  if (label) out.push(String(label));
  for (const alias of entity?.aliases?.en ?? []) {
    if (alias?.value) out.push(String(alias.value));
  }
  return out;
}

/**
 * Does this item answer to the title we asked for?
 *
 * Whole-string equality after normalisation, never containment: "Pokémon
 * Scarlet" is contained in "Pokémon Scarlet and Violet" and they are two
 * different products.
 */
export function titleMatches(entity, englishTitle) {
  const want = comparableTitle(englishTitle);
  if (!want) return false;
  return englishNames(entity).some((name) => comparableTitle(name) === want);
}

/**
 * The Simplified Chinese label, preferring the codes that say "Simplified".
 *
 * `zh` on its own is whatever the last editor wrote and is taken only when the
 * explicit codes are absent — and `checkSupplierNameZh` still refuses it
 * downstream if it reads as Traditional.
 */
export function chineseLabelOf(entity) {
  for (const code of ["zh-hans", "zh-cn", "zh"]) {
    const value = String(entity?.labels?.[code]?.value ?? "").trim();
    if (value && HAN.test(value)) return { name: value, lang: code };
  }
  return null;
}

/**
 * One game against a page of Wikidata items.
 *
 * Returns `{ name, sourceUrl, itemId, lang }` for the first item that is a
 * video game, answers to this exact title, and carries a Chinese label —
 * or `null`, which means "no source found", never "here is my best guess".
 */
export function pickWikidataName(entities, englishTitle) {
  for (const [id, entity] of Object.entries(entities ?? {})) {
    if (!isVideoGame(entity)) continue;
    if (!titleMatches(entity, englishTitle)) continue;
    const label = chineseLabelOf(entity);
    if (!label) continue;
    return { name: label.name, lang: label.lang, itemId: id, sourceUrl: wikidataItemUrl(id) };
  }
  return null;
}
