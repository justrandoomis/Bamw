import { describe, expect, it } from "vitest";

import { buildListing, CATALOGUE_SOURCE, type CatalogueRow } from "./catalogueImport";

/**
 * The owner's second sheet brings artwork and provenance for games already on
 * sale, and asked for exactly one thing: update the name and the picture and
 * anything else that differs, but leave the product itself alone — «نفسه من
 * حيث التكلفه والبيع والخ».
 *
 * `refresh-content` is that mode, and this is the file that stops it becoming
 * something else. The commercial fields are not checked one at a time against
 * a list somebody remembered to update; the whole stored product is compared
 * with the result, and any change outside the small set of content fields
 * fails — so a field added to the shop next year is protected by this test the
 * day it is added, without anyone editing it.
 */

/** Everything `refresh-content` is allowed to touch. Nothing else may move. */
const MAY_CHANGE = new Set([
  "title",
  "titleEn",
  "coverImage",
  "officialStoreUrl",
  "nsuid",
  "publisher",
  "languages",
  "canonicalTitle",
  "updatedAt",
]);

function row(over: Partial<CatalogueRow> = {}): CatalogueRow {
  return {
    line: 2,
    slug: "mario-kart-world",
    englishName: "Mario Kart World",
    costIqd: 4000,
    chineseName: "马力欧卡丁车世界",
    platform: "switch2",
    offlinePriceIqd: 19000,
    englishSupport: true,
    coverUrl: "https://www.nintendo.com/eu/media/images/x/SQ_NSwitch_MarioKartWorld.jpg",
    storeLink: "https://www.nintendo.com/en-gb/Games/x",
    nsuid: "70010000099999",
    publisher: "Nintendo",
    languages: "english, japanese",
    matchedTitle: "Mario Kart World",
    ...over,
  };
}

/** A product as the shop actually holds one, with every commercial field set. */
function stored(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "prd_cat_mario-kart-world",
    slug: "mario-kart-world",
    title: "Mario Kart World (اسم صححه الأدمن)",
    titleEn: "Mario Kart World",
    catalogueSource: CATALOGUE_SOURCE,
    /* Money and shelf — none of this may move. */
    price: 21000,
    cost: 4500,
    accountPrice: 21000,
    stock: 12,
    accountStock: 12,
    isInfiniteStock: false,
    tradeInValueIqd: 6000,
    /* Visibility. */
    isHidden: true,
    isActive: false,
    status: "draft",
    /* Shape the admin chose. */
    options: [{ id: "offline_account", name: "حساب أوفلاين", stock: 3 }],
    types: [{ id: "primary", name: "أساسي" }],
    sortOrder: 42,
    salesCount: 17,
    ...over,
  };
}

const build = (mode: Parameters<typeof buildListing>[1]["mode"], r = row(), p = stored()) =>
  buildListing(r, {
    mode,
    existing: p,
    categoryId: "nintendo-switch-games",
    categoryTitle: "ألعاب نينتندو سويتش",
  });

describe("refresh-content, on a product already in the shop", () => {
  it("changes nothing outside the content fields", () => {
    const before = stored();
    const out = build("refresh-content", row(), before);
    expect(out.action).toBe("update");
    if (out.action !== "update") return;

    const moved = Object.keys({ ...before, ...out.product }).filter(
      (key) => JSON.stringify(before[key]) !== JSON.stringify(out.product[key]),
    );
    expect(moved.filter((key) => !MAY_CHANGE.has(key))).toEqual([]);
  });

  /*
    Named individually as well, because the set comparison above would also
    pass if the mode simply did nothing. These say it does the work.
  */
  it("brings the picture across, which is what makes a bare listing not bare", () => {
    const out = build("refresh-content");
    if (out.action !== "update") throw new Error("expected an update");
    expect(out.product["coverImage"]).toBe(row().coverUrl);
  });

  it("brings the name and the provenance across", () => {
    const out = build("refresh-content");
    if (out.action !== "update") throw new Error("expected an update");
    expect(out.product["title"]).toBe("Mario Kart World");
    expect(out.product["publisher"]).toBe("Nintendo");
    expect(out.product["nsuid"]).toBe("70010000099999");
  });

  it("leaves the price, the cost and the stock exactly as the shop had them", () => {
    const out = build("refresh-content");
    if (out.action !== "update") throw new Error("expected an update");
    expect(out.product["price"]).toBe(21000);
    expect(out.product["cost"]).toBe(4500);
    expect(out.product["accountPrice"]).toBe(21000);
    expect(out.product["stock"]).toBe(12);
    expect(out.product["tradeInValueIqd"]).toBe(6000);
  });

  it("leaves a hidden product hidden", () => {
    const out = build("refresh-content");
    if (out.action !== "update") throw new Error("expected an update");
    expect(out.product["isHidden"]).toBe(true);
    expect(out.product["isActive"]).toBe(false);
    expect(out.product["status"]).toBe("draft");
  });

  it("leaves the options and types the admin chose", () => {
    const out = build("refresh-content");
    if (out.action !== "update") throw new Error("expected an update");
    expect(out.product["options"]).toEqual([
      { id: "offline_account", name: "حساب أوفلاين", stock: 3 },
    ]);
    expect(out.product["types"]).toEqual([{ id: "primary", name: "أساسي" }]);
  });
});

