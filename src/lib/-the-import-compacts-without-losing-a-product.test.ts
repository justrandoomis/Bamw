/**
 * @vitest-environment node
 *
 * Needs the real `node:sqlite`, which the default jsdom environment cannot load.
 */
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The riskiest statement in the catalogue import, against a real database.
 *
 * The import writes each product as a `store:product:<id>` overlay row — the
 * granular save path, fast and resumable. Those rows are only folded into the
 * catalogue document by a full write, and until that happens `loadStore` reads
 * and re-parses every one of them on every cold start. Fifteen hundred of them
 * would be fifteen hundred extra rows on the read path of the whole shop.
 *
 * So the run ends by persisting the aggregate and then deleting the overlays.
 * **If the aggregate write did not actually happen, that delete would destroy
 * the entire import** — which is exactly the kind of thing that is obvious in
 * hindsight and invisible in a diff. It is tested here against real SQL rather
 * than argued about, and the concurrency rule with it: an admin's save landing
 * mid-compaction must survive.
 */
const db = new DatabaseSync(":memory:");

function runBatch(statements: { sql: string; params: unknown[] }[]) {
  db.exec("BEGIN");
  try {
    for (const statement of statements) {
      db.prepare(statement.sql).run(...(statement.params as never[]));
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return [{ success: true }];
}

vi.mock("./d1.server", () => ({
  d1Ready: async () => true,
  d1All: async (sql: string, ...binds: unknown[]) => db.prepare(sql).all(...(binds as never[])),
  d1First: async (sql: string, ...binds: unknown[]) => db.prepare(sql).get(...(binds as never[])),
  d1Run: async (sql: string, ...binds: unknown[]) => {
    db.prepare(sql).run(...(binds as never[]));
  },
  d1RunChanges: async (sql: string, ...binds: unknown[]) =>
    Number(db.prepare(sql).run(...(binds as never[])).changes ?? 0),
  d1BatchRun: async () => [],
  getD1: () => ({
    batch: (statements: { sql: string; params: unknown[] }[]) => runBatch(statements),
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({ sql, params }),
      sql,
      params: [] as unknown[],
    }),
  }),
  ensureSchema: async () => {},
  ensureUsersSchema: async () => {},
}));

vi.mock("./storage.server", () => ({
  listKeys: async () => [],
  mutateJson: async () => undefined,
  readJson: async (_key: string, fallback: unknown) => fallback,
  writeJson: async () => undefined,
}));
vi.mock("./whatsapp.server", () => ({ sendWhatsappMessage: async () => undefined }));
vi.mock("./telegram.server", () => ({ sendTelegramMessage: async () => undefined }));

import { PRODUCT_INDEX_SCHEMA } from "@/test/sqlite-d1";
import { buildBareListing, parseCatalogueCsv } from "./catalogueImport";

const store = await import("./db.server");

function reset() {
  for (const table of ["store_kv", "store_rev", "users", "product_index"]) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
  db.exec(
    `CREATE TABLE store_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  );
  db.exec(`CREATE TABLE store_rev (rev INTEGER PRIMARY KEY, updated_at TEXT NOT NULL)`);
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, created_at TEXT)`);
  for (const statement of PRODUCT_INDEX_SCHEMA) db.exec(statement);
  store.invalidateStoreCache();
}

beforeEach(reset);

const HEADER = "English Name,Cost IQD,Chinese Name,Platform,Offline Price IQD,English Support";

function listings(count: number) {
  const lines = Array.from(
    { length: count },
    (_, i) => `Catalogue Game ${i},1500,名字 ${i},Nintendo Switch,9000,نعم`,
  );
  return parseCatalogueCsv([HEADER, ...lines].join("\n")).rows.map(
    (row) => buildBareListing(row, { categoryId: "nintendo-switch-games" }).product,
  );
}

