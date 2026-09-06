/**
 * Finding a game in the shop.
 *
 * The header searched `title`, `titleEn` and `description` with a plain
 * substring test, and production says what that was worth: every one of the
 * 150 products has `title` and `titleEn` set to the same English string, so
 * the test ran twice on one value; and the Arabic name lives in `titleAr`,
 * which the storefront's payload did not carry. Nine ordinary Arabic queries
 * — «زيلدا», «ماريو», «سوبر ماريو», «نينتندو سويتش ٢» — returned **nothing**,
 * in a shop whose every screen is in Arabic and 133 of whose 150 products have
 * an Arabic name.
 *
 * The field matching is shared with the troubleshooting search (relevance.ts);
 * the policy here is this catalogue's own, and it differs in one way that
 * matters more than all the weights put together:
 *
 * **Every word the customer typed has to match something.** A help page that
 * offers a near-miss is being helpful. A shop that answers «غسالة» with Mario
 * Kart is broken, and a shop that answers «mario kart» with every Mario game
 * is not much better. Words the customer did not type — the ones synonym
 * expansion adds — are allowed to miss.
 */

import { normalize, squash, tokenizeQuery, type QueryToken } from "./normalize";
import { buildField, matchQuality, type IndexedField } from "./relevance";

/**
 * Names a customer uses that the catalogue does not.
 *
 * Kept small and specific on purpose. The Arabic titles carry most of this
 * already — «أسطورة زيلدا», «سوبر ماريو» — so this is for the two cases they
 * cannot cover: the abbreviations people actually type, and the section words
 * that appear on no product at all.
 */
const PRODUCT_SYNONYMS: Record<string, string[]> = {
  /*
    Abbreviations no title contains.

    Deliberately narrow. «botw» meant «breath of the wild» *and* «زيلدا» at
    first, which made the abbreviation match both Zelda games exactly as well
    as each other — the Arabic titles already make «زيلدا» find the pair, and
    the whole value of an abbreviation is that it names one game.
  */
  botw: ["breath of the wild"],
  totk: ["tears of the kingdom"],
  ac: ["animal crossing"],
  smash: ["super smash bros", "سماش"],
  mk: ["mario kart"],
  mk8: ["mario kart 8"],
  splat: ["splatoon"],
  poke: ["pokemon", "بوكيمون"],
  bde: ["bayonetta"],

  // Section words. A customer types the shelf, not the product.
  العاب: ["game", "لعبه"],
  لعبه: ["game"],
  بطاقه: ["gift card", "eshop", "بطاقات"],
  بطاقات: ["gift card", "eshop"],
  كارت: ["gift card", "eshop", "بطاقه"],
  كروت: ["gift card", "eshop", "بطاقه"],
  شحن: ["gift card", "eshop", "بطاقه"],
  جهاز: ["hardware", "console", "switch"],
  اجهزه: ["hardware", "console"],
  ملحقات: ["accessory", "accessories"],
  مستعمل: ["used"],
  حزمه: ["bundle"],
  اميبو: ["amiibo"],

  // Spellings of the console that differ from the catalogue's.
  سويج: ["switch"],
  سويتش: ["switch"],
  نينتيندو: ["nintendo", "نينتندو"],
};

/** The ceiling one word can earn from each field. */
const WEIGHTS = {
  /*
    Both names lead, and equally. `title` is not listed separately because on
    every product in this catalogue it holds the same string as `titleEn`;
    indexing it again would let a product outscore another for having the same
    word twice.
  */
  name: 1,
  subtitle: 0.82,
  franchise: 0.78,
  people: 0.6,
  section: 0.55,
  description: 0.3,
} as const;

export interface IndexedProduct {
  product: Record<string, unknown>;
  fields: IndexedField[];
  /** Both names, squashed — for whole-phrase and prefix matching. */
  nameBlob: string;
  /** For the tie-break: what sells, and where the admin put it. */
  sales: number;
  displayOrder: number;
}

