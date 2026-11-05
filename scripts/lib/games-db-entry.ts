/**
 * Entry point bundled for `scripts/games-db-load.mjs`: the catalogue read the
 * way the app reads it, and the app's own answers to «can a customer buy this»
 * and «is this a game», so a title links only to a product page that can sell
 * it.
 *
 * Read-only: nothing here writes the catalogue. Kept apart from the other
 * entries so a change to one script's exports cannot break another's build.
 */
export { getStore, isStoreDegraded } from "@/lib/db.server";
export { isProductPurchasable } from "@/lib/purchasable";
export { isGameProduct } from "@/lib/productSection";
