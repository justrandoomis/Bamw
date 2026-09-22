/**
 * @vitest-environment node
 */
/**
 * One normalise pass per write, and nothing commercial moves because of it.
 *
 * `loadStore` normalised every product on the way out of D1, normalised the
 * same objects again at the section sweep, and `persistStore` normalised them
 * a third time on the way back in — three full rebuilds of the catalogue per
 * catalogue-import batch, sixteen batches to a run. Passes two and three ran
 * over records pass one had already produced, so they cost full price and
 * changed nothing.
 *
 * `normalizeProductRecord` now remembers the objects it minted and hands them
 * straight back. That is only safe while the function is a fixed point on its
 * own output, so the first test below is the load-bearing one: it clones
 * between passes, which defeats the identity shortcut entirely and compares
 * values. If anyone makes the normaliser non-idempotent, that test fails here
 * rather than silently writing a different catalogue to production.
 *
 * The second test runs a real batch through `updateStore` against
 * `node:sqlite` and reads the chunks back out of `store_kv`, so "prices, costs,
 * stock, hidden flags, options, types, editions, trade-in values, display
 * order and sales did not move" is asserted against bytes SQLite actually
 * stored, not against a mock agreeing with itself.
 */

import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { PRODUCT_INDEX_SCHEMA } from "../test/sqlite-d1";

const db = new DatabaseSync(":memory:");
const norm = (b: unknown[]) =>
  b.map((v) => (v === undefined || v === null ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));

const d1 = {
  prepare: (sql: string) => {
    const make = (binds: unknown[]): any => ({
      bind: (...v: unknown[]) => make(v),
      all: async () => ({ results: db.prepare(sql).all(...(norm(binds) as never[])) }),
      first: async () => (db.prepare(sql).all(...(norm(binds) as never[])) as any[])[0] ?? null,
      run: async () => ({ success: true, meta: { changes: 0 } }),
      _sql: sql,
      _params: norm(binds),
    });
    return make([]);
  },
  batch: async (stmts: any[]) => {
    for (const s of stmts) {
      const prepared = db.prepare(s._sql);
      if (/^\s*select/i.test(s._sql)) prepared.all(...(s._params as never[]));
      else prepared.run(...(s._params as never[]));
    }
    return [];
  },
};

vi.mock("./d1.server", () => ({
  d1Ready: async () => true,
  d1All: async (sql: string, ...b: unknown[]) => db.prepare(sql).all(...(norm(b) as never[])),
  d1First: async (sql: string, ...b: unknown[]) =>
    (db.prepare(sql).all(...(norm(b) as never[])) as any[])[0] ?? null,
  d1Run: async (sql: string, ...b: unknown[]) => {
    db.prepare(sql).run(...(norm(b) as never[]));
  },
  d1RunChanges: async () => 0,
  d1BatchRun: async () => [],
  d1Batch: async () => [],
  getD1: () => d1,
  ensureSchema: async () => {},
  ensureUsersSchema: async () => {},
}));
vi.mock("./storage.server", () => ({
  listKeys: async () => [],
  mutateJson: async () => undefined,
  readJson: async (_k: string, f: unknown) => f,
  writeJson: async () => undefined,
}));
vi.mock("./whatsapp.server", () => ({ sendWhatsappMessage: async () => undefined }));
vi.mock("./telegram.server", () => ({
  sendTelegramMessage: async () => undefined,
  escapeHtml: (s: string) => s,
}));
vi.mock("./telegram-notifications.server", () => ({ getUserTelegramChatId: async () => undefined }));

/*
  The real implementations, wrapped in counters. A spy that replaced them would
  only prove the spy agrees with itself; these call through.
*/
const optionCalls = { n: 0 };
vi.mock("./productOptionDescriptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./productOptionDescriptions")>();
  return {
    ...actual,
    normalizeProductOption: (o: Record<string, unknown>) => {
      optionCalls.n += 1;
      return actual.normalizeProductOption(o);
    },
  };
});

const store = await import("./db.server");

/* ------------------------------------------------------------------ values */