/** Exactly what a batch of the import does to the database. */
function writeOverlay(product: Record<string, unknown>, at: string) {
  db.prepare(
    `INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(`store:product:${String(product["id"])}`, JSON.stringify(product), at);
}

const overlayCount = () =>
  Number(
    (
      db
        .prepare(`SELECT COUNT(*) AS n FROM store_kv WHERE key LIKE 'store:product:%'`)
        .get() as { n: number }
    ).n,
  );

async function catalogueFromDb(): Promise<Record<string, any>[]> {
  store.invalidateStoreCache();
  return (await store.getStore()).products as unknown as Record<string, any>[];
}

/** The endpoint's compaction, as it runs there. */
async function compact(before: string) {
  await store.updateStore((current) => current);
  store.invalidateStoreCache();
  const stale = db
    .prepare(`SELECT key FROM store_kv WHERE key LIKE 'store:product:%' AND updated_at <= ?`)
    .all(before) as { key: string }[];
  for (const row of stale) {
    db.prepare(`DELETE FROM store_kv WHERE key IN (?) AND updated_at <= ?`).run(row.key, before);
  }
  store.invalidateStoreCache();
}

describe("finishing an import", () => {
  it("keeps every product after the overlays are deleted", async () => {
    const products = listings(40);
    const at = "2026-09-15T10:00:00.000Z";
    for (const product of products) writeOverlay(product, at);

    expect(overlayCount()).toBe(40);
    expect(await catalogueFromDb()).toHaveLength(40);

    await compact("2026-09-15T10:00:01.000Z");

    /*
      The assertion the whole file exists for. If `updateStore` had not
      actually written the aggregate — it is passed a mutation that returns the
      document unchanged — the delete would have removed the only copy of all
      forty products and this would read zero.
    */
    expect(overlayCount()).toBe(0);
    const after = await catalogueFromDb();
    expect(after).toHaveLength(40);
    expect(after.map((p) => p.id).sort()).toEqual(products.map((p) => p["id"]).sort());
  });

  it("keeps the prices, not just the rows", async () => {
    const products = listings(5);
    for (const product of products) writeOverlay(product, "2026-09-15T10:00:00.000Z");
    await compact("2026-09-15T10:00:01.000Z");
    const after = await catalogueFromDb();
    for (const product of after) {
      expect(product.price).toBe(9000);
      expect(product.cost).toBe(1500);
      expect(product.isInfiniteStock).toBe(true);
    }
  });

  it("does not discard an admin's save that landed mid-compaction", async () => {
    /*
      The reason the delete is narrowed by `updated_at` rather than by key.

      An admin editing a product after the aggregate was read has written a row
      the persisted document does not contain. Deleting it by key alone would
      throw their edit away and report success.
    */
    const products = listings(3);
    for (const product of products) writeOverlay(product, "2026-09-15T10:00:00.000Z");

    const before = "2026-09-15T10:00:01.000Z";
    await store.updateStore((current) => current);
    store.invalidateStoreCache();

    // The admin's save, after the aggregate was written.
    writeOverlay(
      { ...products[0]!, price: 12345, description: "وصف كتبه الأدمن" },
      "2026-09-15T10:00:02.000Z",
    );

    const stale = db
      .prepare(`SELECT key FROM store_kv WHERE key LIKE 'store:product:%' AND updated_at <= ?`)
      .all(before) as { key: string }[];
    for (const row of stale) {
      db.prepare(`DELETE FROM store_kv WHERE key IN (?) AND updated_at <= ?`).run(row.key, before);
    }
    store.invalidateStoreCache();

    // Two compacted away, the newer one still standing.
    expect(overlayCount()).toBe(1);
    const after = await catalogueFromDb();
    expect(after).toHaveLength(3);
    expect(after.find((p) => p.id === products[0]!["id"])?.price).toBe(12345);
  });

  it("leaves an untouched product alone", async () => {
    // An import must not disturb what it did not import.
    await store.updateStore((current) => {
      current.products = [
        {
          id: "existing",
          title: "Zelda",
          titleEn: "Zelda",
          price: 14750,
          status: "نشط",
          categoryId: "cat_nintendo",
        },
      ] as never;
      return current;
    });

    for (const product of listings(4)) writeOverlay(product, "2026-09-15T10:00:00.000Z");
    await compact("2026-09-15T10:00:01.000Z");

    const after = await catalogueFromDb();
    expect(after).toHaveLength(5);
    expect(after.find((p) => p.id === "existing")?.price).toBe(14750);
  });
});
