/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRODUCT_SORT,
  lastModifiedAt,
  parseProductSort,
  sortProducts,
  type ProductSort,
} from "./productSort";

const ids = (rows: readonly Record<string, unknown>[]) => rows.map((r) => String(r["id"]));
const by = (rows: readonly Record<string, unknown>[], sort: ProductSort) => ids(sortProducts(rows, sort));

describe("price sorts as a number, not as text", () => {
  // The bug this pins: "22000" < "9000" as strings, so descending by price put
  // the cheapest product at the top of the admin table.
  const rows = [
    { id: "a", price: 9000 },
    { id: "b", price: 22000 },
    { id: "c", price: 250 },
    { id: "d", price: 100000 },
  ];

  it("ascending", () => {
    expect(by(rows, { field: "price", direction: "asc" })).toEqual(["c", "a", "b", "d"]);
  });

  it("descending", () => {
    expect(by(rows, { field: "price", direction: "desc" })).toEqual(["d", "b", "a", "c"]);
  });

  it("reads prices that arrived from a form as strings", () => {
    const mixed = [
      { id: "a", price: "9000" },
      { id: "b", price: 22000 },
      { id: "c", price: "250" },
    ];
    expect(by(mixed, { field: "price", direction: "asc" })).toEqual(["c", "a", "b"]);
  });
});

describe("unpriced products stay at the bottom in both directions", () => {
  const rows = [
    { id: "priced-low", price: 1000 },
    { id: "no-price" },
    { id: "priced-high", price: 5000 },
    { id: "empty-price", price: "" },
  ];

  it("ascending", () => {
    const out = by(rows, { field: "price", direction: "asc" });
    expect(out.slice(0, 2)).toEqual(["priced-low", "priced-high"]);
    expect(out.slice(2).sort()).toEqual(["empty-price", "no-price"]);
  });

  it("descending — a missing price is not the biggest price", () => {
    const out = by(rows, { field: "price", direction: "desc" });
    expect(out.slice(0, 2)).toEqual(["priced-high", "priced-low"]);
    expect(out.slice(2).sort()).toEqual(["empty-price", "no-price"]);
  });
});

describe("last modified reads every spelling the write paths use", () => {
  it("takes the newest of the candidates", () => {
    expect(lastModifiedAt({ createdAt: "2024-01-01T00:00:00Z", updatedAt: "2025-06-01T00:00:00Z" })).toBe(
      Date.parse("2025-06-01T00:00:00Z"),
    );
    expect(lastModifiedAt({ updated_at: "2025-06-01T00:00:00Z" })).toBe(
      Date.parse("2025-06-01T00:00:00Z"),
    );
  });

  it("falls back to creation, so an unedited product still has a place", () => {
    expect(lastModifiedAt({ createdAt: "2024-01-01T00:00:00Z" })).toBe(
      Date.parse("2024-01-01T00:00:00Z"),
    );
    expect(lastModifiedAt({})).toBeNull();
  });

  it("puts the most recently touched product first on descending", () => {
    const rows = [
      { id: "old", updatedAt: "2024-01-01T00:00:00Z" },
      { id: "newest", updatedAt: "2026-08-01T00:00:00Z" },
      { id: "middle", updated_at: "2025-03-01T00:00:00Z" },
      { id: "never-edited", createdAt: "2023-01-01T00:00:00Z" },
    ];
    expect(by(rows, { field: "updated", direction: "desc" })).toEqual([
      "newest",
      "middle",
      "old",
      "never-edited",
    ]);
  });
});