/** Shapes chosen to stress every branch of the normaliser, not a happy path. */
const corpus: Record<string, unknown>[] = [
  { id: "prd_a", title: "Game A", price: 1000, cost: 500, stock: 3 },
  { id: "prd_b", title: "Game B", price: "1000", cost: "500", stock: "3", sales: "7" },
  { id: "cat_x", title: "Accessory", price: 10 },
  { id: "prd_c", title: "Game C" },
  {
    id: "prd_d",
    title: "Game D",
    image: "https://switch-images-julio.com/x/display/index.html?code=ABCDE",
  },
  { id: "prd_ca9a9392db394624", title: "Known cover" },
  {
    id: "prd_e",
    title: "Game E",
    variants: [{ id: "typ_1", name: "Deluxe", description: "supplier note: 1 CNY = 200 IQD" }],
  },
  {
    id: "prd_f",
    title: "Game F",
    options: [{ id: "opt_1", name: "Mystery", description: "سعر البيع: 7,000 د.ع" }],
  },
  {
    id: "prd_g",
    title: "Game G",
    options: [{ id: "opt_2", name: "Mystery", description: "Some plain text" }],
  },
  {
    id: "prd_h",
    title: "Game H",
    options: [
      { id: "opt_3", name: "Offline", description: "wholesale only", internal_note: "keep" },
    ],
  },
  {
    id: "prd_i",
    title: "Game I",
    types: [{ id: "typ_2", name: "Mystery", description: "the base standard version" }],
  },
  { id: "prd_j", title: "Game J", editions: [{ id: "typ_3", name: "Ultimate", description: "豪华版" }] },
  // devicePerformance present but empty, with the pre-v2 flat fields behind it.
  {
    id: "prd_k",
    title: "Game K",
    devicePerformance: [],
    perfFps: "60",
    perfResolutionDocked: "1080p",
    platform: "switch2",
  },
  {
    id: "prd_l",
    title: "Game L",
    devicePerformance: [
      {
        device: "Nintendo Switch 2",
        deviceSlug: "nintendo-switch-2",
        handheld: { supported: true, fps: "60" },
      },
    ],
  },
  {
    id: "prd_m",
    title: "Game M",
    devicePerformance: [{ device: "Nintendo Switch" }, { device: "Nintendo Switch" }],
  },
  { id: "prd_n", english_name: "English Only" },
  { id: "prd_o", name: "Name Only", titleAr: "عربي" },
  {
    id: "prd_q",
    title: "Game Q",
    images: ["a", null, "b"],
    gallery: [null],
    dlcs: [0, "x"],
    modes: [""],
    boxContents: [null, "z"],
  },
  { id: "prd_r", title: "Game R", isHidden: true, isActive: false, status: "مخفي", displayOrder: 5 },
  {
    id: "prd_s",
    title: "Game S",
    options: [{ id: "opt_4", name: "Online", description: "offline shared" }],
  },
  {
    id: "prd_t",
    title: "Game T",
    types: [{ id: "typ_4", name: "Mystery", description: "اللعبة مع الإضافات" }],
  },
  {
    id: "prd_u",
    title: "Game U",
    types: [{ id: "typ_5", name: "Mystery", description: "اللعبة الأساسية" }],
  },
  {
    id: "prd_v",
    title: "Game V",
    options: [{ id: "opt_5", name: "Mystery", description: "حساب مشترك" }],
  },
  {
    id: "prd_w",
    title: "Game W",
    options: [{ id: "opt_6", name: "Mystery", description: "حساب خاص بك" }],
  },
  {
    id: "prd_x",
    title: "Game X",
    options: [{ id: "opt_7", name: "Mystery", customerDescription: "CNY 30" }],
  },
  {
    id: "prd_y",
    title: "Game Y",
    box_front_url: " https://cdn/x.jpg ",
    cover_front_url: "https://cdn/y.jpg",
    cartridgeImage: "https://cdn/z.jpg",
    coverImage: "https://cdn/w.jpg",
  },
  {
    id: "prd_z",
    title: "Game Z",
    tradeInValue: 4500,
    infiniteStock: true,
    displayOrder: 12,
    sales: 9,
    hubData: { a: 1 },
  },
];

describe("normalizeProductRecord", () => {
  it("is a fixed point on its own output, by value and by key order", () => {
    const drift: string[] = [];
    for (const p of corpus) {
      // Cloned between passes, so object identity cannot answer for the value.
      const once = store.normalizeProductRecord(structuredClone(p));
      const twice = store.normalizeProductRecord(structuredClone(once));
      const thrice = store.normalizeProductRecord(structuredClone(twice));
      const a = JSON.stringify(once);
      const b = JSON.stringify(twice);
      if (a !== b) drift.push(`${String(p["id"])} value\n  1: ${a}\n  2: ${b}`);
      if (b !== JSON.stringify(thrice)) drift.push(`${String(p["id"])} value pass2≠pass3`);
      const k1 = Object.keys(once).join(",");
      const k2 = Object.keys(twice).join(",");
      if (k1 !== k2) drift.push(`${String(p["id"])} keys\n  1: ${k1}\n  2: ${k2}`);
    }
    expect(drift).toEqual([]);
  });

  it("hands its own output back untouched", () => {
    const once = store.normalizeProductRecord({ id: "prd_same", title: "Same", price: 7 });
    expect(store.normalizeProductRecord(once)).toBe(once);
  });
});

/* --------------------------------------------------------- the real write */

