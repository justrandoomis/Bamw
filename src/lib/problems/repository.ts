import raw from "@/content/problems.json";
import { CATEGORY_IDS, type CategoryId, type Problem, problemCategories } from "./types";

/**
 * Single entry point for troubleshooting content.
 *
 * Today it reads `content/problems.json`. Swapping in a CMS or database later
 * means changing only the body of `loadProblems()` — the page, the search
 * engine and the public API all consume this module, never the JSON directly.
 * The function is async on purpose so that swap stays a drop-in.
 */

const CATEGORY_SET = new Set<string>(CATEGORY_IDS);

/**
 * The entries, whatever shape the bundler handed us.
 *
 * `import raw from "…json"` is an array under Vitest and an array under Vite's
 * dev server. It is not guaranteed to be one in every build: a JSON module can
 * arrive as its namespace object, and `{ default: [...] }.map` throws
 * immediately — before any I/O, with nothing logged, which is exactly the
 * shape of the failure this page had in production. `/problem` answered 500 in
 * 28 ms with an empty body while every other page was fine, and no local run
 * could reproduce it because locally the import is already an array.
 *
 * Reading both shapes costs one line and removes the whole class.
 */
function entriesOf(value: unknown): Problem[] {
  if (Array.isArray(value)) return value as Problem[];
  const wrapped = (value as { default?: unknown } | null)?.default;
  return Array.isArray(wrapped) ? (wrapped as Problem[]) : [];
}

/**
 * Why one bad entry no longer takes the page down.
 *
 * These checks are worth having: they catch a hand-edit that would render a
 * broken card or hijack another problem's search ranking. Throwing was the
 * wrong response to failing one. This module is imported by a route loader, so
 * a throw here is a 500 on the whole troubleshooting page — every problem
 * unreachable because one of them has a bad id, at the moment a customer is
 * looking for help.
 *
 * A rejected entry is skipped and named in the log instead. The page keeps the
 * eleven that are fine.
 */
function problemFault(entry: Problem, index: number): string | null {
  const where = `content/problems.json[${index}]`;

  if (!entry?.id || !/^[A-Z0-9_]+$/.test(entry.id)) {
    return `${where}: "id" must be an uppercase slug (used as the URL hash), got "${entry?.id}"`;
  }
  if (!CATEGORY_SET.has(entry.category)) return `${where}: unknown category "${entry.category}"`;
  for (const extra of entry.alsoIn ?? []) {
    if (!CATEGORY_SET.has(extra)) return `${where}: unknown category in alsoIn "${extra}"`;
  }
  if (!Array.isArray(entry.steps) || entry.steps.length === 0) {
    return `${where}: a problem must have at least one solution step`;
  }
  for (const image of entry.images ?? []) {
    if (!image?.alt?.trim()) return `${where}: image "${image?.src}" is missing alt text`;
  }
  return null;
}

async function loadProblems(): Promise<Problem[]> {
  const entries = entriesOf(raw);
  const seen = new Set<string>();
  const images = new Map<string, string>();
  const kept: Problem[] = [];

  const allIds = new Set(entries.map((entry) => entry?.id));

  for (const [index, entry] of entries.entries()) {
    const fault = problemFault(entry, index);
    if (fault) {
      console.warn(`[problems:skipped] ${fault}`);
      continue;
    }
    const problem = entry;

    if (seen.has(problem.id)) {
      console.warn(`[problems:skipped] duplicate problem id "${problem.id}"`);
      continue;
    }
    seen.add(problem.id);

    // `relatedErrors` is scored as literal error codes at the highest weight,
    // so another problem's ID in there silently hijacks that problem's search
    // ranking. Cross-references do not belong in this field.
    for (const code of problem.relatedErrors ?? []) {
      if (code !== problem.id && allIds.has(code)) {
        console.warn(
          `[problems:related_error_is_an_id] "${problem.id}" lists "${code}" in relatedErrors; that field is for codes a customer types, not cross-references.`,
        );
      }
    }

    // An image belongs to exactly one problem. Reusing a "close enough"
    // illustration across problems is the failure mode this guards against.
    for (const image of problem.images ?? []) {
      const owner = images.get(image.src);
      if (owner && owner !== problem.id) {
        console.warn(
          `[problems:shared_image] "${image.src}" is used by both "${owner}" and "${problem.id}".`,
        );
      }
      images.set(image.src, problem.id);
    }

    kept.push(problem);
  }

  return kept;
}

/** Published problems, most important first. */
export async function getPublishedProblems(): Promise<Problem[]> {
  const problems = await loadProblems();
  return problems
    .filter((problem) => problem.published)
    .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
}

export async function getProblemById(id: string): Promise<Problem | undefined> {
  const problems = await getPublishedProblems();
  return problems.find((problem) => problem.id === id);
}

/** Categories that actually have published content, with their counts. */
export async function getCategoryCounts(): Promise<Record<CategoryId, number>> {
  const problems = await getPublishedProblems();
  const counts = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0])) as Record<
    CategoryId,
    number
  >;

  for (const problem of problems) {
    for (const category of problemCategories(problem)) {
      counts[category] += 1;
    }
  }
  return counts;
}
