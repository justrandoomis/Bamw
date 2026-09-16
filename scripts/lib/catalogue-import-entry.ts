/**
 * Entry point bundled for the runner-side catalogue import.
 *
 * Separate from `import-entry.ts` for the reason `banana-entry.ts` records and
 * `store-media-entry.ts` re-learned: `updateStore` reaches `db.server`, which
 * pulls in TanStack Start's server core and its virtual specifiers — names only
 * the app's own build can resolve. Adding them to the shared entry breaks every
 * other script, so the cost is paid here, where one script stubs the three.
 *
 * Everything exported is the application's own code. The rows are parsed by
 * `parseCatalogueCsv`, the same function the browser preview uses; the decision
 * about which existing product a row matches is `decide`, the same function the
 * Worker route uses; and the write goes through `updateStore`, the same path the
 * route writes through — with its revision guard, its 400 KB chunking, and its
 * admin-listing projection kept in step.
 *
 * A second implementation of any of those is how an import creates duplicates
 * of games the shop already sells.
 */
export { d1All, d1Run } from "@/lib/d1.server";
export { getStore, updateStore, invalidateStoreCache } from "@/lib/db.server";
export {
  parseCatalogueCsv,
  duplicateNames,
  decide,
  CATALOGUE_SOURCE,
  type CatalogueRow,
  type Decision,
  type ImportMode,
} from "@/lib/catalogueImport";
export { supplierNameStatements } from "@/lib/productAdminMetadata.server";
export { d1Batch } from "@/lib/d1.server";
