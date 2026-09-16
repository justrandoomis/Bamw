/**
 * @vitest-environment node
 * What one catalogue-import batch costs, against a real node:sqlite D1.
 */
import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { PRODUCT_INDEX_SCHEMA } from "../test/sqlite-d1";

const db = new DatabaseSync(":memory:");

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
const norm = (b: unknown[]) =>
  b.map((v) => (v === undefined || v === null ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));

vi.mock("./d1.server", () => ({
  d1Ready: async () => true,
  d1All: async (sql: string, ...binds: unknown[]) => db.prepare(sql).all(...(norm(binds) as never[])),
  d1First: async (sql: string, ...binds: unknown[]) =>
    (db.prepare(sql).all(...(norm(binds) as never[])) as any[])[0] ?? null,
  d1Run: async (sql: string, ...binds: unknown[]) => { db.prepare(sql).run(...(norm(binds) as never[])); },
  d1RunChanges: async () => 0,
  d1BatchRun: async () => [],
  d1Batch: async () => [],
  getD1: () => d1,
  ensureSchema: async () => {},
  ensureUsersSchema: async () => {},
}));
vi.mock("./storage.server", () => ({
  listKeys: async () => [], mutateJson: async () => undefined,
  readJson: async (_k: string, f: unknown) => f, writeJson: async () => undefined,
}));
vi.mock("./whatsapp.server", () => ({ sendWhatsappMessage: async () => undefined }));
vi.mock("./telegram.server", () => ({ sendTelegramMessage: async () => undefined, escapeHtml: (s: string) => s }));
vi.mock("./telegram-notifications.server", () => ({ getUserTelegramChatId: async () => undefined }));

const store = await import("./db.server");

const DESC = "و".repeat(2824);
/** A written-up product, sized to production's measured 4,371 bytes/product average. */
function writtenUp(i: number) {
  return {
    id: `prd_${String(i).padStart(12, "0")}`,
    slug: `game-${i}`,
    title: `لعبة ${i}`,
    titleEn: `Game ${i}`,
    kind: "game",
    categoryId: "nintendo-switch-games",
    category: "ألعاب نينتندو سويتش",
    platform: i % 2 ? "switch" : "switch2",
    price: 20000 + i, cost: 12000 + i, stock: 5, sales: i % 40,
    isActive: true, isHidden: i % 97 === 0, status: "نشط",
    displayOrder: i, releaseDate: "2024-05-01",
    createdAt: new Date(1735689600000 + i * 1000).toISOString(),
    updatedAt: new Date(1735689600000 + i * 1000).toISOString(),
    description: DESC,
    image: `https://cdn.test/${i}/front.png`,
    gallery: Array.from({ length: 6 }, (_, g) => `https://cdn.test/${i}/${g}.webp`),
    images: Array.from({ length: 3 }, (_, g) => `https://cdn.test/${i}/i${g}.webp`),
    options: [
      { id: "opt_offline", name: "حساب أوفلاين", description: "حساب مخصص للعب دون اتصال.", stock: 9999, isInfiniteStock: true },
      { id: "opt_online", name: "حساب أونلاين", description: "حساب خاص بك.", price: 30000 + i, stock: 10 },
    ],
    types: [
      { id: "typ_standard", name: "Standard", description: "النسخة الأساسية من اللعبة.", price: 0 },
      { id: "typ_dlc", name: "Deluxe", description: "النسخة مع المحتوى الإضافي.", price: 8000 },
    ],
    editions: [{ id: "typ_gold", name: "Gold", description: "النسخة الذهبية.", price: 12000 }],
    modes: ["single", "multi"], boxContents: ["cartridge", "manual"], dlcs: [],
    devicePerformance: [
      { device: "Nintendo Switch 2", deviceSlug: "nintendo-switch-2", handheld: { supported: true, resolution: "1080p", fps: "60" }, tv: { supported: true, resolution: "4K", fps: "60" } },
    ],
  };
}
/** Exactly what buildListing mints for a new supplier row. */
function bare(i: number) {
  return {
    id: `prd_cat_new-game-${i}`, slug: `new-game-${i}`,
    title: `New Game ${i}`, titleEn: `New Game ${i}`, kind: "game",
    categoryId: "nintendo-switch-games", category: "ألعاب نينتندو سويتش",
    platform: "switch", price: 25000, cost: 0, stock: 9999,
    isInfiniteStock: true, accountEnabled: true, accountPrice: 25000, accountStock: 9999,
    options: [{ id: "opt_offline", name: "حساب أوفلاين", description: "حساب مخصص للعب دون اتصال بعد إكمال خطوات التفعيل.", stock: 9999, isInfiniteStock: true }],
    isActive: true, isHidden: false, status: "active",
    englishSupport: true, catalogueSource: "supplier-catalogue",
    updatedAt: "2026-09-16T00:00:00.000Z", createdAt: "2026-09-16T00:00:00.000Z",
  };
}

