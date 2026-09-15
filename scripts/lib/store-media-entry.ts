/**
 * Entry point bundled for the store media repair.
 *
 * Separate from `import-entry.ts` for the reason `banana-entry.ts` already
 * records, and which this file exists because I re-learned: `updateStore`
 * reaches `db.server`, which pulls in TanStack Start's server core and its
 * three virtual specifiers (`#tanstack-router-entry` and friends) — names only
 * the app's own build can resolve. Adding them to the shared entry broke every
 * script that bundles it, `production-proof` included, so the cost is kept here
 * where one script pays it and the repair script stubs the three.
 *
 * Stubbing them is safe precisely because nothing on this path runs a request
 * handler: the document is read, its `data:` URIs are swapped for URLs, and it
 * is written back. The server core is reached by the import graph and never by
 * a call.
 *
 * The write itself goes through the application's own `updateStore` rather than
 * SQL composed here. That is where the revision guard lives, where the 400 KB
 * chunking lives, and where the admin listing projection is kept in step with
 * the products it describes — a second implementation of any of those in a
 * repair script is how a repair becomes an incident.
 */
export { d1All, d1Run } from "@/lib/d1.server";
export { getStore, updateStore } from "@/lib/db.server";
export {
  contentName,
  decodeDataUrl,
  findInlineMedia,
  replaceInlineMedia,
  INLINE_MEDIA_LIMIT,
} from "@/lib/inlineMedia";
export { ALLOWED_PUBLIC_MIMES, validatePublicAssetMagic } from "@/lib/public-assets.server";
