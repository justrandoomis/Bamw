/**
 * The one property a cached catalogue has to have.
 *
 * The public `/api/data` payload is now held in the Worker's own cache so a
 * cold isolate does not read five megabytes out of D1 to answer a shopper.
 * That is only acceptable while it is impossible for an entry to outlive the
 * figures it was built from — a cached body quoting a price the owner has
 * changed is worse than any latency it saves.
 *
 * `persistStore` writes the next `store_rev` into the same `d1Batch` as the
 * catalogue chunks, so every commercial change moves the revision. These pin
 * that the revision is in the key, and that the two answers which must never
 * be cached are not.
 */
import { describe, expect, it } from "vitest";

import { catalogueCacheKey } from "./catalogueCacheKey";

const base = { version: 42, slim: true, page: 0, limit: 0, category: null };

describe("the key a built catalogue is kept under", () => {
  it("changes when the catalogue does", () => {
    const before = catalogueCacheKey(base);
    const after = catalogueCacheKey({ ...base, version: 43 });
    expect(before).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it("is the same for two shoppers asking the same question", () => {
    expect(catalogueCacheKey(base)).toBe(catalogueCacheKey({ ...base }));
  });

  it("never keeps an admin's payload", () => {
    /*
      It carries cost and hidden products, and a cache shared by every visitor
      is the last place either belongs.
    */
    expect(catalogueCacheKey({ ...base, isAdmin: true })).toBeNull();
  });

  it("keeps nothing when the revision could not be read", () => {
    /*
      An answer built without knowing which catalogue it came from cannot be
      invalidated by a later one, so it is never stored at all.
    */
    for (const version of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(catalogueCacheKey({ ...base, version }), String(version)).toBeNull();
    }
  });

  it("does not mix up two different questions", () => {
    const keys = new Set(
      [
        catalogueCacheKey(base),
        catalogueCacheKey({ ...base, slim: false }),
        catalogueCacheKey({ ...base, page: 2 }),
        catalogueCacheKey({ ...base, limit: 24 }),
        catalogueCacheKey({ ...base, category: "nintendo-switch-games" }),
        catalogueCacheKey({ ...base, category: "hardware" }),
      ].filter(Boolean),
    );
    expect(keys.size).toBe(6);
  });

  it("cannot have a category escape into the path", () => {
    const key = catalogueCacheKey({ ...base, category: "../../etc/passwd?x=1" });
    expect(key).toContain("%2F");
    expect(key).not.toContain("?");
  });
});
