import type { Problem } from "@/lib/problems/types";
import { normalize, squash, tokenizeQuery, type QueryToken } from "./normalize";
/*
  The field matching is shared with the product search; the weights, the
  aggregation and the cutoffs below are this catalogue's own. See relevance.ts
  for why the line is drawn there.
*/
import {
  buildField as sharedBuildField,
  matchQuality,
  type IndexedField,
} from "./relevance";

/**
 * Relevance search over the troubleshooting catalogue.
 *
 * Deliberately not a literal substring match: a query is tokenised, expanded
 * with colloquial and cross-language synonyms, then scored against every
 * indexed field of every problem with typo tolerance.
 */

export interface IndexedProblem {
  problem: Problem;
  fields: IndexedField[];
  /** Title + aliases + keywords, squashed — used for whole-phrase matching. */
  phraseBlob: string;
  errorCodes: string[];
}

export interface SearchResult {
  problem: Problem;
  /** Raw relevance, 0–1. */
  score: number;
  /** Calibrated percentage shown to the user. */
  percent: number;
  /** Normalised query tokens that actually hit, for highlighting. */
  matched: string[];
}

/* Field weights — the ceiling a single token can earn from that field. */
const WEIGHTS = {
  title: 1,
  errorCodes: 1,
  aliases: 0.96,
  keywords: 0.9,
  langKeywords: 0.86,
  symptoms: 0.8,
  related: 0.72,
  description: 0.5,
  solution: 0.36,
} as const;

function buildField(values: string[], weight: number): IndexedField {
  return sharedBuildField(values, weight, normalize, squash);
}

export function buildIndex(problems: Problem[]): IndexedProblem[] {
  return problems.map((problem) => {
    const solutionText = [
      problem.cause,
      ...problem.steps.flatMap((step) => [step.title, step.detail ?? "", step.hint ?? ""]),
    ];

    const fields: IndexedField[] = [
      buildField([problem.title], WEIGHTS.title),
      buildField(problem.relatedErrors, WEIGHTS.errorCodes),
      buildField(problem.aliases, WEIGHTS.aliases),
      buildField(problem.keywords, WEIGHTS.keywords),
      buildField(
        [...problem.arabicKeywords, ...problem.englishKeywords, ...problem.kurdishKeywords],
        WEIGHTS.langKeywords,
      ),
      buildField(problem.symptoms, WEIGHTS.symptoms),
      buildField([...problem.relatedGames, ...problem.relatedProducts], WEIGHTS.related),
      buildField([problem.description], WEIGHTS.description),
      buildField(solutionText, WEIGHTS.solution),
    ];

    return {
      problem,
      fields,
      phraseBlob: [
        problem.title,
        ...problem.aliases,
        ...problem.keywords,
        ...problem.symptoms,
        ...problem.englishKeywords,
      ]
        .map(squash)
        .join("|"),
      errorCodes: problem.relatedErrors.map(squash),
    };
  });
}

/** How much a token contributes to the final average. */
function tokenWeight(token: QueryToken): number {
  if (token.weak) return 0.2;
  if (token.derived) return 0.5;
  return 1;
}

function scoreProblem(
  entry: IndexedProblem,
  tokens: QueryToken[],
  squashedQuery: string,
): { score: number; matched: string[] } {
  let weighted = 0;
  let totalWeight = 0;
  const matched: string[] = [];

  for (const token of tokens) {
    let best = 0;
    for (const field of entry.fields) {
      const quality = matchQuality(token, field);
      if (quality === 0) continue;
      const value = quality * field.weight;
      if (value > best) best = value;
    }

    if (token.derived) best *= 0.85;

    const weight = tokenWeight(token);
    weighted += best * weight;
    totalWeight += weight;

    if (best >= 0.5 && !token.derived) matched.push(token.value);
  }

  if (totalWeight === 0) return { score: 0, matched };

  let score = weighted / totalWeight;

  // Whole-phrase hit: the user typed something we literally know about.
  if (squashedQuery.length >= 4 && entry.phraseBlob.includes(squashedQuery)) {
    score += 0.25;
  }

  // An error code typed verbatim is as unambiguous as search input gets.
  if (
    squashedQuery.length >= 4 &&
    entry.errorCodes.some((code) => code.includes(squashedQuery) || squashedQuery.includes(code))
  ) {
    score += 0.3;
  }

  return { score: Math.min(score, 1), matched };
}

export interface SearchOptions {
  /** Minimum raw score to be considered a result at all. */
  threshold?: number;
  /**
   * Results scoring below this fraction of the best result are dropped.
   *
   * A single strong hit should not drag along a tail of incidental matches —
   * a query like "الحساب ما يدخل" brushes against the word "يدخل" buried in
   * another problem's prose, and listing that under "وجدنا N حلول" is worse
   * than not listing it.
   */
  relativeCutoff?: number;
  limit?: number;
}

export function search(
  index: IndexedProblem[],
  rawQuery: string,
  { threshold = 0.3, relativeCutoff = 0.55, limit = 12 }: SearchOptions = {},
): SearchResult[] {
  const tokens = tokenizeQuery(rawQuery);
  if (tokens.length === 0) return [];

  const squashedQuery = squash(rawQuery);

  const scored = index
    .map((entry) => {
      const { score, matched } = scoreProblem(entry, tokens, squashedQuery);
      return { entry, score, matched };
    })
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score || b.entry.problem.priority - a.entry.problem.priority)
    .slice(0, limit);

  if (scored.length === 0) return [];

  const top = scored[0]!.score;

  return scored
    .filter((item) => item.score >= top * relativeCutoff)
    .map(({ entry, score, matched }) => ({
      problem: entry.problem,
      score,
      // Blend absolute confidence with rank-relative confidence so the numbers
      // read the way users expect: a clear winner near the top, others trailing.
      percent: Math.min(99, Math.round(100 * (0.55 * score + 0.45 * (score / top)))),
      matched,
    }));
}