/** A written-up product: the kind the import must not disturb. */
function shopProduct(i: number) {
  return store.normalizeProductRecord({
    id: `prd_${String(i).padStart(6, "0")}`,
    slug: `game-${i}`,
    title: `لعبة ${i}`,
    titleEn: `Game ${i}`,
    kind: "game",
    categoryId: "nintendo-switch-games",
    category: "ألعاب نينتندو سويتش",
    price: 20000 + i,
    cost: 12000 + i,
    stock: 5,
    sales: i % 7,
    isActive: i % 5 !== 0,
    isHidden: i % 3 === 0,
    status: i % 3 === 0 ? "مخفي" : "نشط",
    displayOrder: 500 - i,
    tradeInValue: 3000 + i,
    isInfiniteStock: i % 2 === 0,
    options: [
      { id: "opt_offline", name: "حساب أوفلاين", stock: 9999, isInfiniteStock: true },
      { id: "opt_online", name: "حساب أونلاين", price: 30000 + i, stock: 10 },
    ],
    types: [
      { id: "typ_standard", name: "Standard", price: 0 },
      { id: "typ_dlc", name: "Deluxe", price: 8000 },
    ],
    editions: [{ id: "typ_gold", name: "Gold", price: 12000 }],
    createdAt: new Date(1735689600000 + i * 1000).toISOString(),
    updatedAt: new Date(1735689600000 + i * 1000).toISOString(),
  }) as unknown as Record<string, unknown>;
}

function seed(count: number) {
  db.exec(`DROP TABLE IF EXISTS store_kv`);
  db.exec(`DROP TABLE IF EXISTS store_rev`);
  db.exec(`DROP TABLE IF EXISTS product_index`);
  db.exec(
    `CREATE TABLE store_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  );
  db.exec(`CREATE TABLE store_rev (rev INTEGER PRIMARY KEY, updated_at TEXT NOT NULL)`);
  for (const s of PRODUCT_INDEX_SCHEMA) db.exec(s);
  const products = Array.from({ length: count }, (_, i) => shopProduct(i));
  const ins = db.prepare(`INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)`);
  ins.run("store", JSON.stringify({ categories: [{ id: "nintendo-switch-games", title: "ألعاب" }] }), "now");
  ins.run("store:products", JSON.stringify(products), "now");
  ins.run("store:banners", "[]", "now");
  ins.run("store:bundles", "[]", "now");
  ins.run("store:content", "{}", "now");
  db.prepare(`INSERT INTO store_rev (rev, updated_at) VALUES (1, 'now')`).run();
  store.invalidateStoreCache();
  return products;
}

function readBack(): Record<string, unknown>[] {
  const rows = db
    .prepare(
      `SELECT key, value FROM store_kv WHERE key = 'store:products' OR key LIKE 'store:products#%' ORDER BY key ASC`,
    )
    .all() as { key: string; value: string }[];
  const chunks = rows.filter((r) => r.key !== "store:products" || r.value.trim());
  return JSON.parse(chunks.map((r) => r.value).join(""));
}

describe("one catalogue-import batch", () => {
  it("writes back every existing product byte-identical, and normalises each one once", async () => {
    const before = seed(60);
    optionCalls.n = 0;

    await store.updateStore((current) => {
      const products = [...((current.products ?? []) as unknown as Record<string, unknown>[])];
      // Exactly what buildListing mints, so the assertion is about the real shape.
      products.push({
        id: "prd_cat_new-title",
        slug: "new-title",
        title: "New Title",
        titleEn: "New Title",
        kind: "game",
        categoryId: "nintendo-switch-games",
        price: 25000,
        cost: 0,
        stock: 9999,
        isInfiniteStock: true,
        options: [{ id: "opt_offline", name: "حساب أوفلاين", stock: 9999, isInfiniteStock: true }],
        isActive: true,
        isHidden: false,
        status: "active",
        catalogueSource: "supplier-catalogue",
        createdAt: "2026-09-16T00:00:00.000Z",
        updatedAt: "2026-09-16T00:00:00.000Z",
      });
      return { ...current, products } as never;
    });

    const after = readBack();
    expect(after).toHaveLength(61);

    // Byte-for-byte, for every product the batch did not name.
    for (let i = 0; i < before.length; i++) {
      expect(JSON.stringify(after[i])).toBe(JSON.stringify(before[i]));
    }

    /*
      Sixty products, two options each. One pass is 120 calls; the three passes
      this change removed were 360. The bound is deliberately just above one
      pass — a re-added pass fails here loudly rather than only showing up as a
      503 on the sixteenth batch of a live import.
    */
    expect(optionCalls.n).toBeLessThanOrEqual(60 * 2 + 1 * 1 + 10);

    // And the projection still describes the catalogue that was written.
    const index = db
      .prepare(`SELECT id, price, cost, stock, hidden, sales, display_order FROM product_index`)
      .all() as Record<string, unknown>[];
    expect(index).toHaveLength(61);
    const byId = new Map(index.map((r) => [String(r["id"]), r]));
    for (const p of before) {
      const row = byId.get(String(p["id"]))!;
      expect(row["price"]).toBe(p["price"]);
      expect(row["cost"]).toBe(p["cost"]);
      expect(row["stock"]).toBe(p["stock"]);
      expect(row["sales"]).toBe(p["sales"]);
      expect(row["hidden"]).toBe(p["isHidden"] ? 1 : 0);
    }
  }, 60_000);
});
