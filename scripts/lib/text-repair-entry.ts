/**
 * Entry point bundled for the stored-copy repair.
 *
 * The detector is the application's own — the same `looksLikeInternalNote`
 * the public serializer filters with, and the same list of fields a customer
 * reads. A script that decided for itself what counts as a supplier note
 * would be a second definition of the rule, free to drift from the one
 * production actually enforces.
 *
 * `db.server.ts` is deliberately absent. It reaches TanStack Start's server
 * entry, which esbuild cannot resolve outside a Vite build, and pulling it in
 * for one helper takes the whole bundle down — so the catalogue revision is
 * moved from the script with the two statements `bumpCatalogVersion` runs.
 */
export { d1All, d1Run, d1Batch } from "@/lib/d1.server";
export {
  customerSafeParagraph,
  internalSentences,
  CUSTOMER_TEXT_FIELDS,
} from "@/lib/internalMetadata";
