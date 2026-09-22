/**
 * Entry point bundled for the cost and pricing reports.
 *
 * `getStore` reaches `db.server`, which pulls in TanStack Start's server core
 * and its three virtual modules — specifiers only the app's own build can
 * resolve. The checker stubs them, which is safe because nothing on this path
 * runs a request handler: the catalogue is read as a document.
 *
 * Kept apart from `banana-entry.ts` so a change to one report cannot break the
 * other's build, which is the mistake that took `production-proof` down when
 * these exports were added to the shared entry.
 */
export { d1All, d1Run } from "@/lib/d1.server";
export {
  bumpCatalogVersion,
  getStore,
  invalidateStoreCache,
  isValidProductRecord,
  normalizeProductRecord,
  updateStore,
} from "@/lib/db.server";
export {
  decisionProblem,
  repriceAll,
  repriceOne,
  skipReason,
  CHEAP_CEILING,
  CHEAP_FLOOR,
  COST_SPLIT,
  DEAR_FLOOR,
  MIN_MARGIN,
  ONLINE_MAX_MARGIN,
  ONLINE_MIN_MARGIN,
  dlcIncreaseFor,
  onlinePriceFor,
} from "@/lib/repricing";
/*
  The four-tier rules. A Nintendo game carries up to four prices on `types`
  and the owner's rules differ for each — see tierRepricing.ts. Exported here
  so the report and the apply run the SAME functions the tests run, rather
  than a second copy of the arithmetic living in a script.
*/
export { repriceTiers, tierProblem } from "@/lib/tierRepricing";
export { classifyTier, classifyTiers, extrasCostGap, tierOf } from "@/lib/tierPricing";
/*
  What a listing card and the details page lead with. Exported so a report can
  measure the number a customer actually sees, rather than a second copy of the
  selection rule living in a script and agreeing with nothing.
*/
export {
  listingPricing,
  initialOptionId,
  initialVariantName,
  pricingTypeRows,
} from "@/lib/productPricing";
