/**
 * Entry point bundled for `scripts/yuan-reprice-apply.mjs`.
 *
 * The write goes through the shop's own `updateStore` — the same revision
 * guard, chunking and product-index projection an admin save uses — and reads
 * back through the shop's own `getStore`, so what is verified is what the
 * storefront will serve. Kept apart from the other entries so a change here
 * cannot break the reports that bundle those.
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
export { isProductHidden } from "@/lib/purchasable";
export { skipReason } from "@/lib/repricing";
export { classifyTier } from "@/lib/tierPricing";
export { ordinaryOfflineRow, pricingTypeRows } from "@/lib/productPricing";
export { getProductSlug } from "@/lib/productRouting";
