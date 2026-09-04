/**
 * The store policy: the clauses this repository ships, and the admin's edits.
 *
 * `mergeContent` spreads the stored `policy` over the default, so a store that
 * holds a `sections` array replaces the shipped one wholesale. That is the same
 * trap the guides had: the first admin save would delete every clause written
 * here, including the warranty.
 *
 * So sections are merged by id. An admin's existing clause wins over a shipped
 * one with the same id, a clause only they have is kept, and a shipped clause
 * they have never touched still appears. Nothing the shop already wrote is
 * lost by a deploy, and nothing a deploy adds is lost by a save.
 */
import shipped from "@/content/policy.json";
import type { PolicyData, PolicySection } from "./content";

/** The clauses as written in this repository. */
export function shippedPolicySections(): PolicySection[] {
  const source: unknown = shipped;
  const list = Array.isArray(source)
    ? source
    : Array.isArray((source as { default?: unknown })?.default)
      ? (source as { default: unknown[] }).default
      : [];
  return (list as PolicySection[]).map((section) => ({ ...section }));
}

/**
 * The shipped clauses with the store's own laid over them, in order.
 *
 * A section an admin wrote and a section shipped here are the same kind of
 * thing once merged, so the page has one list to render and one anchor scheme
 * to link into.
 */
export function mergePolicySections(
  base: PolicySection[],
  stored: PolicySection[] | undefined,
): PolicySection[] {
  const byId = new Map(base.map((section) => [section.id, section]));
  for (const section of stored ?? []) {
    if (!section?.id) continue;
    const existing = byId.get(section.id);
    byId.set(section.id, existing ? { ...existing, ...section } : section);
  }
  return [...byId.values()].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/**
 * The fragment a section is reachable at.
 *
 * Prefers the section's own `anchor` so a link written into an order card or a
 * support reply survives an id that changes shape later.
 */
export function policyAnchor(section: PolicySection): string {
  return section.anchor || section.id;
}

/** The whole policy document, ready to render. */
export function resolvePolicy(stored: PolicyData | undefined): PolicyData {
  const base = stored ?? ({} as PolicyData);
  return {
    ...base,
    title_ar: base.title_ar || "سياسة المتجر",
    subtitle_ar: base.subtitle_ar || "الشروط والحقوق والضمان والاسترجاع والاستخدام الصحيح",
    sections: mergePolicySections(shippedPolicySections(), base.sections),
  };
}