describe("names sort the way an Arabic-reading admin scans the column", () => {
  it("orders Arabic titles alphabetically rather than by code point", () => {
    const rows = [
      { id: "y", title: "يوشي" },
      { id: "b", title: "بوكيمون" },
      { id: "a", title: "أساسين كريد" },
      { id: "z", title: "زيلدا" },
    ];
    expect(by(rows, { field: "name", direction: "asc" })).toEqual(["a", "b", "z", "y"]);
  });

  it("folds the alef variants together", () => {
    /*
      أ إ آ ا are one letter for ordering, so these three interleave on their
      *second and third* letters — ابـتـكار, إبـراهيم, أحـمد — rather than
      grouping by which hamza form they happen to carry. Code-point order would
      instead put the bare alef (U+0627) after both hamza forms (U+0623,
      U+0625), splitting the ا section of the table in two.
    */
    const rows = [
      { id: "hamza-below", title: "إبراهيم" },
      { id: "bare", title: "ابتكار" },
      { id: "hamza-above", title: "أحمد" },
    ];
    expect(by(rows, { field: "name", direction: "asc" })).toEqual([
      "bare",
      "hamza-below",
      "hamza-above",
    ]);

    // And that really is different from sorting the raw strings.
    const naive = [...rows].sort((a, b) => (a.title < b.title ? -1 : 1)).map((r) => r.id);
    expect(naive).not.toEqual(["bare", "hamza-below", "hamza-above"]);
  });

  it("falls back to the English title when there is no Arabic one", () => {
    const rows = [
      { id: "p", titleEn: "Persona 4 Golden" },
      { id: "e", titleEn: "Elden Ring" },
      { id: "f", titleEn: "Fatal Frame II" },
    ];
    expect(by(rows, { field: "name", direction: "asc" })).toEqual(["e", "f", "p"]);
  });

  it("reverses cleanly", () => {
    const rows = [{ id: "a", title: "ألف" }, { id: "b", title: "باء" }, { id: "t", title: "تاء" }];
    expect(by(rows, { field: "name", direction: "desc" })).toEqual(["t", "b", "a"]);
  });
});

describe("the order is total, so a paginated list is stable", () => {
  it("breaks ties on id rather than leaving them undefined", () => {
    // Without this, two products at the same price can swap between requests —
    // which on page 2 of a paginated table means one product shown twice and
    // another never shown at all.
    const rows = [
      { id: "c", price: 5000 },
      { id: "a", price: 5000 },
      { id: "b", price: 5000 },
    ];
    const once = by(rows, { field: "price", direction: "desc" });
    const again = by([...rows].reverse(), { field: "price", direction: "desc" });
    expect(once).toEqual(again);
    expect(once).toEqual(["a", "b", "c"]);
  });

  it("paginates without dropping or repeating a product", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      id: `p${String(i).padStart(2, "0")}`,
      // Deliberately coarse, so most products tie on the sorted column.
      price: (i % 4) * 1000,
    }));
    const sort: ProductSort = { field: "price", direction: "desc" };
    const all = sortProducts(rows, sort);
    const pages = [all.slice(0, 15), all.slice(15, 30), all.slice(30)];
    const seen = pages.flatMap(ids);
    expect(new Set(seen).size).toBe(40);
    expect(seen).toEqual(ids(sortProducts(rows, sort)));
  });
});

describe("the default order is the one the table already had", () => {
  it("is newest-first by display order", () => {
    expect(DEFAULT_PRODUCT_SORT).toEqual({ field: "order", direction: "desc" });
    const rows = [
      { id: "low", displayOrder: 1 },
      { id: "high", displayOrder: 9 },
      { id: "mid", displayOrder: 5 },
    ];
    expect(by(rows, DEFAULT_PRODUCT_SORT)).toEqual(["high", "mid", "low"]);
  });
});

describe("a sort can be read back from a URL or from stored state", () => {
  it("accepts the known fields and directions", () => {
    expect(parseProductSort("price", "asc")).toEqual({ field: "price", direction: "asc" });
    expect(parseProductSort("name", "desc")).toEqual({ field: "name", direction: "desc" });
    expect(parseProductSort("updated", "asc")).toEqual({ field: "updated", direction: "asc" });
  });

  it("falls back rather than throwing on anything else", () => {
    expect(parseProductSort("supplier_cost", "sideways")).toEqual(DEFAULT_PRODUCT_SORT);
    expect(parseProductSort(null, undefined)).toEqual(DEFAULT_PRODUCT_SORT);
    expect(parseProductSort("price", "nonsense")).toEqual({ field: "price", direction: "desc" });
  });
});

