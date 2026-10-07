/**
 * Entry point bundled for `scripts/offline-price-copies.mjs`.
 *
 * The write goes through the shop's own `updateStore`, and the report prices
 * each game through the same `listingPricing` the card prints and the same
 * `readOffers` the product page shows — so «what the customer sees» is asked
 * of the functions that decide it, not of a second copy of their rules.
 */
export { d1All, d1Run } from "@/lib/d1.server";
export {
  bumpCatalogVersion,
  getStore,
  invalidateStoreCache,
  normalizeProductRecord,
  updateStore,
} from "@/lib/db.server";
export { refreshProductIndexRow } from "@/lib/product-index.server";
export { getProductCategory } from "@/lib/productSection";
export { skipReason } from "@/lib/repricing";
export { classifyTier } from "@/lib/tierPricing";
export { listingPricing } from "@/lib/productPricing";
export { readOffers } from "@/lib/hub";
