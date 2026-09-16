/**
 * Where a listing with no picture belongs: last, and not on the front page.
 *
 * Fifteen hundred games arrived from the supplier's sheet in one import and
 * most of them came with no artwork. The home page's «أحدث الألعاب» strip is
 * sorted by when a product was added, so every one of them landed in front of
 * the whole shop at once and the storefront turned into a wall of placeholder
 * squares. The owner's instruction was exact: «اجعلها في النهاية، لا تجعلها
 * تظهر في واجهه الموقع».
 *
 * Two rules, and the difference between them matters.
 *
 *   - On the front page they are not shown at all. A front page is a display
 *     window.
 *   - Everywhere a member has actually gone looking — a category, the games
 *     page, a search — they are shown, last. They are real products at real
 *     prices and hiding them would cost sales; putting them after the ones
 *     with artwork is just shelving.
 *
 * Nothing here writes anything. `displayOrder` is the admin's arrangement of
 * the shelf and it is not touched — this is the order things are *rendered*
 * in, decided at render time, and an admin who gives a game a cover sees it
 * move on the next load with no edit to the product at all.
 */
import { hasUsableImage } from "./bareListing";

/** Does this record have artwork a listing card can actually show? */
export function hasListingPicture(product: unknown): boolean {
  if (!product || typeof product !== "object") return false;
  return hasUsableImage(product as Record<string, unknown>);
}

/**
 * The same list, with the pictured ones first.
 *
 * A stable partition rather than a sort, deliberately: whatever order the
 * caller had — newest first, cheapest first, the admin's own arrangement — is
 * preserved inside each group. Sorting on a boolean would have been enough to
 * separate them and enough to scramble everything else.
 */
export function picturedFirst<T>(products: readonly T[]): T[] {
  const pictured: T[] = [];
  const bare: T[] = [];
  for (const product of products) {
    (hasListingPicture(product) ? pictured : bare).push(product);
  }
  return bare.length === 0 ? [...products] : [...pictured, ...bare];
}

/** Only the ones with artwork — for the front page, where nobody went looking. */
export function onlyPictured<T>(products: readonly T[]): T[] {
  return products.filter((product) => hasListingPicture(product));
}