export interface ProductSearchResult {
  product: Record<string, unknown>;
  score: number;
  /** Query words that actually hit, for highlighting. */
  matched: string[];
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(text).filter(Boolean) : text(value) ? [text(value)] : [];

const field = (values: string[], weight: number) => buildField(values, weight, normalize, squash);

export function buildProductIndex(
  products: readonly Record<string, unknown>[],
): IndexedProduct[] {
  return products.map((product) => {
    const names = [text(product["titleEn"]), text(product["titleAr"]), text(product["english_name"])]
      .filter(Boolean);
    /*
      `title` only when it says something the English name does not. On this
      catalogue it never does, but a product edited by hand could, and a name
      the customer can see should be a name they can search.
    */
    const title = text(product["title"]);
    if (title && !names.includes(title)) names.push(title);

    return {
      product,
      fields: [
        field(names, WEIGHTS.name),
        field([text(product["subtitle"]), text(product["slug"]).replace(/-/g, " ")], WEIGHTS.subtitle),
        field(
          [
            ...list(product["seriesName"]),
            ...list(product["seriesNameEn"]),
            ...list(product["series"]),
            ...list(product["franchise"]),
            ...list(product["tags"]),
          ],
          WEIGHTS.franchise,
        ),
        field([text(product["developer"]), text(product["publisher"]), text(product["brand"])], WEIGHTS.people),
        field(
          [
            ...list(product["genre"]),
            ...list(product["genres"]),
            text(product["categoryTitle"]),
            text(product["platform"]),
            text(product["kind"]),
          ],
          WEIGHTS.section,
        ),
        field([text(product["description"])], WEIGHTS.description),
      ],
      nameBlob: names.map(squash).join("|"),
      sales: Number(product["sales"]) || 0,
      displayOrder: Number(product["displayOrder"]) || 0,
    };
  });
}

/**
 * One word the customer typed, with the words it also means.
 *
 * The distinction matters because «سويتش» and «switch» are not two things the
 * customer asked for — they are one thing, spelled two ways, and only one of
 * them is in the catalogue. Scoring them as separate words halves the score of
 * a product that has the only spelling it could have; requiring both to land
 * finds nothing at all.
 */
interface QueryWord {
  token: QueryToken;
  /**
   * What else this word means, one entry per synonym — and a synonym is a
   * phrase, not a bag of words. «botw» means «breath of the wild», which a
   * product either is or is not; scoring its four words independently let a
   * different Zelda game claim the abbreviation on the strength of «of» and
   * «the».
   */
  alternatives: QueryToken[][];
}

/**
 * Group the expansion back under the words it came from.
 *
 * `tokenizeQuery` returns one flat list and marks what it invented, which is
 * all the troubleshooting search needs. Here it is not enough: a shop has to
 * know *which* typed word a synonym stands in for, so that word can be counted
 * as answered when its synonym is the spelling the catalogue happens to use.
 */
function planQuery(rawQuery: string): QueryWord[] {
  const tokens = tokenizeQuery(rawQuery, PRODUCT_SYNONYMS);
  const byValue = new Map(tokens.map((token) => [token.value, token]));

  return tokens
    .filter((token) => !token.derived)
    .map((token) => {
      const alternatives: QueryToken[][] = [];
      const seen = new Set<string>();
      for (const seed of [token.value, token.stem]) {
        for (const synonym of PRODUCT_SYNONYMS[seed] ?? []) {
          const normalized = normalize(synonym);
          if (!normalized || seen.has(normalized)) continue;
          seen.add(normalized);
          const parts = normalized
            .split(" ")
            .map((part) => byValue.get(part))
            .filter((part): part is QueryToken => Boolean(part) && part !== token);
          if (parts.length > 0) alternatives.push(parts);
        }
      }
      return { token, alternatives };
    });
}

function scoreProduct(
  entry: IndexedProduct,
  words: QueryWord[],
  squashedQuery: string,
): { score: number; matched: string[]; missedTyped: boolean } {
  let weighted = 0;
  let totalWeight = 0;
  let missedTyped = false;
  const matched: string[] = [];

  const bestFor = (token: QueryToken) => {
    let best = 0;
    for (const indexed of entry.fields) {
      const quality = matchQuality(token, indexed);
      if (quality === 0) continue;
      const value = quality * indexed.weight;
      if (value > best) best = value;
    }
    return best;
  };

  for (const { token, alternatives } of words) {
    let best = bestFor(token);
    /*
      A synonym is worth a shade less than the word itself: «كارت» reaching a
      gift card through «card» is a good answer, and the product actually
      titled «كارت» is a better one.

      A multi-word synonym is scored across its own words, and the filler in it
      is left out of that average — «breath of the wild» is answered by
      «breath» and «wild», and a game that has only «of» and «the» has not
      answered it at all.
    */
    for (const phrase of alternatives) {
      const carrying = phrase.filter((part) => !part.weak);
      const parts = carrying.length > 0 ? carrying : phrase;
      const mean = parts.reduce((total, part) => total + bestFor(part), 0) / parts.length;
      const value = mean * 0.85;
      if (value > best) best = value;
    }

    /*
      A word the customer typed that this product has nowhere, under any of its
      spellings. The product is out — not merely ranked lower — which is what
      keeps «mario kart» from returning every Mario game. Filler like «the» is
      not held against it.
    */
    if (best === 0 && !token.weak) missedTyped = true;

    const weight = token.weak ? 0.2 : 1;
    weighted += best * weight;
    totalWeight += weight;
    if (best >= 0.5) matched.push(token.value);
  }

  if (totalWeight === 0) return { score: 0, matched, missedTyped };
  let score = weighted / totalWeight;

  /*
    The whole query is the start of a name. «ماريو كارت» against «ماريو كارت
    وورلد» is not a fuzzy match — it is the customer halfway through typing the
    thing they want, and it should sit above a product that merely contains
    both words apart.
  */
  if (squashedQuery.length >= 3) {
    for (const name of entry.nameBlob.split("|")) {
      if (name.startsWith(squashedQuery)) { score += 0.3; break; }
      if (name.includes(squashedQuery)) { score += 0.15; break; }
    }
  }

  return { score: Math.min(score, 1), matched, missedTyped };
}

export interface ProductSearchOptions {
  threshold?: number;
  limit?: number;
  /**
   * Raise the bar for the relaxed pass, or set it to 1 to switch it off.
   *
   * Left alone, a query no product satisfies in full falls back to its best
   * partial matches — see `searchProducts`.
   */
  relaxedThreshold?: number;
}

/**
 * Rank the catalogue against what somebody typed.
 *
 * Ties are broken by what sells, then by the order the admin arranged the shelf
 * in — so two equally good matches come back in the order the shop would have
 * shown them anyway, rather than in whatever order the array happened to be in.
 */
export function searchProducts(
  index: readonly IndexedProduct[],
  rawQuery: string,
  { threshold = 0.32, limit = 24, relaxedThreshold = 0.45 }: ProductSearchOptions = {},
): ProductSearchResult[] {
  const words = planQuery(rawQuery);
  if (words.length === 0) return [];
  const squashedQuery = squash(rawQuery);

  const scored = index
    .map((entry) => ({ entry, ...scoreProduct(entry, words, squashedQuery) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.entry.sales - a.entry.sales ||
        a.entry.displayOrder - b.entry.displayOrder,
    );

  const take = (rows: typeof scored) =>
    rows.slice(0, limit).map(({ entry, score, matched }) => ({
      product: entry.product,
      score,
      matched,
    }));

  const strict = scored.filter((item) => !item.missedTyped && item.score >= threshold);
  if (strict.length > 0) return take(strict);

  /*
    Nothing matched every word. Rather than an empty page, the best partial
    matches — at a distinctly higher bar, because this is the pass that can say
    something silly. «mario kart 9» does not exist, and answering it with Mario
    Kart 8 is the whole point; answering «غسالة» with anything is not, and a
    score of 0.5 earned from one weak field is not reachable by a word the
    catalogue has never seen.
  */
  return take(scored.filter((item) => item.score >= relaxedThreshold));
}

/** Index and search in one call, for a caller that has no index to keep. */
export function searchCatalogue(
  products: readonly Record<string, unknown>[],
  rawQuery: string,
  options?: ProductSearchOptions,
): ProductSearchResult[] {
  return searchProducts(buildProductIndex(products), rawQuery, options);
}
