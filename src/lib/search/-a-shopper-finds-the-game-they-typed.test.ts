/**
 * What a customer types, and whether the shop finds it.
 *
 * Every query in here is one somebody would actually type into an Arabic
 * storefront, and the first block records what the search the shop shipped
 * with did with them: `title`, `titleEn` and `description` tested with
 * `String.includes`. Production says all 150 products have `title` and
 * `titleEn` set to the same English string and the Arabic name lives in
 * `titleAr`, which never left the server — so the Arabic half of this file is
 * a list of things a customer could not find in a shop that is entirely in
 * Arabic.
 *
 * The catalogue below is a fixture. The titles are real Nintendo games because
 * a search test on invented names proves nothing about typos or word order,
 * but the prices, sales and ordering are invented and are not a claim about
 * anything in the store.
 */

import { describe, expect, it } from "vitest";

import { buildProductIndex, searchCatalogue, searchProducts } from "./products";

const CATALOGUE: Record<string, unknown>[] = [
  {
    id: "p1",
    title: "The Legend of Zelda: Tears of the Kingdom",
    titleEn: "The Legend of Zelda: Tears of the Kingdom",
    titleAr: "أسطورة زيلدا: دموع المملكة",
    slug: "the-legend-of-zelda-tears-of-the-kingdom",
    seriesName: "The Legend of Zelda",
    developer: "Nintendo EPD",
    publisher: "Nintendo",
    platform: "switch1",
    categoryTitle: "ألعاب نينتندو سويتش",
    genres: ["action", "adventure"],
    sales: 40,
    displayOrder: 2,
  },
  {
    id: "p2",
    title: "The Legend of Zelda: Breath of the Wild",
    titleEn: "The Legend of Zelda: Breath of the Wild",
    titleAr: "أسطورة زيلدا: أنفاس البرية",
    slug: "the-legend-of-zelda-breath-of-the-wild",
    seriesName: "The Legend of Zelda",
    developer: "Nintendo EPD",
    publisher: "Nintendo",
    platform: "switch1",
    categoryTitle: "ألعاب نينتندو سويتش",
    genres: ["action", "adventure"],
    sales: 25,
    displayOrder: 3,
  },
  {
    id: "p3",
    title: "Mario Kart 8 Deluxe",
    titleEn: "Mario Kart 8 Deluxe",
    titleAr: "ماريو كارت ٨ ديلوكس",
    slug: "mario-kart-8-deluxe",
    seriesName: "Mario Kart",
    developer: "Nintendo EPD",
    publisher: "Nintendo",
    platform: "switch1",
    categoryTitle: "ألعاب نينتندو سويتش",
    genres: ["racing"],
    sales: 90,
    displayOrder: 1,
  },
  {
    id: "p4",
    title: "Mario Kart World",
    titleEn: "Mario Kart World",
    titleAr: "ماريو كارت وورلد",
    slug: "mario-kart-world",
    seriesName: "Mario Kart",
    publisher: "Nintendo",
    platform: "switch2",
    categoryTitle: "ألعاب نينتندو سويتش",
    genres: ["racing"],
    sales: 12,
    displayOrder: 4,
  },
  {
    id: "p5",
    title: "Super Mario Odyssey",
    titleEn: "Super Mario Odyssey",
    titleAr: "سوبر ماريو أوديسي",
    slug: "super-mario-odyssey",
    seriesName: "Super Mario",
    publisher: "Nintendo",
    platform: "switch1",
    categoryTitle: "ألعاب نينتندو سويتش",
    genres: ["platformer"],
    sales: 30,
    displayOrder: 5,
  },
  {
    id: "p6",
    title: "Super Smash Bros. Ultimate",
    titleEn: "Super Smash Bros. Ultimate",
    titleAr: "سوبر سماش بروس ألتيميت",
    slug: "super-smash-bros-ultimate",
    seriesName: "Super Smash Bros.",
    publisher: "Nintendo",
    platform: "switch1",
    categoryTitle: "ألعاب نينتندو سويتش",
    genres: ["fighting"],
    sales: 20,
    displayOrder: 6,
  },
  {
    id: "p7",
    title: "Nintendo eShop Gift Card 50 USD",
    titleEn: "Nintendo eShop Gift Card 50 USD",
    titleAr: "بطاقة شحن نينتندو إي شوب ٥٠ دولار",
    slug: "nintendo-eshop-gift-card-50",
    kind: "gift_card",
    categoryTitle: "بطاقات الشحن",
    brand: "Nintendo",
    sales: 5,
    displayOrder: 7,
  },
  {
    id: "p8",
    title: "Nintendo Switch 2 Console",
    titleEn: "Nintendo Switch 2 Console",
    titleAr: "جهاز نينتندو سويتش ٢",
    slug: "nintendo-switch-2-console",
    kind: "hardware",
    categoryTitle: "الأجهزة",
    brand: "Nintendo",
    platform: "switch2",
    sales: 8,
    displayOrder: 8,
  },
];

