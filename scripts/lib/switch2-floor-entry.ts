/**
 * Entry point bundled for `scripts/switch2-floor.mjs`.
 *
 * Which games are Switch 2 is asked of `isNintendoSwitch2Product` — the
 * function the card's Switch 2 badge and the device filter ask — and which
 * are in demand of the shop's own `demandTierFor`, so the floor lands on the
 * games the owner sees labelled and ranked that way, not on a second opinion.
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
export { isNintendoSwitch2Product } from "@/lib/nintendoListing";
export { demandTierFor } from "@/lib/nintendoDemandTiers";
export { getProductSlug } from "@/lib/productRouting";
