/**
 * @vitest-environment node
 */
/**
 * The admin listing, run against a real SQLite database.
 *
 * Everything here is the SQL the Worker issues — the ordering, the pagination,
 * the folded name key, the query count — executed by SQLite and read back, so
 * a passing test is evidence about the statements rather than about a mock.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, PRODUCT_INDEX_SCHEMA, type FakeD1 } from "@/test/sqlite-d1";

let db: FakeD1;

/*
  `getD1()` reads the Worker env and prefers the native `bananto` binding, so
  the fake database is published there — the same lookup production takes.
*/
vi.mock("@/lib/env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__TEST_D1__"] }),
  getBinding: () => undefined,
}));

const {
  DEFAULT_PAGE_SIZE,
  productIndexCount,
  productIndexStatements,
  readProductIndexFingerprints,
  readProductIndexPage,
  rebuildProductIndex,
  toIndexRow,
} = await import("./product-index.server");
const { D1_MAX_BOUND_PARAMETERS, SAFE_SQL_VARIABLES } = await import("./sql-params");
const { sortableNameKey } = await import("./productSort");

function product(overrides: Record<string, unknown> = {}) {
  const id = String(overrides["id"] ?? `prd_${Math.random().toString(36).slice(2, 8)}`);
  return {
    id,
    title: `Product ${id}`,
    slug: id,
    price: 10000,
    stock: 3,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
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

describe("projection", () => {
  it("keeps only listing columns — the full document never reaches the table", () => {
    const row = toIndexRow({
      id: "prd_1",
      title: "Zelda",
      price: 55000,
      description: "x".repeat(50_000),
      gallery: Array.from({ length: 40 }, (_, i) => ({ url: `g${i}` })),
      hubData: { timeline: Array.from({ length: 100 }, () => ({})) },
    });
    expect(Object.keys(row)).not.toContain("description");
    expect(Object.keys(row)).not.toContain("gallery");
    expect(Object.keys(row)).not.toContain("hubData");
    expect(JSON.stringify(row).length).toBeLessThan(600);
  });

  it("reads every spelling of hidden the catalogue uses", () => {
    expect(toIndexRow({ id: "a", isHidden: true }).isHidden).toBe(true);
    expect(toIndexRow({ id: "b", visibility: "draft" }).isHidden).toBe(true);
    expect(toIndexRow({ id: "c", status: "مخفي" }).isHidden).toBe(true);
    expect(toIndexRow({ id: "d" }).isHidden).toBe(false);
  });

  it("binds every column it declares", () => {
    const statements = productIndexStatements([product({ id: "prd_1" })], 7);
    const insert = statements.find((s) => s.sql.startsWith("INSERT"))!;
    const columns = insert.sql
      .slice(insert.sql.indexOf("(") + 1, insert.sql.indexOf(")"))
      .split(",");
    expect(insert.params).toHaveLength(columns.length);
  });
});

describe("reading a page", () => {
  it("returns the requested page and D1's own total", async () => {
    await rebuildProductIndex(
      Array.from({ length: 137 }, (_, i) =>
        product({ id: `prd_${String(i).padStart(3, "0")}`, displayOrder: i }),
      ),
      1,
    );
    expect(await productIndexCount()).toBe(137);

    const first = await readProductIndexPage({ page: 1, limit: 50 });
    expect(first.items).toHaveLength(50);
    expect(first.total).toBe(137);
    expect(first.hasMore).toBe(true);

    const last = await readProductIndexPage({ page: 3, limit: 50 });
    expect(last.items).toHaveLength(37);
    expect(last.hasMore).toBe(false);
  });

  it("never returns more than the maximum page size", async () => {
    await rebuildProductIndex(
      Array.from({ length: 300 }, () => product()),
      1,
    );
    const page = await readProductIndexPage({ page: 1, limit: 5000 });
    expect(page.items.length).toBeLessThanOrEqual(100);
  });

  it("defaults to fifty rows rather than the catalogue", async () => {
    await rebuildProductIndex(
      Array.from({ length: 200 }, () => product()),
      1,
    );
    const page = await readProductIndexPage({});
    expect(page.items).toHaveLength(DEFAULT_PAGE_SIZE);
  });

  it("pages a product exactly once — no duplicates, no gaps", async () => {
    await rebuildProductIndex(
      // Same price on every row, so only the id tie-break gives a stable order.
      Array.from({ length: 120 }, (_, i) => product({ id: `prd_${i}`, price: 5000 })),
      1,
    );
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const result = await readProductIndexPage({
        page,
        limit: 50,
        sort: { field: "price", direction: "asc" },
      });
      seen.push(...result.items.map((item) => item.id));
    }
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
  });
});

describe("ordering happens in SQL", () => {
  const catalogue = [
    product({ id: "a", title: "Mario Kart 8", price: 52000, updatedAt: "2026-03-01T00:00:00Z" }),
    product({ id: "b", title: "Mario Kart 10", price: 9000, updatedAt: "2026-01-01T00:00:00Z" }),
    product({ id: "c", title: "Mario Kart 2", price: 22000, updatedAt: "2026-02-01T00:00:00Z" }),
    product({ id: "d", title: "Zelda", price: null, updatedAt: null, createdAt: null }),
  ];

  beforeEach(async () => {
    await rebuildProductIndex(catalogue, 1);
  });

  it("sorts price numerically, not as text", async () => {
    const page = await readProductIndexPage({ sort: { field: "price", direction: "asc" } });
    // 9000 before 22000: string ordering would put "22000" first.
    expect(page.items.map((i) => i.id).slice(0, 3)).toEqual(["b", "c", "a"]);
  });

  it("puts missing values last in both directions", async () => {
    const asc = await readProductIndexPage({ sort: { field: "price", direction: "asc" } });
    const desc = await readProductIndexPage({ sort: { field: "price", direction: "desc" } });
    // The unpriced product is not "the cheapest", and flipping the column must
    // not promote it to the top either.
    expect(asc.items.at(-1)!.id).toBe("d");
    expect(desc.items.at(-1)!.id).toBe("d");
  });

  it("sorts names the way the browser's collator does, numerics included", async () => {
    const page = await readProductIndexPage({ sort: { field: "name", direction: "asc" } });
    // "Mario Kart 2" before "Mario Kart 8" before "Mario Kart 10" — plain text
    // ordering puts 10 before 2.
    expect(page.items.map((i) => i.title)).toEqual([
      "Mario Kart 2",
      "Mario Kart 8",
      "Mario Kart 10",
      "Zelda",
    ]);
  });

  it("orders by last edit as a number, across mixed date spellings", async () => {
    const page = await readProductIndexPage({ sort: { field: "updated", direction: "desc" } });
    expect(page.items.map((i) => i.id).slice(0, 3)).toEqual(["a", "c", "b"]);
  });

  it("folds alef variants so an Arabic title sorts where a reader expects", async () => {
    await rebuildProductIndex(
      [
        product({ id: "x", title: "أساسي" }),
        product({ id: "y", title: "اساسي" }),
        product({ id: "z", title: "بداية" }),
      ],
      1,
    );
    const page = await readProductIndexPage({ sort: { field: "name", direction: "asc" } });
    // The two spellings of the same word are adjacent, and both precede ب.
    expect(page.items.map((i) => i.id)).toEqual(["x", "y", "z"]);
    expect(sortableNameKey("أساسي")).toBe(sortableNameKey("اساسي"));
  });
});

describe("filtering happens in SQL", () => {
  beforeEach(async () => {
    await rebuildProductIndex(
      [
        product({ id: "a", title: "Mario Kart 8 Deluxe", categoryId: "cat_nintendo" }),
        product({ id: "b", title: "Pro Controller", categoryId: "cat_accessories", price: 0 }),
        product({ id: "c", title: "بطاقة eShop", categoryId: "cat_gift_cards", isHidden: true }),
      ],
      1,
    );
  });

  it("searches without loading the catalogue", async () => {
    const page = await readProductIndexPage({ search: "mario" });
    expect(page.items.map((i) => i.id)).toEqual(["a"]);
    expect(page.total).toBe(1);
  });

  it("searches Arabic through the same folded key", async () => {
    const page = await readProductIndexPage({ search: "بطاقه" });
    expect(page.items.map((i) => i.id)).toEqual(["c"]);
  });

  it("filters hidden and unpriced rows in the query, not after it", async () => {
    expect((await readProductIndexPage({ hidden: true })).items.map((i) => i.id)).toEqual(["c"]);
    expect((await readProductIndexPage({ hidden: false })).total).toBe(2);
    expect((await readProductIndexPage({ onlyUnpriced: true })).items.map((i) => i.id)).toEqual([
      "b",
    ]);
  });

  it("matches legacy store category ids to canonical indexed ids", async () => {
    await rebuildProductIndex(
      [
        product({ id: "legacy-card", categoryId: "gift-cards", schemaId: "gift_card" }),
        product({ id: "canonical-card", categoryId: "cat_gift_cards", schemaId: "gift_card" }),
        product({ id: "game", categoryId: "cat_nintendo" }),
      ],
      2,
    );

    const legacyFilter = await readProductIndexPage({ categoryId: "gift-cards" });
    const canonicalFilter = await readProductIndexPage({ categoryId: "cat_gift_cards" });

    expect(legacyFilter.items.map((item) => item.id).sort()).toEqual([
      "canonical-card",
      "legacy-card",
    ]);
    expect(canonicalFilter.items.map((item) => item.id).sort()).toEqual([
      "canonical-card",
      "legacy-card",
    ]);
    expect(legacyFilter.total).toBe(2);
    expect(canonicalFilter.total).toBe(2);
  });

  it("includes pre-migration gift cards by schema or kind", async () => {
    await rebuildProductIndex(
      [
        product({
          id: "schema-card",
          categoryId: "legacy-custom-category",
          schemaId: "gift_card",
        }),
        product({
          id: "kind-card",
          categoryId: "another-old-category",
          kind: "digital_code",
        }),
        product({
          id: "field-card",
          categoryId: "old-topup-category",
          cardValue: "$20",
          cardCurrency: "USD",
        }),
        product({ id: "game", categoryId: "cat_nintendo", kind: "account" }),
      ],
      3,
    );

    const page = await readProductIndexPage({ categoryId: "cat_gift_cards" });
    expect(page.items.map((item) => item.id).sort()).toEqual([
      "field-card",
      "kind-card",
      "schema-card",
    ]);
    expect(page.total).toBe(3);
  });

  it("counts the filtered set, so hasMore describes the rows it returned", async () => {
    const page = await readProductIndexPage({ search: "mario", limit: 1 });
    expect(page.total).toBe(1);
    expect(page.hasMore).toBe(false);
  });
});

describe("cost of a page", () => {
  it("is two queries, whatever the catalogue size", async () => {
    for (const size of [100, 500, 1200]) {
      await rebuildProductIndex(
        Array.from({ length: size }, (_, i) => product({ id: `p${size}_${i}` })),
        1,
      );
      db.reset();
      const page = await readProductIndexPage({ page: 1, limit: 50 });
      expect(page.items).toHaveLength(50);
      expect(page.total).toBe(size);
      /*
        Three statements, fixed: the filtered COUNT, the page, and one aggregate
        row for the filter chips. No per-row hydration and no N+1 — the number
        does not move when the catalogue grows tenfold.
      */
      expect(db.log).toHaveLength(3);
      expect(db.log.filter((sql) => /FROM product_index/.test(sql))).toHaveLength(3);
      // And nothing reached the document store.
      expect(db.log.some((sql) => /store_kv/.test(sql))).toBe(false);
    }
  });

  it("uses an index for every sort the table offers", async () => {
    await rebuildProductIndex(
      Array.from({ length: 200 }, () => product()),
      1,
    );
    for (const field of ["updated", "price", "name", "order"] as const) {
      db.reset();
      await readProductIndexPage({ sort: { field, direction: "desc" }, limit: 50 });
      const select = db.log.find((sql) => sql.startsWith("SELECT id"))!;
      const plan = db.raw.prepare(`EXPLAIN QUERY PLAN ${select.replace(/\?/g, "50")}`).all() as {
        detail: string;
      }[];
      const detail = plan.map((row) => row.detail).join(" | ");
      // A temporary B-tree in the plan means SQLite sorted the whole table to
      // answer one page, which is the cost this index set exists to avoid.
      expect(detail).not.toMatch(/USE TEMP B-TREE FOR ORDER BY/);
      expect(detail).toMatch(/USING (COVERING )?INDEX/);
    }
  });
});

describe("bound parameters stay within D1's limit", () => {
  /** Every `?` a statement carries. */
  const paramsOf = (statement: { params: unknown[] }) => statement.params.length;

  it("never exceeds the ceiling, at any catalogue size", async () => {
    for (const size of [1, 50, 137, 500, 1000, 5000]) {
      const catalogue = Array.from({ length: size }, (_, i) => product({ id: `p${i}` }));
      const statements = productIndexStatements(catalogue, 1);
      const worst = Math.max(...statements.map(paramsOf));
      // D1 rejects at 100. The old grouping bound 540 and failed at the 100th
      // variable — reported as "too many SQL variables at offset 488".
      expect(worst).toBeLessThan(D1_MAX_BOUND_PARAMETERS);
      expect(worst).toBeLessThanOrEqual(SAFE_SQL_VARIABLES);
    }
  });

  it("depends on the row width, not on how many products exist", () => {
    const small = productIndexStatements(
      Array.from({ length: 10 }, (_, i) => product({ id: `s${i}` })),
      1,
    );
    const large = productIndexStatements(
      Array.from({ length: 4000 }, (_, i) => product({ id: `l${i}` })),
      1,
    );
    expect(Math.max(...large.map(paramsOf))).toBe(Math.max(...small.map(paramsOf)));
  });

  it("actually executes against a database that enforces the limit", async () => {
    // The harness rejects >100 bound variables exactly as D1 does, so this
    // would have failed before the fix.
    await rebuildProductIndex(
      Array.from({ length: 1000 }, (_, i) => product({ id: `p${String(i).padStart(4, "0")}` })),
      1,
    );
    expect(await productIndexCount()).toBe(1000);
    const page = await readProductIndexPage({ page: 1, limit: 50 });
    expect(page.items).toHaveLength(50);
    expect(page.total).toBe(1000);
  });

  it("keeps a page read itself well inside the limit", async () => {
    await rebuildProductIndex(
      Array.from({ length: 200 }, () => product()),
      1,
    );
    db.reset();
    await readProductIndexPage({
      page: 4,
      limit: 100,
      search: "mario",
      categoryId: "cat_nintendo",
      hidden: false,
      onlyUnpriced: true,
      performanceRequired: true,
    });
    // Every filter and every legacy category alias at once still uses less
    // than a quarter of D1's 100-variable ceiling. The count is a function of
    // the filters, never of the catalogue.
    for (const sql of db.log) {
      expect((sql.match(/\?/g) ?? []).length).toBeLessThan(25);
    }
  });
});

describe("a save writes only what changed", () => {
  it("touches one row when one product changed", async () => {
    const catalogue = Array.from({ length: 300 }, (_, i) => product({ id: `p${i}` }));
    await rebuildProductIndex(catalogue, 1);

    const current = await readProductIndexFingerprints();
    expect(current.size).toBe(300);

    const edited = catalogue.map((p) => (p.id === "p7" ? { ...p, price: 99999 } : p));
    const statements = productIndexStatements(edited, 2, current);

    // One INSERT OR REPLACE, and no DELETE of the whole table.
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toContain("INSERT OR REPLACE");
    expect(statements[0]!.params).toHaveLength(27);
    expect(statements.some((s) => s.sql === "DELETE FROM product_index")).toBe(false);
  });

  it("writes nothing when nothing changed", async () => {
    const catalogue = Array.from({ length: 120 }, (_, i) => product({ id: `p${i}` }));
    await rebuildProductIndex(catalogue, 1);
    const current = await readProductIndexFingerprints();
    // A save that only touched a banner still rewrites the catalogue blob; it
    // must not rewrite the projection.
    expect(productIndexStatements(catalogue, 2, current)).toEqual([]);
  });

  it("removes rows for deleted products, in bounded batches", async () => {
    const catalogue = Array.from({ length: 500 }, (_, i) => product({ id: `p${i}` }));
    await rebuildProductIndex(catalogue, 1);
    const current = await readProductIndexFingerprints();

    const statements = productIndexStatements(catalogue.slice(0, 100), 2, current);
    const deletes = statements.filter((s) =>
      s.sql.startsWith("DELETE FROM product_index WHERE id"),
    );
    expect(deletes.length).toBeGreaterThan(1);
    expect(deletes.reduce((n, s) => n + s.params.length, 0)).toBe(400);
    for (const statement of deletes) {
      expect(statement.params.length).toBeLessThan(D1_MAX_BOUND_PARAMETERS);
    }
  });

  it("still applies the change it computed", async () => {
    const catalogue = Array.from({ length: 40 }, (_, i) => product({ id: `p${i}`, price: 1000 }));
    await rebuildProductIndex(catalogue, 1);
    const current = await readProductIndexFingerprints();
    const edited = catalogue.map((p) => (p.id === "p3" ? { ...p, price: 77000 } : p));

    for (const statement of productIndexStatements(edited, 2, current)) {
      db.raw.prepare(statement.sql).run(...(statement.params as never[]));
    }
    const page = await readProductIndexPage({ search: "p3" });
    expect(page.items[0]!.price).toBe(77000);
    expect(await productIndexCount()).toBe(40);
  });
});

/**
 * The catalogue's size, as distinct from the filter's.
 *
 * `total` counts what the current query matched — right for a pager, and what
 * "عرض 50 من أصل 73" should say. The admin header was showing that same number
 * under the label «منتج مسجل في D1», so narrowing to a category or typing a
 * search quietly restated how many products the shop holds: «عرض 12 من أصل 12
 * منتج مسجل في D1» on a catalogue of a hundred and forty.
 *
 * `catalogueTotal` is that second number. It rides on the aggregate the filter
 * chips already run over the whole table, so it costs no extra round trip.
 */
describe("the catalogue total, beside the match count", () => {
  it("counts every row while `total` counts the filtered ones", async () => {
    await rebuildProductIndex(
      [
        ...Array.from({ length: 12 }, (_, i) =>
          product({ id: `card_${i}`, categoryId: "cat_gift_cards" }),
        ),
        ...Array.from({ length: 128 }, (_, i) =>
          product({ id: `game_${i}`, categoryId: "cat_nintendo" }),
        ),
      ],
      1,
    );

    const filtered = await readProductIndexPage({ categoryId: "cat_gift_cards", limit: 50 });
    expect(filtered.total).toBe(12);
    expect(filtered.catalogueTotal).toBe(140);
  });

  it("is not moved by a search that matches one product", async () => {
    await rebuildProductIndex(
      [
        product({ id: "prd_zelda", title: "The Legend of Zelda" }),
        ...Array.from({ length: 40 }, () => product()),
      ],
      1,
    );

    const hit = await readProductIndexPage({ search: "zelda" });
    expect(hit.total).toBe(1);
    expect(hit.catalogueTotal).toBe(41);
  });

  it("is not moved by the hidden filter either", async () => {
    await rebuildProductIndex(
      [
        ...Array.from({ length: 3 }, (_, i) => product({ id: `h_${i}`, isHidden: true })),
        ...Array.from({ length: 20 }, () => product()),
      ],
      1,
    );

    const hidden = await readProductIndexPage({ hidden: true });
    expect(hidden.total).toBe(3);
    expect(hidden.catalogueTotal).toBe(23);
  });

  it("equals the match count when nothing is filtering", async () => {
    await rebuildProductIndex(
      Array.from({ length: 17 }, () => product()),
      1,
    );

    const all = await readProductIndexPage({});
    expect(all.total).toBe(17);
    expect(all.catalogueTotal).toBe(17);
  });
});