describe("silence in the sheet never overwrites the shop", () => {
  /*
    The case this exists for: a cover somebody uploaded by hand, against a row
    whose Cover URL cell is empty. 923 of the 1,530 rows have no cover, so this
    is the common case, not the edge one.
  */
  it("does not blank a cover the sheet has nothing to say about", () => {
    const before = stored({ coverImage: "https://cdn.banan.to/uploaded-by-hand.webp" });
    const out = build("refresh-content", row({ coverUrl: "" }), before);
    if (out.action !== "update") throw new Error("expected an update");
    expect(out.product["coverImage"]).toBe("https://cdn.banan.to/uploaded-by-hand.webp");
  });

  it("does not blank the publisher, languages or store link either", () => {
    const before = stored({
      publisher: "Kept",
      languages: "kept",
      officialStoreUrl: "https://kept",
    });
    const out = build(
      "refresh-content",
      row({ publisher: "", languages: "", storeLink: "", nsuid: "" }),
      before,
    );
    if (out.action !== "update") throw new Error("expected an update");
    expect(out.product["publisher"]).toBe("Kept");
    expect(out.product["languages"]).toBe("kept");
    expect(out.product["officialStoreUrl"]).toBe("https://kept");
  });

  it("skips a row that adds nothing at all rather than writing a timestamp", () => {
    const out = build(
      "refresh-content",
      row({
        englishName: "",
        coverUrl: "",
        storeLink: "",
        nsuid: "",
        publisher: "",
        languages: "",
        matchedTitle: "",
      }),
    );
    expect(out.action).toBe("skip");
  });
});

describe("what refresh-content still refuses", () => {
  /*
    The rule the price refresh already had, and the reason for it: a product
    somebody built by hand is never touched by a spreadsheet, whatever its
    name. A content refresh is no different.
  */
  it("will not touch a product this importer did not create", () => {
    const byHand = stored({ catalogueSource: undefined });
    const out = build("refresh-content", row(), byHand);
    expect(out.action).toBe("skip");
    if (out.action !== "skip") return;
    expect(out.reason).toContain("يدوياً");
  });
});

describe("the other two modes are unchanged by this", () => {
  it("create-only still skips an existing product entirely", () => {
    expect(build("create-only").action).toBe("skip");
  });

  it("refresh-prices still moves the price and cost, and nothing else", () => {
    const before = stored();
    const out = build("refresh-prices", row(), before);
    if (out.action !== "update") throw new Error("expected an update");
    expect(out.product["price"]).toBe(19000);
    expect(out.product["cost"]).toBe(4000);
    /* And still does not carry visibility or stock along with the price. */
    expect(out.product["isHidden"]).toBe(true);
    expect(out.product["stock"]).toBe(12);
  });

  /*
    A price refresh must not start moving artwork now that the row carries it —
    the two modes are separate decisions and the owner ticks one of them.
  */
  it("refresh-prices does not bring the cover across", () => {
    const before = stored({ coverImage: "https://cdn.banan.to/old.webp" });
    const out = build("refresh-prices", row(), before);
    if (out.action !== "update") throw new Error("expected an update");
    expect(out.product["coverImage"]).toBe("https://cdn.banan.to/old.webp");
  });
});

describe("a new product created from a row that carries artwork", () => {
  it("arrives with its cover rather than bare", () => {
    const out = buildListing(row(), {
      mode: "create-only",
      existing: undefined,
      categoryId: "nintendo-switch-games",
      categoryTitle: "ألعاب نينتندو سويتش",
    });
    if (out.action !== "create") throw new Error("expected a create");
    expect(out.product["coverImage"]).toBe(row().coverUrl);
    expect(out.product["publisher"]).toBe("Nintendo");
  });

  it("carries no cover key at all when the sheet has none", () => {
    const out = buildListing(row({ coverUrl: "" }), {
      mode: "create-only",
      existing: undefined,
      categoryId: "nintendo-switch-games",
      categoryTitle: "ألعاب نينتندو سويتش",
    });
    if (out.action !== "create") throw new Error("expected a create");
    expect("coverImage" in out.product).toBe(false);
  });
});
