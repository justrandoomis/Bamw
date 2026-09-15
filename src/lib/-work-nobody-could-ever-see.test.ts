import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Five paths that did real work and threw the result away.
 *
 * Found by reading the hot paths against Cloudflare's per-route CPU record,
 * after the every-minute cron stopped reading the catalogue. Each is the same
 * shape of fault — the answer was always right, the route taken to it was
 * wasteful — so each is pinned where it is visible, in the source, exactly as
 * `-the-cron-stopped-reading-the-catalogue.test.ts` is.
 */

const read = (rel: string) => readFileSync(path.resolve(rel), "utf8");
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

describe("every write paid for two catalogue reads", () => {
  const db = code(read("src/lib/db.server.ts"));
  const body = db.slice(db.indexOf("export async function updateStore"));

  it("takes no snapshot on the D1 path, because the retry loop replaces it", () => {
    /*
      `updateStore` opened with `getStore()` + `mutate()`, and the retry loop
      below then re-read from D1 and re-applied on its very first attempt —
      discarding both. On the catalogue import that was two `ALL_ROWS_SQL`
      pulls of every chunk and two full `decide()` passes, per batch.
    */
    const opening = body.slice(0, body.indexOf("if (usingD1)"));
    expect(opening).toContain("usingD1");
    // The unconditional read is gone: `getStore()` may only be reached when D1
    // is absent.
    expect(opening).toMatch(/usingD1\s*\?[^:]*:\s*await getStore\(\)/);
  });

  it("still re-reads inside the loop, which is what makes the write safe", () => {
    // The point of the discarded snapshot was never correctness — this is.
    expect(body).toContain("current = await loadStore();");
    expect(body).toContain("next = (mutate(current) ?? current) as StoreDoc;");
  });

  it("still refuses to report a save that did not happen", () => {
    // This throw is why the placeholder above can never be read: nothing
    // downstream runs unless the loop assigned.
    expect(body).toContain('throw new Error("store_write_conflict")');
  });
});

describe("the public catalogue redacted its products twice", () => {
  it("keeps the heavy collections out of the walk that discards them", () => {
    /*
      `redactPrivateKeys` recursed the whole document and `products` and
      `bundles` were both reassigned on the next lines. Measured at 1,706
      products: 34.0 ms of discarded walk against 42.5 ms of work that produces
      output.
    */
    const source = code(read("src/routes/api/data.ts"));
    const fn = source.slice(source.indexOf("function publicStore"));
    expect(fn).toContain("redactPrivateKeys({ ...store, products: [], bundles: [] })");
    // And the redaction itself is still applied — this is about what it walks.
    expect(fn).toContain("redactPrivateKeys(store.bundles");
  });
});

describe("the catalogue validator carried a clock", () => {
  const source = code(read("src/routes/api/data.ts"));

  it("leaves the minute out, so a 304 survives a minute boundary", () => {
    /*
      `currentBaghdadTime` is built from the hour AND the minute, so folding the
      availability object into the ETag whole gave the catalogue a new validator
      every sixty seconds — and no returning visitor could ever be answered 304.
      That silently undid most of what the cheap validator was for.
    */
    expect(source).toContain("availabilityKeyFor");
    const helper = source.slice(source.indexOf("const availabilityKeyFor"));
    expect(helper.slice(0, 260)).toContain("currentBaghdadTime");
    // Stripped from the key only: the payload still carries it, and nothing
    // reads it from there.
    expect(source).toContain("adminAvailability: availability");
  });

  it("still lets availability itself move the validator", () => {
    // Stripping the clock must not strip `isAvailable` with it.
    const helper = source.slice(source.indexOf("const availabilityKeyFor"));
    expect(helper.slice(0, 300)).toContain("...rest");
  });
});

describe("an API path is not a static asset", () => {
  it("never sends /api/ to the assets binding first", () => {
    /*
      The extension test matches `/api/files/covers/foo.webp`, so every public
      product image was sent to the assets binding, 404'd there, and only then
      reached the route that serves it — on the busiest path in the shop.
    */
    const server = code(read("src/server.ts"));
    const shortcut = server.slice(server.indexOf("const isStaticAsset"));
    expect(shortcut.slice(0, 200)).toContain('!pathname.startsWith("/api/")');
  });
});

describe("a missing image reloaded the whole catalogue, for ever", () => {
  const source = read("src/routes/api/files/$.ts");

  it("remembers a path whose recovery already failed", () => {
    // The branch loads 3.8 MB to look for a URL to re-fetch from. Without a
    // memory of having failed, every retry by every browser pays again.
    expect(code(source)).toContain("recoveryFailed.has(path)");
    expect(code(source)).toContain("rememberRecoveryFailure(path)");
  });

  it("bounds that memory, so bad paths cannot grow it without limit", () => {
    expect(code(source)).toContain("MAX_REMEMBERED_FAILURES");
    const fn = code(source).slice(code(source).indexOf("function rememberRecoveryFailure"));
    expect(fn.slice(0, 400)).toContain("recoveryFailed.delete(oldest)");
  });

  it("still recovers on the first attempt, which is the point of the branch", () => {
    expect(code(source)).toContain("const store = await getStore();");
    expect(code(source)).toContain("writeBinary(");
  });
});

describe("finalize rewrote a document that had not changed", () => {
  it("asks whether there is anything to fold before folding", () => {
    /*
      It called `updateStore((current) => current)` — a full read, normalise,
      stringify, re-chunk and projection re-derivation — and only then asked
      whether any overlay rows existed. Measured at 121 ms (876 products) and
      184 ms (1,706) to write back exactly what was already there.
    */
    const source = code(read("src/routes/api/admin/catalogue-import.ts"));
    const branch = source.slice(source.indexOf("payload?.finalize === true"));
    const select = branch.indexOf("SELECT key FROM store_kv");
    const rewrite = branch.indexOf("await updateStore((current) => current)");
    expect(select).toBeGreaterThan(-1);
    expect(rewrite).toBeGreaterThan(-1);
    expect(select).toBeLessThan(rewrite);
    expect(branch).toContain("if (stale.length === 0)");
  });

  it("still sweeps the overlays when there are any", () => {
    // Skipping the rewrite must not skip the compaction it exists to enable.
    const source = code(read("src/routes/api/admin/catalogue-import.ts"));
    const branch = source.slice(source.indexOf("payload?.finalize === true"));
    expect(branch).toContain("DELETE FROM store_kv WHERE key IN");
  });
});
