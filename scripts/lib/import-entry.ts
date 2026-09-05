/**
 * Entry point bundled for the template import script.
 *
 * Everything here is the application's own code. A new product is built by the
 * same `buildBatchGameImport` the admin batch archive uses — same parser, same
 * field mapping, same hidden-by-default flag — and an update to an existing
 * product goes through `mergeProductUpdate`, the guard the save endpoint uses.
 * Re-deriving either in a script would be a second implementation of the rules
 * that decide what production keeps.
 *
 * The pricing module is here for the same reason: supplier costs and selling
 * prices are decided in one place, tested there, and used identically by the
 * importer and by anything else that needs them.
 */
export { parseGameImport } from "@/lib/gameImportParser";
export { buildBatchGameImport } from "@/lib/gameImportForm";
export { mergeProductUpdate, destructiveUpdateLog, oversizedMediaLog } from "@/lib/productMergeGuard";
export { d1All, d1Run } from "@/lib/d1.server";
/*
  The serializer the storefront answers through. A script that prints a
  product to a CI log prints it through this, so cost and supplier fields
  cannot reach the log by an oversight in the script.
*/
export { toPublicProduct } from "@/lib/public-product.server";
export { auditMediaRoles } from "@/lib/mediaRoleAudit";
export {
  mapSupplierCosts,
  priceGame,
  /*
    So the report can say which of the two priced a file, rather than the
    script deciding that for itself from the numbers that came back — which is
    a second implementation of the rule by another name.
  */
  readyTierPricing,
  customerOptionName,
  customerTypeName,
  isExtrasRow,
  CUSTOMER_LABELS,
} from "@/lib/nintendoPricing";
export { demandTierFor } from "@/lib/nintendoDemandTiers";
export {
  normalizeGameDevicePerformance,
  validateGameDevicePerformance,
  resolveGamePlatformKey,
  PLATFORM_DEVICE,
} from "@/lib/devicePerformance";
export { getProductCategory } from "@/lib/productSection";
export { checkSupplierNameZh, writeSupplierNameZh } from "@/lib/productAdminMetadata.server";
export { syncGameDevicePerformance } from "@/lib/devicePerformance.server";
