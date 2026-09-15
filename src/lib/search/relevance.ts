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

import {
  consonantSkeleton,
  editDistance,
  phoneticKey,
  stem,
  typoBudget,
  type QueryToken,
} from "./normalize";

export interface IndexedField {
  /** Normalised tokens of every value in this field. */
  tokens: string[];
  stems: string[];
  /** All values joined and stripped of spaces, for run-together matching. */
  squashed: string;
  /*
    The same tokens in one alphabet, so a catalogue written in English can be
    searched in Arabic and the other way round. Needed because most of this
    shop's products no longer carry a translated title to match against — see
    `phoneticKey`.
  */
  phonetics: string[];
  /** Their consonants, for the short vowels Arabic does not write. */
  skeletons: string[];
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

  if (field.tokens.includes(value)) {
    /*
      One letter that happens to be a whole token is punctuation, not a word.

      «Worms W.M.D» folds to «worms w m d», so the query «m» matches a token
      exactly and scored 1 — ahead of «Metroid Prime 4», which only *starts*
      with an m. That is backwards: the initial of an initialism is the
      weakest possible evidence, and the game whose name begins with the letter
      is what somebody typing one letter is reaching for.

      Digits are exempt. «8» is a real token of «Mario Kart 8 Deluxe» and
      matching it exactly is exactly right.
    */
    if (value.length === 1 && !/[0-9]/.test(value)) return 0.5;
    return 1;
  }
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
  }

  /*
    The same word, in the other alphabet.

    Sits just below a same-script prefix: «zelda» typed as «زيلدا» is the word
    itself, not an approximation of it, and the only reason it is not scored 1
    is that transliteration is a lossy round trip and an exact hit here is
    slightly weaker evidence than an exact hit there.
  */
  if (token.phonetic && field.phonetics.includes(token.phonetic)) return 0.86;

  if (value.length >= 3 && field.squashed.includes(value)) return 0.76;

  /*
    Consonants only — «سوبر» and «super».

    Arabic writes short vowels as marks nobody types, so the two spellings of
    the same word can differ by more edits than any budget safe enough to use.
    Their consonants are identical. Scored below the run-together rung because
    dropping the vowels genuinely does lose information, and only consulted at
    three consonants or more (see `consonantSkeleton`).
  */
  if (token.skeleton && field.skeletons.includes(token.skeleton)) return 0.74;

  const budget = typoBudget(value.length);
  if (budget > 0) {
    let best = 0;
    for (const candidate of field.tokens) {
      const distance = editDistance(value, candidate, budget);
      if (distance > budget) continue;
      const quality = 0.82 - 0.18 * (distance - 1);
      if (quality > best) best = quality;
      if (best >= 0.82) break;
    }
    if (best > 0) return best;
  }

  /*
    The other alphabet, a typo away. «زلدا» — one letter short — for «zelda».

    Discounted harder than a same-script typo, because two lossy steps have
    been taken rather than one: the transliteration and then the edit.
  */
  /*
    The same budget the alphabet it was written in would get, and no more.

    One extra edit was tried, to reach the case transliteration loses on its
    own: «فاير» becomes «fair» while «fire» stays «fire», two edits apart with
    nobody having mistyped anything, so «فاير امبلم» finds none of the nine
    Fire Emblem games while «fire emblem» finds all of them.

    It was reverted, because the measurement over the real 1,530-game catalogue
    was unambiguous: «غسالة» — a washing machine, the standing example of what
    this shop must answer with nothing — came back with Salt and Sacrifice,
    Sally Face and Gal Guardians. Answering a word the catalogue has never seen
    is a worse failure than missing one spelling of a word it has, so the
    Arabic spelling of «fire» is a limitation this rung does not cover.
  */
  const phoneticBudget = typoBudget(token.phonetic.length);
  if (token.phonetic && phoneticBudget > 0) {
    let best = 0;
    for (const candidate of field.phonetics) {
      const distance = editDistance(token.phonetic, candidate, phoneticBudget);
      if (distance > phoneticBudget) continue;
      const quality = 0.7 - 0.15 * (distance - 1);
      if (quality > best) best = quality;
      if (best >= 0.7) break;
    }
    if (best > 0) return best;
  }

  /*
    One or two letters, and a name that starts with them.

    This rung is the answer to the complaint that the box does nothing until
    the whole name is typed. It was fenced off entirely — the prefix test above
    requires three characters and the typo budget is zero below three — so «z»
    and «ma» scored zero against every product in the shop and the dropdown
    stayed empty until the fourth keystroke.

    Deliberately weak. One letter is not evidence that this is the game, it is
    evidence that this is one of the games it could be, and what turns the list
    into an answer is the ranking: `scoreProduct` adds a bonus when the *name*
    starts with what was typed, so «z» puts Zelda above a game that merely has
    a word starting with z in the middle of its title.
  */
  if (value.length <= 2) {
    for (const candidate of field.tokens) {
      if (candidate.startsWith(value)) return value.length === 2 ? 0.66 : 0.5;
    }
    /*
      And across alphabets, which is not the same test.

      «ب» is one letter and «bayonetta» starts with one too, but they are not
      the same character, so the loop above compares them and finds nothing —
      an Arabic customer typing their first letter got the empty box back that
      this whole rung exists to stop. The transliterated forms do start alike.
    */
    if (token.phonetic) {
      for (const candidate of field.phonetics) {
        if (candidate.startsWith(token.phonetic)) {
          return token.phonetic.length >= 2 ? 0.6 : 0.46;
        }
      }
    }
  }

  return 0;
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
  /*
    Deduplicated before the phonetic keys are built.

    A field is every value of that role on the product, and titles repeat words
    — «Nintendo Switch 2 Edition» beside «Nintendo Switch» — so the same token
    was being transliterated several times per product, over seventeen hundred
    products, on a phone.
  */
  const unique = [...new Set(tokens)];
  return {
    tokens,
    stems: tokens.map(stem),
    squashed: values.map(squashOne).join(" "),
    phonetics: unique.map(phoneticKey).filter(Boolean),
    skeletons: [...new Set(unique.map(consonantSkeleton).filter(Boolean))],
    weight,
  };
}
