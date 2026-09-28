/**
 * Entry point bundled for `scripts/offline-cover-export.mjs`.
 *
 * Every rule the export applies is the application's own: which products the
 * storefront hides, which picture is the front box cover, which row is the
 * ordinary offline account, and what the till charges for it. The export asks
 * these functions rather than re-deriving any of them, so the price in the
 * sheet is the price the shop sells at, and the picture is the one its cards
 * draw.
 *
 * Kept apart from `catalogue-entry.ts` so a change here cannot break the
 * pricing reports that bundle that one.
 */
export { d1All } from "@/lib/d1.server";
export { getStore } from "@/lib/db.server";
export { isProductHidden } from "@/lib/purchasable";
export { isGameProduct } from "@/lib/productSection";
export { readOffers } from "@/lib/hub";
export {
  listingPricing,
  ordinaryOfflineRow,
  pricingTypeRows,
  resolveUnitPrice,
} from "@/lib/productPricing";
export { classifyTier } from "@/lib/tierPricing";
export { getNintendoMedia } from "@/lib/nintendoImages";
export { computeTrimBox, isValidTrim, ANALYSIS_MAX_SIDE } from "@/lib/imageTrim";
export { getProductPath } from "@/lib/productRouting";
export { isNintendoSwitch2Product } from "@/lib/nintendoListing";
