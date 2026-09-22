/**
 * Entry point bundled for the platform and label audit.
 *
 * Separate from `square-card-entry.ts` for the same reason that one is
 * separate from `import-entry.ts`: each script bundles only the application
 * code it needs, so a change in one cannot break the others.
 *
 * Everything the audit decides with is the application's own code. The
 * duplicate rule in particular: `productIdentityKeys` is what the admin save
 * path enforces, and a correction that would collide under it must be refused
 * here for exactly the same reason a second save of the same title is. A
 * private reimplementation would be a second opinion about what a duplicate
 * is, and the two would drift.
 *
 * `claimProductIdentity` is exported because the catalogue is a JSON document
 * with a separate unique index beside it. Changing a title or a platform in
 * the document without moving that row leaves the index claiming an identity
 * the product no longer has — which then refuses the identity to whoever
 * really holds it.
 */
export { d1All, d1Run } from "@/lib/d1.server";
export { getStore, updateStore } from "@/lib/db.server";
export { claimProductIdentity } from "@/lib/product-identity.server";
export {
  findConflictingProduct,
  normalizeProductPlatform,
  normalizeProductTitle,
  productIdentityKeys,
} from "@/lib/product-identity";
export { hasNintendoSquareCard, isNintendoSwitch2Product } from "@/lib/nintendoListing";
/*
  What a customer actually receives, so the sweep below can ask its question of
  that rather than of the stored record. The title leak was found by reading
  the stored titles; asking the same question of the public projection is the
  only way to learn whether the same scrape put a supplier's price or a Chinese
  supplier name anywhere else a customer can read — `toPublicProduct` already
  drops the fields that are private by name and the lines that are plainly
  bookkeeping, so whatever survives it is genuinely on the page.
*/
export { toPublicProduct } from "@/lib/public-product.server";
export { isGameProduct } from "@/lib/productSection";
