import type { ProblemEntry } from "../content";
import { CATEGORY_IDS, type CategoryId, type Problem } from "./types";

const CATEGORY_SET = new Set<string>(CATEGORY_IDS);

/**
 * Turns an admin-authored entry into the full problem shape the page renders.
 *
 * Used only when the entry names a problem the shipped file does not have.
 * Overriding a shipped one goes through {@link applyProblemOverrides}, which
 * merges rather than rebuilds — see the note there.
 */
export function entryToProblem(entry: ProblemEntry): Problem {
  const category: CategoryId = CATEGORY_SET.has(entry.category)
    ? (entry.category as CategoryId)
    : "other";

  return {
    id: entry.id,
    emoji: entry.emoji || "❓",
    title: entry.title,
    description: entry.description,
    category,
    cause: entry.cause ?? "",
    keywords: entry.keywords ?? [],
    aliases: [],
    symptoms: [],
    images: entry.imageUrl
      ? [
          {
            src: entry.imageUrl,
            alt: entry.title,
            kind: "illustration" as const,
            width: 1200,
            height: 800,
          },
        ]
      : [],
    slots: entry.images ?? [],
    avoid: entry.avoid ?? [],
    ...(entry.contactAdminWhen ? { contactAdminWhen: entry.contactAdminWhen } : {}),
    steps: (entry.steps ?? []).map((step) => ({
      title: step.title,
      detail: step.description,
      slots: step.images ?? [],
    })),
    relatedGames: [],
    relatedProducts: [],
    relatedErrors: entry.errorCodes ?? [],
    arabicKeywords: entry.keywords ?? [],
    englishKeywords: [],
    kurdishKeywords: [],
    priority: 50,
    published: entry.published ?? true,
  };
}

/**
 * Admin entries win over the shipped JSON when IDs match, so an admin can both
 * override a built-in problem and publish brand new ones.
 */
export function applyProblemOverrides(base: Problem[], entries: ProblemEntry[]): Problem[] {
  const byId = new Map(base.map((problem) => [problem.id, problem]));
  for (const entry of entries) {
    if (!entry?.id) continue;
    const existing = byId.get(entry.id);

    if (!existing) {
      // A problem the shop wrote itself. It needs a title to be worth showing.
      if (!entry.title) continue;
      byId.set(entry.id, entryToProblem(entry));
      continue;
    }

    /*
      An override merges onto the shipped entry rather than replacing it.

      Rebuilding from the entry is right for a new problem and wrong for an
      edit: `ProblemEntry` has no aliases, no symptoms and no `relatedErrors`,
      so an admin who uploaded a screenshot — or fixed a typo — silently
      deleted the error codes and the colloquial phrasings that let the search
      find that problem at all. The customer would then type "2124-8006" into
      the box and be told nothing matches.
    */
    byId.set(entry.id, {
      ...existing,
      ...(entry.title ? { title: entry.title } : {}),
      ...(entry.description ? { description: entry.description } : {}),
      ...(entry.emoji ? { emoji: entry.emoji } : {}),
      ...(entry.cause ? { cause: entry.cause } : {}),
      ...(entry.keywords?.length
        ? { keywords: entry.keywords, arabicKeywords: entry.keywords }
        : {}),
      ...(entry.avoid?.length ? { avoid: entry.avoid } : {}),
      ...(entry.contactAdminWhen ? { contactAdminWhen: entry.contactAdminWhen } : {}),
      ...(entry.errorCodes?.length ? { relatedErrors: entry.errorCodes } : {}),
      ...(entry.images?.length ? { slots: entry.images } : {}),
      ...(entry.steps?.length
        ? {
            steps: entry.steps.map((step, index) => ({
              title: step.title,
              detail: step.description,
              /* Keep the shipped hint and slots where the admin sent none. */
              ...(existing.steps[index]?.hint ? { hint: existing.steps[index]!.hint } : {}),
              slots: step.images ?? existing.steps[index]?.slots,
            })),
          }
        : {}),
      ...(entry.published === undefined ? {} : { published: entry.published }),
    });
  }
  return [...byId.values()]
    .filter((problem) => problem.published)
    .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
}

export function countCategories(problems: Problem[]): Record<CategoryId, number> {
  const counts = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0])) as Record<
    CategoryId,
    number
  >;
  for (const problem of problems) {
    for (const category of [problem.category, ...(problem.alsoIn ?? [])]) {
      counts[category] += 1;
    }
  }
  return counts;
}