describe("clicking a column header", () => {
  it("reverses the column you are already on", async () => {
    const { toggleProductSort } = await import("./productSort.browser");
    expect(toggleProductSort({ field: "price", direction: "desc" }, "price")).toEqual({
      field: "price",
      direction: "asc",
    });
    expect(toggleProductSort({ field: "price", direction: "asc" }, "price")).toEqual({
      field: "price",
      direction: "desc",
    });
  });

  it("starts a new column in the direction that column is useful in", async () => {
    const { toggleProductSort } = await import("./productSort.browser");
    // Most recently edited and most expensive first; names A→Z.
    expect(toggleProductSort({ field: "name", direction: "asc" }, "updated").direction).toBe("desc");
    expect(toggleProductSort({ field: "name", direction: "asc" }, "price").direction).toBe("desc");
    expect(toggleProductSort({ field: "price", direction: "desc" }, "name").direction).toBe("asc");
  });

  it("survives storage being unavailable", async () => {
    const { readProductSort, writeProductSort } = await import("./productSort.browser");
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("site data blocked");
      },
    });
    try {
      expect(readProductSort()).toEqual(DEFAULT_PRODUCT_SORT);
      expect(() => writeProductSort({ field: "price", direction: "asc" })).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
    }
  });

  it("round-trips a choice and ignores a corrupted one", async () => {
    const { readProductSort, writeProductSort } = await import("./productSort.browser");
    writeProductSort({ field: "name", direction: "asc" });
    expect(readProductSort()).toEqual({ field: "name", direction: "asc" });

    window.localStorage.setItem("bananto_admin_product_sort", "{not json");
    expect(readProductSort()).toEqual(DEFAULT_PRODUCT_SORT);

    window.localStorage.setItem(
      "bananto_admin_product_sort",
      JSON.stringify({ field: "supplier_cost", direction: "sideways" }),
    );
    expect(readProductSort()).toEqual(DEFAULT_PRODUCT_SORT);
  });
});

/**
 * How the order is wired into the endpoint.
 *
 * Source assertions, in the style this repo already uses for things a unit test
 * cannot reach. The admin table itself is not exercised in a logged-in browser
 * here: the local environment has no database schema, so no admin session can
 * exist to render it.
 */
describe("the server orders the catalogue before it paginates", () => {
  const read = async (p: string) => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    return readFileSync(resolve(process.cwd(), p), "utf8");
  };

  it("orders in SQL rather than sorting a slice in JavaScript", async () => {
    const API = await read("src/routes/api/admin/products.ts");
    // The listing is a paginated query now: ordering it in the browser, or in
    // the Worker after slicing, would order fifty arbitrary products.
    expect(API).toContain("readProductIndexPage");
    expect(API).not.toContain("products.slice(offset");
    expect(API).not.toContain("sortProducts(");
  });

  it("keeps the order clause and the comparator on the same key", async () => {
    const INDEX = await read("src/lib/product-index.server.ts");
    // `sort_name` is written from `sortableNameKey`, which is what the
    // browser's comparator folds to as well — one definition, both sides.
    expect(INDEX).toContain("sortableNameKey");
    expect(INDEX).toContain("ORDER BY");
  });

  it("reads the order off the request rather than hard-coding one", async () => {
    const API = await read("src/routes/api/admin/products.ts");
    expect(API).toContain('url.searchParams.get("sort")');
    expect(API).toContain('url.searchParams.get("dir")');
  });

  it("no longer carries its own comparator in the admin table", async () => {
    const UI = await read("src/components/AdminDashboard.tsx");
    // One comparator, shared with the server. Two would drift, and the symptom
    // is a row that is in the right place until you edit it.
    expect(UI).toContain("sortProducts(filteredProducts, sort)");
    expect(UI).not.toContain("(b.displayOrder || 0) - (a.displayOrder || 0)");
  });

  it("sends the stored order, and a page, with the request", async () => {
    const UI = await read("src/components/AdminDashboard.tsx");
    expect(UI).toContain("productSortQuery(sort)");
    // A page, because the endpoint paginates — asking for the catalogue is
    // what made the request time out.
    expect(UI).toContain('params.set("page"');
    expect(UI).toContain('params.set("limit"');
  });

  it("stamps a modification time on the single-product save path", async () => {
    // Sorting by Last Modified is only truthful if every write path records one.
    const PUT = await read("src/routes/api/admin/products.$productId.ts");
    expect(PUT).toContain("updatedAt: savedAtIso");
    expect(PUT).toContain("updated_at: savedAtIso");
  });
});
