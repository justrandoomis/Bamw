/**
 * @vitest-environment node
 */
/**
 * A failed catalogue read must not look like a shop with no products.
 *
 * The storefront intermittently drew its section headings over nothing: no
 * error, no retry, just gaps where the games belonged. Nothing was wrong with
 * the rendering. The catalogue read failed, `loadStore` swallowed it into an
 * empty row set, `getStore` returned `emptyStore`, and `/api/data` served that
 * as a 200 the edge cached for five seconds and the service worker kept for
 * six hours. Every layer believed the shop was empty because the layer below
 * had told it so.
 *
 * These pin the distinction at the point it was lost.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");

/** Set to make the catalogue read fail, the way a D1 timeout does. */
let failReads = false;

vi.mock("./d1.server", () => ({
  d1Ready: async () => true,
  d1All: async (sql: string, ...binds: unknown[]) => {
    if (failReads && sql.includes("store_kv")) {
      throw new Error("D1_ERROR: network connection lost");
    }
    return db.prepare(sql).all(...(binds as never[]));
  },
  d1First: async (sql: string, ...binds: unknown[]) => db.prepare(sql).get(...(binds as never[])),
  d1Run: async () => {},
  d1RunChanges: async () => 0,
  d1BatchRun: async () => [],
  getD1: () => ({ prepare: (sql: string) => db.prepare(sql) }),
  ensureSchema: async () => {},
  ensureUsersSchema: async () => {},
}));
vi.mock("./storage.server", () => ({
  listKeys: async () => [],
  mutateJson: async () => undefined,
  // No JSON fallback on this deployment: D1 is the store.
  readJson: async (_key: string, fallback: unknown) => fallback,
  writeJson: async () => undefined,
}));
vi.mock("./whatsapp.server", () => ({ sendWhatsappMessage: async () => undefined }));
vi.mock("./telegram.server", () => ({ sendTelegramMessage: async () => undefined }));

const store = await import("./db.server");

function seed(products: number) {
  db.exec(`DROP TABLE IF EXISTS store_kv`);
  db.exec(`DROP TABLE IF EXISTS store_rev`);
  db.exec(
    `CREATE TABLE store_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  );
  db.exec(`CREATE TABLE store_rev (rev INTEGER PRIMARY KEY, updated_at TEXT NOT NULL)`);
  const insert = db.prepare(`INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)`);
  insert.run("store", JSON.stringify({ categories: [{ id: "cat_nintendo", title: "ألعاب" }] }), "now");
  insert.run(
    "store:products",
    JSON.stringify(
      Array.from({ length: products }, (_, i) => ({
        id: `prd_${i}`,
        title: `لعبة ${i}`,
        titleEn: `Game ${i}`,
        slug: `game-${i}`,
        price: 25000,
        stock: 2,
      })),
    ),
    "now",
  );
  db.prepare(`INSERT INTO store_rev (rev, updated_at) VALUES (1, 'now')`).run();
  store.invalidateStoreCache();
}

beforeEach(() => {
  failReads = false;
  seed(3);
  store.invalidateStoreCache();
});

describe("a catalogue that could not be read", () => {
  it("is not reported as a catalogue with no products", async () => {
    failReads = true;
    const doc = await store.getStore();

    expect(doc.products).toEqual([]);
    // The distinction the whole fix rests on.
    expect(store.isStoreDegraded(doc)).toBe(true);
  });

  it("serves the last good snapshot instead, and that is not degraded", async () => {
    const healthy = await store.getStore();
    expect(healthy.products).toHaveLength(3);

    /*
      Push past the snapshot's 60s TTL so a real read is attempted, and fail
      it. Without the clock the cached copy answers directly and the failure
      path is never reached — which is what made the first version of this test
      pass while proving nothing.
    */
    const realNow = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(realNow + 120_000);
    failReads = true;
    try {
      const doc = await store.getStore();
      expect(doc.products).toHaveLength(3);
      expect(store.isStoreDegraded(doc)).toBe(false);
    } finally {
      clock.mockRestore();
    }
  });

  it("marks the failure again once no snapshot is left", async () => {
    await store.getStore();
    store.invalidateStoreCache();
    failReads = true;

    expect(store.isStoreDegraded(await store.getStore())).toBe(true);
  });
});

describe("a catalogue that really is empty", () => {
  it("is served as an ordinary answer, not as a failure", async () => {
    seed(0);
    const doc = await store.getStore();

    expect(doc.products).toEqual([]);
    expect(store.isStoreDegraded(doc)).toBe(false);
  });
});

describe("the marker itself", () => {
  it("cannot reach a customer through the payload", async () => {
    failReads = true;
    const doc = await store.getStore();

    // A symbol key is invisible to JSON, and non-enumerable so a spread of the
    // document — which is how every public payload is built — drops it too.
    expect(JSON.stringify(doc)).not.toContain("degraded");
    expect(Object.keys(doc)).not.toContain("degraded");
    expect(store.isStoreDegraded({ ...doc })).toBe(false);
  });

  it("says no to anything that is not a marked store", () => {
    expect(store.isStoreDegraded(undefined)).toBe(false);
    expect(store.isStoreDegraded(null)).toBe(false);
    expect(store.isStoreDegraded({ products: [] })).toBe(false);
    expect(store.isStoreDegraded("store")).toBe(false);
  });
});
