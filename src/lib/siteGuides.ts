/**
 * The account guides a customer reads, and the ones an admin has edited.
 *
 * ## Why the shipped file and the store document are both read
 *
 * `mergeContent` takes `guides` from the store whenever the key is an array,
 * and falls back to the defaults only when it is absent. That is fine while
 * the defaults are empty and fatal once they are not: the first time an admin
 * saves a single guide, the store holds a one-element array and every shipped
 * guide disappears — a deploy would look like it had deleted the manual.
 *
 * So the shipped file is the baseline and the store is an overlay, matched by
 * id. An admin can rewrite a shipped guide, add their own, or hide one by
 * setting `published: false`, and none of that is undone by the next release.
 * It is the same shape `applyProblemOverrides` already uses for the
 * troubleshooting entries; guides had no equivalent, which is why they had no
 * shipped content at all.
 */
import shipped from "@/content/guides.json";
import { filledImages, type ContentImage, type GuideItem, type GuideStep } from "./content";

/**
 * The guides as written in this repository, before any admin edit.
 *
 * The import is read as either an array or a namespace object holding one. A
 * JSON module is not guaranteed to arrive the same way in every build, and
 * `{ default: [...] }.map` throws immediately with nothing logged — which is
 * precisely how `/problem` came to answer 500 in 28ms while every other page
 * was fine, and why no local run could reproduce it.
 */
export function shippedGuides(): GuideItem[] {
  const source: unknown = shipped;
  const list = Array.isArray(source)
    ? source
    : Array.isArray((source as { default?: unknown })?.default)
      ? ((source as { default: unknown[] }).default)
      : [];
  return (list as GuideItem[]).map((guide) => ({ ...guide }));
}

/**
 * The shipped guides with the admin's edits laid over them.
 *
 * Unpublished guides are dropped here rather than in the page, so every
 * surface — the page, the search, an order card's deep link — agrees about
 * what exists.
 */
export function applyGuideOverrides(
  base: GuideItem[],
  overrides: GuideItem[] | undefined,
): GuideItem[] {
  const byId = new Map(base.map((guide) => [guide.id, guide]));
  for (const guide of overrides ?? []) {
    if (!guide?.id) continue;
    const existing = byId.get(guide.id);
    /*
      A shallow merge, so an admin who edits only the title does not have to
      re-send every step to keep them. `steps` is replaced wholesale when it is
      present, because a step removed by an admin has to actually go.
    */
    byId.set(guide.id, existing ? { ...existing, ...guide } : guide);
  }
  return [...byId.values()]
    .filter((guide) => guide.published !== false)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/** A guide's steps in order, each with only the pictures that actually exist. */
export function guideSteps(guide: GuideItem): Array<GuideStep & { pictures: ContentImage[] }> {
  return [...(guide.steps ?? [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((step) => ({ ...step, pictures: filledImages(step.images, step.image, step.title_ar) }));
}

/**
 * The URL fragment a guide is reachable at.
 *
 * `slug` is the contract with everything that links here — an order's delivery
 * card, a support reply, the FAQ — so it is taken from the record rather than
 * derived from a title that an admin may rewrite tomorrow.
 */
export function guideAnchor(guide: GuideItem): string {
  return guide.slug || guide.id;
}