function seed(written: number, bares: number) {
  db.exec(`DROP TABLE IF EXISTS store_kv`); db.exec(`DROP TABLE IF EXISTS store_rev`);
  db.exec(`DROP TABLE IF EXISTS product_index`);
  db.exec(`CREATE TABLE store_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.exec(`CREATE TABLE store_rev (rev INTEGER PRIMARY KEY, updated_at TEXT NOT NULL)`);
  for (const s of PRODUCT_INDEX_SCHEMA) db.exec(s);
  const ins = db.prepare(`INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)`);
  const products = [
    ...Array.from({ length: written }, (_, i) => writtenUp(i)),
    ...Array.from({ length: bares }, (_, i) => bare(i)),
  ];
  const raw = JSON.stringify(products);
  ins.run("store", JSON.stringify({ categories: [{ id: "nintendo-switch-games", title: "ألعاب نينتندو سويتش" }] }), "now");
  const CHUNK = 400_000;
  if (raw.length <= CHUNK) ins.run("store:products", raw, "now");
  else {
    ins.run("store:products", "", "now");
    for (let i = 0; i * CHUNK < raw.length; i++)
      ins.run(`store:products#${String(i + 1).padStart(3, "0")}`, raw.slice(i * CHUNK, (i + 1) * CHUNK), "now");
  }
  ins.run("store:banners", "[]", "now"); ins.run("store:bundles", "[]", "now"); ins.run("store:content", "{}", "now");
  db.prepare(`INSERT INTO store_rev (rev, updated_at) VALUES (1, 'now')`).run();
  store.invalidateStoreCache();
  return { count: products.length, bytes: raw.length };
}

async function measureBatch(label: string, written: number, bares: number, offset: number) {
  const seeded = seed(written, bares);
  // Prime the projection so readProductIndexFingerprints has real rows.
  await store.updateStore((c) => c);
  store.invalidateStoreCache();
  const gc = (globalThis as any).gc;
  if (gc) { gc(); gc(); }
  const h0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  await store.updateStore((current) => {
    const products = [...((current.products ?? []) as any[])];
    for (let i = 0; i < 100; i++) products.push(bare(offset + i));
    return { ...current, products } as any;
  });
  const ms = performance.now() - t0;
  const h1 = process.memoryUsage().heapUsed;
  console.log(
    `[batch-cost] ${label} products=${seeded.count} doc_bytes=${seeded.bytes} ms=${ms.toFixed(1)} heap_delta_mb=${((h1 - h0) / 1048576).toFixed(1)}`,
  );
  return ms;
}

const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

describe("one import batch", () => {
  for (const [label, written, bares, off] of [
    ["N=876", 876, 0, 10000], ["N=1275", 876, 399, 20000], ["N=1619", 876, 743, 30000],
  ] as [string, number, number, number][]) {
    it(`at ${label}`, async () => {
      const runs: number[] = [];
      for (let r = 0; r < 5; r++) runs.push(await measureBatch(label, written, bares, off + r * 1000));
      console.log(`[MEDIAN] ${label} ms=${median(runs).toFixed(1)}`);
      expect(true).toBe(true);
    }, 300_000);
  }
});
