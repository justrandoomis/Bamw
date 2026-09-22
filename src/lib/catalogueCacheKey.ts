/**
 * The key the Worker holds a built catalogue payload under.
 *
 * Its whole safety property is in one field: the catalogue's revision. A cache
 * entry that outlived a price change would quote a figure the shop no longer
 * charges, and there is no acceptable version of that. `persistStore` writes
 * the next revision into the same `d1Batch` as the catalogue chunks, so any
 * change to a price, a cost, a stock figure, a visibility flag, an option or an
 * ordering moves the revision — which moves this key — which means the entry
 * built from the old figures is never asked for again.
 *
 * It lives in its own module so that property can be tested without a Worker.
 */
export interface CatalogueCacheKeyParts {
  /** `store_rev`. Zero means it could not be read, and nothing is cached. */
  version: number;
  slim: boolean;
  page: number;
  limit: number;
  category?: string | null;
  /** An admin payload carries costs and hidden products and is never cached. */
  isAdmin?: boolean;
}

/**
 * The key, or null when this answer must not be kept.
 *
 * Null for an admin — their payload carries cost and hidden products, and a
 * shared cache is the last place either belongs — and null at revision zero,
 * because an answer built without knowing which catalogue it came from cannot
 * be invalidated by a later one.
 */
export function catalogueCacheKey(parts: CatalogueCacheKeyParts): string | null {
  if (parts.isAdmin) return null;
  if (!Number.isFinite(parts.version) || parts.version <= 0) return null;
  const shape = parts.slim ? "slim" : "full";
  const category = encodeURIComponent(parts.category ?? "");
  return `https://banan.to/__catalogue/${parts.version}/${shape}/${parts.page}/${parts.limit}/${category}`;
}