const ids = (query: string, options?: Parameters<typeof searchCatalogue>[2]) =>
  searchCatalogue(CATALOGUE, query, options).map((row) => String(row.product["id"]));

/** The substring filter the header shipped with, kept exactly as it was. */
const shippedSearch = (query: string) => {
  const q = query.toLowerCase();
  return CATALOGUE.filter((p) => {
    const title = String(p["title"] ?? "").toLowerCase();
    const titleEn = String(p["titleEn"] ?? "").toLowerCase();
    const desc = String(p["description"] ?? "").toLowerCase();
    return title.includes(q) || titleEn.includes(q) || desc.includes(q);
  }).map((p) => String(p["id"]));
};

describe("what the shipped search could not find", () => {
  it.each([
    ["زيلدا"],
    ["ماريو"],
    ["ماريو كارت"],
    ["سوبر ماريو"],
    ["بطاقة شحن"],
    ["جهاز نينتندو سويتش ٢"],
  ])("finds nothing for %s", (query) => {
    expect(shippedSearch(query)).toEqual([]);
  });

  it("also misses an English query with a stray double space", () => {
    expect(shippedSearch("mario  kart")).toEqual([]);
  });

  it("and one typed in the wrong order", () => {
    expect(shippedSearch("kart mario")).toEqual([]);
  });
});

describe("the Arabic name is searchable", () => {
  it("«زيلدا» returns both Zelda games and nothing else", () => {
    expect(ids("زيلدا").sort()).toEqual(["p1", "p2"]);
  });

  it("«ماريو كارت» puts the Mario Karts first and leaves Zelda out", () => {
    const found = ids("ماريو كارت");
    expect(found.slice(0, 2).sort()).toEqual(["p3", "p4"]);
    expect(found).not.toContain("p1");
    expect(found).not.toContain("p2");
  });

  it("«سوبر ماريو» does not sweep in every Mario", () => {
    const found = ids("سوبر ماريو");
    expect(found[0]).toBe("p5");
    expect(found).not.toContain("p3");
  });

  it("reads Arabic-Indic digits as digits", () => {
    expect(ids("سويتش ٢")).toContain("p8");
  });

  it("survives tashkeel and a hamza the customer did not type", () => {
    expect(ids("اسطوره زيلدا").sort()).toEqual(["p1", "p2"]);
    expect(ids("أُسْطُورَة زيلدا").sort()).toEqual(["p1", "p2"]);
  });

  it("«بطاقة شحن» reaches the gift card", () => {
    expect(ids("بطاقة شحن")[0]).toBe("p7");
  });

  it("«جهاز» reaches the console", () => {
    expect(ids("جهاز")).toContain("p8");
  });
});

describe("every word the customer typed has to land", () => {
  it("«mario kart» is not every Mario game", () => {
    const found = ids("mario kart");
    expect(found.sort()).toEqual(["p3", "p4"]);
  });

  it("word order does not matter", () => {
    expect(ids("kart mario").sort()).toEqual(["p3", "p4"]);
  });

  it("a stray double space does not matter", () => {
    expect(ids("mario  kart").sort()).toEqual(["p3", "p4"]);
  });

  it("a word nothing in the shop has returns nothing", () => {
    expect(ids("غسالة")).toEqual([]);
    expect(ids("مكيف هواء")).toEqual([]);
  });
});

describe("typing, and mistyping", () => {
  it("a prefix finds the game before the word is finished", () => {
    expect(ids("ماري").length).toBeGreaterThan(0);
    expect(ids("zeld").sort()).toEqual(["p1", "p2"]);
  });

  it("forgives a transposition", () => {
    expect(ids("mairo kart").sort()).toEqual(["p3", "p4"]);
  });

  it("forgives a wrong letter", () => {
    expect(ids("zolda").sort()).toEqual(["p1", "p2"]);
  });

  it("does not forgive a three-letter word into a different one", () => {
    // "mkw" is not "mk8": a 3-character token gets no typo budget at all.
    expect(ids("mkw")).toEqual([]);
  });
});

describe("the abbreviations people actually type", () => {
  it("botw finds Breath of the Wild", () => {
    expect(ids("botw")[0]).toBe("p2");
  });

  it("totk finds Tears of the Kingdom", () => {
    expect(ids("totk")[0]).toBe("p1");
  });

  it("smash finds Super Smash Bros.", () => {
    expect(ids("smash")[0]).toBe("p6");
  });
});

describe("ranking", () => {
  it("breaks a tie by what sells, then by the shelf order", () => {
    const found = ids("mario kart");
    // p3 outsells p4 nine to one; both match the query identically well.
    expect(found[0]).toBe("p3");
  });

  it("prefers the game whose name starts with what was typed", () => {
    expect(ids("super smash")[0]).toBe("p6");
  });

  it("honours a limit", () => {
    expect(ids("nintendo", { limit: 2 }).length).toBeLessThanOrEqual(2);
  });
});

