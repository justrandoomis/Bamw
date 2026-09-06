/**
 * How well one typed word matches one field of one thing.
 *
 * This is the mechanism the shop's two searches share, and deliberately only
 * the mechanism. The troubleshooting search and the product search normalise
 * text the same way, forgive the same typos and recognise the same
 * run-together forms — but they must not score the same way, and the
 * difference is not a detail:
 *
 *   A help page that offers a near-miss is being helpful. A shop that answers
 *   «غسالة» with Mario Kart is broken.
 *
 * So `matchQuality` — exact, then stem, then prefix, then run-together, then
 * typo — lives here and is used by both. What each does with the answer (which
 * fields it weights, whether every word must match, how it breaks ties) stays
 * with the catalogue that knows.
 */

import { editDistance, stem, typoBudget, type QueryToken } from "./normalize";

export interface IndexedField {
  /** Normalised tokens of every value in this field. */
  tokens: string[];
  stems: string[];
  /** All values joined and stripped of spaces, for run-together matching. */
  squashed: string;
  weight: number;
}

/**
 * The quality ladder, 0–1.
 *
 * The rungs are ordered by how much the match tells you: the word itself, the
 * word's stem, a word that begins with it, the word buried in a run-together
 * phrase, and finally a word a typo away. Prefix sits high on purpose — search
 * is typed one letter at a time, and «ماري» is on its way to «ماريو» rather
 * than being a mistake.
 */
export function matchQuality(token: QueryToken, field: IndexedField): number {
  if (field.tokens.length === 0) return 0;

  const { value, stem: tokenStem } = token;

  if (field.tokens.includes(value)) return 1;
  if (field.stems.includes(tokenStem)) return 0.95;

  if (value.length >= 3) {
    for (const candidate of field.tokens) {
      /*
        The typed word is the start of an indexed one — «ماري» on its way to
        «ماريو» — or the indexed word is the start of the typed one, which is
        how «switch2» reaches «switch». The second direction needs a floor of
        its own: a title containing «of» or «a» would otherwise make every
        word beginning with those letters a strong match.
      */
      if (candidate.startsWith(value) || (candidate.length >= 3 && value.startsWith(candidate))) {
        return 0.88;
      }
    }
    if (field.squashed.includes(value)) return 0.76;
  }

  const budget = typoBudget(value.length);
  if (budget === 0) return 0;

  let best = 0;
  for (const candidate of field.tokens) {
    const distance = editDistance(value, candidate, budget);
    if (distance > budget) continue;
    const quality = 0.82 - 0.18 * (distance - 1);
    if (quality > best) best = quality;
    if (best >= 0.82) break;
  }
  return best;
}

/** Index one field's values, folded and pre-stemmed so scoring stays cheap. */
export function buildField(
  values: readonly string[],
  weight: number,
  fold: (value: string) => string,
  squashOne: (value: string) => string,
): IndexedField {
  const tokens: string[] = [];
  for (const value of values) {
    const normalized = fold(value);
    if (!normalized) continue;
    tokens.push(...normalized.split(" "));
  }
  return {
    tokens,
    stems: tokens.map(stem),
    squashed: values.map(squashOne).join(" "),
    weight,
  };
}
