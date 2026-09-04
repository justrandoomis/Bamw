/**
 * Entry point bundled for the stored-copy repair.
 *
 * The detector is the application's own — the same `looksLikeInternalNote`
 * the public serializer filters with, and the same list of fields a customer
 * reads. A script that decided for itself what counts as a supplier note
 * would be a second definition of the rule, free to drift from the one
 * production actually enforces.
 */
export { d1All, d1Run } from "@/lib/d1.server";
export { bumpCatalogVersion } from "@/lib/db.server";
export { looksLikeInternalNote, CUSTOMER_TEXT_FIELDS } from "@/lib/internalMetadata";
