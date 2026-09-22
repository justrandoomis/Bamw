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
export { d1All } from "@/lib/d1.server";
export {
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
} from "@/lib/repricing";
