/**
 * @vitest-environment node
 */
/**
 * What a products page costs, at catalogue sizes the store will actually reach.
 *
 * The regression this guards is the one that shipped: the endpoint read the
 * whole catalogue document to render one page, so its cost grew with the
 * catalogue rather than with the page. Both shapes are measured here against
 * the same data — the old one reconstructing the document, the new one running
 * two indexed queries — so the difference is a number rather than a claim.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, PRODUCT_INDEX_SCHEMA, type FakeD1 } from "@/test/sqlite-d1";

let db: FakeD1;

vi.mock("@/lib/env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__TEST_D1__"] }),
  getBinding: () => undefined,
}));

const { readProductIndexPage, rebuildProductIndex } = await import("./product-index.server");
const { sortProducts } = await import("./productSort");

/**
 * A product the size the catalogue actually carries.
 *
 * A Nintendo game document holds the hub data — timeline, gallery, reviews,
 * performance modes, sources — and lands in the tens of kilobytes. That size is
 * the whole point: it is what the listing used to parse, per product, per
 * request.
 */
function heavyProduct(index: number) {
  return {
    id: `prd_${String(index).padStart(5, "0")}`,
    title: `Game ${index}`,
    titleEn: `Game ${index}`,
    slug: `game-${index}`,
    price: 20000 + (index % 40) * 1000,
    stock: index % 7,
    displayOrder: index,
    updatedAt: new Date(1735689600000 + index * 3600_000).toISOString(),
    releaseDate: new Date(1704067200000 + index * 86400_000).toISOString(),
    category: "cat_nintendo",
    cartridgeImage: `https://cdn.test/${index}.webp`,
    description: "و".repeat(4000),
    descriptionEn: "x".repeat(4000),
    gallery: Array.from({ length: 24 }, (_, g) => ({
      url: `https://cdn.test/${index}/${g}.webp`,
      title: `shot ${g}`,
      description: "y".repeat(120),
    })),
    hubData: {
      timeline: Array.from({ length: 30 }, (_, t) => ({ year: 2000 + t, note: "z".repeat(160) })),
      reviews: Array.from({ length: 12 }, (_, r) => ({ source: `outlet ${r}`, quote: "q".repeat(200) })),
    },
    performanceModes: Array.from({ length: 8 }, (_, m) => ({ mode: `mode ${m}`, fps: 30 + m })),
  };
}

beforeEach(() => {
  db = createSqliteD1(PRODUCT_INDEX_SCHEMA);
  (globalThis as Record<string, unknown>)["__TEST_D1__"] = db;
});

afterEach(() => {
  db.close();
  delete (globalThis as Record<string, unknown>)["__TEST_D1__"];
});

describe("cost of one products page", () => {
  for (const size of [876, 1706]) {
    it(`stays flat at ${size} products`, async () => {
      const catalogue = Array.from({ length: size }, (_, i) => heavyProduct(i));

      /*
        The old shape, reproduced: read the whole catalogue document out of
        store_kv, parse it, sort every product in JavaScript, then slice a page
        off the end. Nothing here is contrived — it is what the endpoint did.
      */
      const documentBytes = JSON.stringify(catalogue).length;
      const beforeStart = performance.now();
      const parsed = JSON.parse(JSON.stringify(catalogue)) as Record<string, unknown>[];
      const sortedAll = sortProducts(parsed, { field: "updated", direction: "desc" });
      const oldPage = sortedAll.slice(0, 50);
      const beforeMs = performance.now() - beforeStart;
      const oldBytes = JSON.stringify(oldPage).length;

      await rebuildProductIndex(catalogue, 1);
      db.reset();
      const afterStart = performance.now();
      const page = await readProductIndexPage({
        page: 1,
        limit: 50,
        sort: { field: "updated", direction: "desc" },
      });
      const afterMs = performance.now() - afterStart;
      const newBytes = JSON.stringify(page.items).length;

      console.log(
        `[bench] products=${size}` +
          ` document_bytes=${documentBytes}` +
          ` old_parse_sort_ms=${beforeMs.toFixed(1)} old_page_bytes=${oldBytes}` +
          ` new_query_ms=${afterMs.toFixed(1)} new_page_bytes=${newBytes}` +
          ` d1_queries=${db.log.length}`,
      );

      expect(page.items).toHaveLength(50);
      expect(page.total).toBe(size);
      // Three queries, always: the count, the page, and the chip aggregates.
      expect(db.log).toHaveLength(3);
      /*
        The listing payload is the point. A page of full documents grows with
        the size of each product; a page of projection rows does not, and is
        two orders of magnitude smaller here.
      */
      expect(newBytes).toBeLessThan(30_000);
      expect(newBytes * 20).toBeLessThan(oldBytes);
    });
  }

  it("returns the same page whichever size the catalogue is", async () => {
    // Pagination is a property of the query, not of how much was loaded.
    for (const size of [100, 1000]) {
      await rebuildProductIndex(
        Array.from({ length: size }, (_, i) => heavyProduct(i)),
        1,
      );
      const page = await readProductIndexPage({ page: 2, limit: 50 });
      expect(page.items).toHaveLength(50);
      expect(page.items[0]!.id).toBe(`prd_${String(size - 51).padStart(5, "0")}`);
    }
  });
});
