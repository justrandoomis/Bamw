/**
 * Entry point bundled for `scripts/catalogue-enrich.mjs`: the app's own D1
 * helpers and catalogue reads, so the write lands exactly where the admin's
 * product editor writes (the per-product overlay row) and moves the revision
 * every cache is keyed on.
 */
export { d1All, d1Run } from "@/lib/d1.server";
export { bumpCatalogVersion, getStore, invalidateStoreCache, updateStore } from "@/lib/db.server";
