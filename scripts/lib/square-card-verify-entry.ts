/**
 * Entry point bundled for the square-card link verification.
 *
 * Separate from `square-card-entry.ts` for the reason that file already
 * records: `updateStore` reaches `db.server`, which pulls in TanStack Start's
 * server core and its three virtual specifiers. Adding an export breaks every
 * script that bundles the same entry, and this one needs three the filler does
 * not — `invalidateStoreCache` and `bumpCatalogVersion` for the granular write
 * path, and `getNintendoMedia` to read the URL that is actually served.
 *
 * `hasNintendoSquareCard` and `SQUARE_CARD_FIELDS` are exported rather than
 * reimplemented, for the same reason the filler exports them: one definition of
 * "this game has a square picture", so the queue, the shelf and this checker
 * can never disagree about which games have one.
 */
export { d1All, d1Run } from "@/lib/d1.server";
export {
  bumpCatalogVersion,
  getStore,
  invalidateStoreCache,
  updateStore,
} from "@/lib/db.server";
export { getNintendoMedia, SQUARE_CARD_FIELDS } from "@/lib/nintendoImages";
export { hasNintendoSquareCard } from "@/lib/nintendoListing";
export { isGameProduct } from "@/lib/productSection";
