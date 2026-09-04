/**
 * The questions this repository ships, and the ones the shop has added.
 *
 * Same shape as the guides and the policy: `mergeContent` takes `faq` from the
 * store whenever the key is an array, so the first admin save would otherwise
 * delete every shipped question. Merged by id, an admin can rewrite an answer,
 * add their own question, reorder, or unpublish one — and a release adds
 * questions without touching any of that.
 */
import shipped from "@/content/faq.json";
import type { FaqCategory, FaqItem } from "./content";

interface ShippedFaq {
  categories: FaqCategory[];
  items: FaqItem[];
}

function readShipped(): ShippedFaq {
  const source: unknown = shipped;
  const doc = (
    source && typeof source === "object" && "items" in (source as object)
      ? source
      : ((source as { default?: unknown })?.default ?? {})
  ) as Partial<ShippedFaq>;
  return {
    categories: Array.isArray(doc.categories) ? doc.categories : [],
    items: Array.isArray(doc.items) ? doc.items : [],
  };
}

export function shippedFaqCategories(): FaqCategory[] {
  return readShipped().categories.map((category) => ({ ...category }));
}

export function shippedFaqItems(): FaqItem[] {
  return readShipped().items.map((item) => ({ ...item }));
}

/** Merges by id, keeps what only one side has, and drops the unpublished. */
export function mergeFaq<T extends { id: string; published?: boolean; sort_order?: number }>(
  base: T[],
  stored: T[] | undefined,
): T[] {
  const byId = new Map(base.map((entry) => [entry.id, entry]));
  for (const entry of stored ?? []) {
    if (!entry?.id) continue;
    const existing = byId.get(entry.id);
    byId.set(entry.id, existing ? { ...existing, ...entry } : entry);
  }
  return [...byId.values()]
    .filter((entry) => entry.published !== false)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/**
 * An answer's "read more" link, only when it points somewhere real.
 *
 * Same-origin paths only. These are authored in this repository today and
 * editable from the admin screen tomorrow, and an FAQ answer is not a place
 * from which anyone should be able to send a customer off-site.
 */
export function faqMoreHref(item: FaqItem): string | undefined {
  const href = item.more_href?.trim();
  /*
    `//example.com` also starts with a slash, and a protocol-relative URL is a
    perfectly good way off the site — which is exactly what this guard exists
    to prevent, and exactly what "starts with /" lets through.
  */
  if (!href || !href.startsWith("/") || href.startsWith("//")) return undefined;
  return href;
}