describe("when nothing matches every word", () => {
  it("falls back to the best partial match rather than an empty page", () => {
    const found = ids("zelda soundtrack");
    expect(found.sort()).toEqual(["p1", "p2"]);
  });

  it("but still refuses a query with nothing to hold on to", () => {
    expect(ids("غسالة كهربائية")).toEqual([]);
  });

  it("can be switched off", () => {
    expect(ids("zelda soundtrack", { relaxedThreshold: 1.01 })).toEqual([]);
  });
});

describe("the plumbing", () => {
  it("an empty query is not a search", () => {
    expect(ids("")).toEqual([]);
    expect(ids("   ")).toEqual([]);
    expect(ids("!!!")).toEqual([]);
  });

  it("an index can be built once and reused", () => {
    const index = buildProductIndex(CATALOGUE);
    expect(searchProducts(index, "زيلدا").length).toBe(2);
    expect(searchProducts(index, "mario kart").length).toBe(2);
  });

  it("survives a product with nothing but an id", () => {
    expect(() => searchCatalogue([{ id: "empty" }], "zelda")).not.toThrow();
    expect(searchCatalogue([{ id: "empty" }], "zelda")).toEqual([]);
  });

  it("returns the product object it was given, not a copy", () => {
    const [first] = searchCatalogue(CATALOGUE, "totk");
    expect(first?.product).toBe(CATALOGUE[0]);
  });

  it("reports which typed words landed", () => {
    const [first] = searchCatalogue(CATALOGUE, "mario kart");
    expect(first?.matched.sort()).toEqual(["kart", "mario"]);
  });
});

describe("a word the catalogue spells differently", () => {
  /*
    The catalogue's own words, with nothing Arabic in the sections. This is the
    case that breaks a search which scores «سويتش» and «switch» as two separate
    words the customer asked for: the product can only ever have one of them,
    so requiring both finds nothing and averaging the two halves the score.
  */
  const ENGLISH_ONLY = [
    {
      id: "h1",
      titleEn: "Nintendo Switch 2 Console",
      categoryTitle: "Hardware",
      kind: "hardware",
      brand: "Nintendo",
      sales: 4,
    },
    {
      id: "c1",
      titleEn: "Nintendo eShop Gift Card 50 USD",
      categoryTitle: "Gift Cards",
      kind: "gift_card",
      brand: "Nintendo",
      sales: 2,
    },
  ];
  const find = (query: string) =>
    searchCatalogue(ENGLISH_ONLY, query).map((row) => String(row.product["id"]));

  it("«سويتش» reaches a console named only in English", () => {
    expect(find("سويتش")).toContain("h1");
  });

  it("«كارت» reaches a card named only in English", () => {
    expect(find("كارت")).toContain("c1");
  });

  it("«جهاز» reaches the hardware shelf", () => {
    expect(find("جهاز")).toContain("h1");
  });

  it("still refuses a word that means nothing here", () => {
    expect(find("غسالة")).toEqual([]);
  });

  it("scores the catalogue's own spelling above the synonym that reached it", () => {
    const viaSynonym = searchCatalogue(ENGLISH_ONLY, "سويتش")[0]?.score ?? 0;
    const viaTheWordItself = searchCatalogue(ENGLISH_ONLY, "switch")[0]?.score ?? 0;
    expect(viaTheWordItself).toBeGreaterThan(viaSynonym);
  });
});

describe("a multi-word abbreviation is a phrase, not a bag of words", () => {
  it("«botw» does not answer with the other Zelda for having «of» and «the»", () => {
    expect(ids("botw")).toEqual(["p2"]);
  });

  it("«totk» likewise", () => {
    expect(ids("totk")).toEqual(["p1"]);
  });
});

describe("the words the shared table knows", () => {
  /*
    `tokenizeQuery` expands from the shop's table AND the shared one. When the
    scorer read only the shop's, every word the shared table covers produced
    tokens nothing then counted: the typed word matched no product, its
    synonyms were not treated as standing in for it, and the query came back
    empty. A synonym the tokenizer invents and the scorer ignores is worse than
    no synonym at all.
  */
  const ACCESSORIES = [
    { id: "a1", titleEn: "Joy-Con (L)/(R) Pair", categoryTitle: "Accessories", kind: "accessory" },
    { id: "a2", titleEn: "Nintendo Switch Dock Set", categoryTitle: "Accessories", kind: "accessory" },
  ];
  const find = (query: string) =>
    searchCatalogue(ACCESSORIES, query).map((row) => String(row.product["id"]));

  it("«جويكون» reaches the Joy-Con", () => {
    expect(find("جويكون")).toContain("a1");
  });

  it("«دوك» reaches the dock", () => {
    expect(find("دوك")).toContain("a2");
  });

  it("and a word neither table knows still returns nothing", () => {
    expect(find("غسالة")).toEqual([]);
  });
});
