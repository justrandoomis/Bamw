/**
 * Entry point bundled for the square-card fill.
 *
 * Separate from `import-entry.ts` for the reason `store-media-entry.ts`
 * already records: `updateStore` reaches `db.server`, which pulls in TanStack
 * Start's server core and its three virtual specifiers — names only the app's
 * own build can resolve. Adding them to the shared entry breaks every script
 * that bundles it, so the cost is paid here.
 *
 * The write goes through the application's own `updateStore`. That is where
 * the revision guard lives, where the 400 KB chunking lives, and where the
 * admin listing projection is kept in step with the products it describes.
 * Composing SQL here instead would be a second implementation of all three.
 *
 * `hasNintendoSquareCard` is exported rather than reimplemented for the same
 * reason it is the admin queue's predicate and the storefront's sort key: one
 * definition of "this game has no square picture", so the filler, the queue
 * and the shelf can never disagree about which games are missing one.
 */
export { d1All, d1Run } from "@/lib/d1.server";
export { getStore, updateStore } from "@/lib/db.server";
export { hasNintendoSquareCard } from "@/lib/nintendoListing";
export { isGameProduct } from "@/lib/productSection";
export { SQUARE_CARD_FIELDS } from "@/lib/nintendoImages";
