/**
 * The catalogue has two homes, and a write that picks the wrong one is silent.
 *
 * `loadStore` merges the chunked catalogue document with the granular
 * `store:product:<id>` rows and lets the GRANULAR one win. `updateStore`
 * writes only the chunks. So for a product that owns a granular row:
 *
 *   - the write succeeds,
 *   - the read-back through `getStore()` shows the OLD value, because the
 *     granular row shadows the chunk that was just written,
 *   - and nothing anywhere says why.
 *
 * `tier-reprice.mjs` learned this the hard way and carried the knowledge alone.
 * `reprice.mjs` did not have it, and on 2026-09-22 an apply of the owner's new
 * ceiling wrote 446 prices, and its own read-back refused the run: forty
 * products — `prd_cat_contra-anniversary-collection`, `prd_cat_metroid-prime-4-beyond`,
 * Mario Kart World — came back at the price they started with. The gate was
 * right and the script was wrong.
 *
 * One script knowing something the other needs is how that happens, so the
 * knowledge lives here now and both ask it.
 */

/** Product ids served from their own `store:product:<id>` row. */
export async function overlayProductIds(app) {
  const rows = await app.d1All("SELECT key FROM store_kv WHERE key LIKE 'store:product:%'");
  return new Set(
    (rows ?? []).map((row) => String(row.key).slice("store:product:".length)).filter(Boolean),
  );
}

/**
 * The RAW granular document for one product, or null.
 *
 * Raw, and not the normalized product `getStore()` returns, because the raw
 * document is the thing that will be written — rehearsing against a normalized
 * copy rehearses a document that never existed.
 *
 * A row whose JSON will not parse, or whose `id` is not the id asked for,
 * returns null. The caller must refuse to write rather than overwrite a
 * document it could not read: that row is the one a shopper is served.
 */
export async function readOverlayProduct(app, id) {
  const rows = await app.d1All("SELECT value FROM store_kv WHERE key = ?", `store:product:${id}`);
  let stored = null;
  try {
    stored = rows?.[0]?.value ? JSON.parse(String(rows[0].value)) : null;
  } catch {
    return null;
  }
  if (!stored || typeof stored !== "object" || String(stored.id ?? "") !== String(id)) return null;
  return stored;
}

/** Replace one product's granular row with `doc`. */
export async function writeOverlayProduct(app, id, doc, now = new Date().toISOString()) {
  await app.d1Run(
    "INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)" +
      " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    `store:product:${id}`,
    JSON.stringify(doc),
    now,
  );
}

/**
 * Move the catalogue version after granular writes.
 *
 * `updateStore` writes `store_rev` inside its own transaction, so the chunk
 * path already moves the version `/api/data` serves as `catalogVersion` and as
 * its ETag. The bare INSERT above moves nothing — so a browser and the edge go
 * on serving the OLD price from a cache keyed on a version that did not
 * change. A write that succeeded and that nobody sees.
 */
export async function bumpAfterOverlayWrites(app, count) {
  if (count > 0) await app.bumpCatalogVersion();
}
