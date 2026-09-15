import { describe, expect, it } from "vitest";

import { searchCatalogue } from "./products";

/**
 * The complaint, as the owner put it: the box is stupid.
 *
 * «عندما يكتب المستخدم حرف من اللعبة أو اسم اللعبة بغير اللغة أو اسم اللعبة
 * خاطئا لا يظهر البحث» — one letter, the wrong alphabet, or a misspelling, and
 * nothing comes back; you have to type the whole name exactly.
 *
 * Each of those was a separate fence in the scoring, and this file is one test
 * per fence. The fixture is deliberately built the way the shop now is: a
 * handful of written-up games that carry an Arabic title, and the supplier
 * catalogue, which carries an English name and **nothing else** — no Arabic
 * name to fall back on, which is why an Arabic query has to reach them by
 * transliteration or not at all.
 */

const WRITTEN_UP = [
  {
    id: "p1",
    titleEn: "The Legend of Zelda: Tears of the Kingdom",
    titleAr: "أسطورة زيلدا: دموع المملكة",
    price: 14750,
    isActive: true,
    sales: 40,
  },
  {
    id: "p2",
    titleEn: "Mario Kart 8 Deluxe",
    titleAr: "ماريو كارت 8 ديلوكس",
    price: 12000,
    isActive: true,
    sales: 90,
  },
];

/** Straight out of the owner's spreadsheet: a name, a price, nothing else. */
const CATALOGUE = [
  { id: "c1", titleEn: "Kirby and the Forgotten Land", price: 9000, isActive: true },
  { id: "c2", titleEn: "Fire Emblem: Three Houses", price: 8000, isActive: true },
  { id: "c3", titleEn: "Metroid Dread", price: 10250, isActive: true },
  { id: "c4", titleEn: "Splatoon 3", price: 11000, isActive: true },
  { id: "c5", titleEn: "Super Mario Odyssey", price: 9000, isActive: true },
  { id: "c6", titleEn: "Pokemon Scarlet", price: 14750, isActive: true },
  { id: "c7", titleEn: "Xenoblade Chronicles 3", price: 10250, isActive: true },
  { id: "c8", titleEn: "Bayonetta 3", price: 9000, isActive: true },
];

const ALL = [...WRITTEN_UP, ...CATALOGUE] as unknown as Record<string, unknown>[];

const ids = (query: string, limit = 8) =>
  searchCatalogue(ALL, query, { limit }).map((hit) => String(hit.product["id"]));

describe("one letter is enough to start", () => {
  it("answers a single letter instead of an empty list", () => {
    // Was: empty. `relevance.ts` fenced the prefix rung at three characters and
    // the typo budget at four, so one letter could not reach any rung at all.
    expect(ids("z").length).toBeGreaterThan(0);
    expect(ids("k").length).toBeGreaterThan(0);
    expect(ids("ب").length).toBeGreaterThan(0);
  });

  it("puts the game whose name starts with the letter first", () => {
    // The point of answering at all. Without the prefix bonus every product
    // containing a word starting with «k» scored identically and the six shown
    // were arbitrary.
    expect(ids("k")[0]).toBe("c1"); // Kirby…, not «Mario Kart» or «Xenoblade Chronicles»
    // Not «Metroid Dread»: «Mario Kart 8 Deluxe» starts with «m» too, and
    // between two equally good prefix matches the one people actually buy
    // wins. That tie-break is `sales`, and it is the right one — a one-letter
    // query is a request for the likeliest game, not an alphabetical list.
    expect(ids("m")[0]).toBe("p2");
    expect(ids("m")).toContain("c3");
  });

  it("answers two letters, and narrows as the third is typed", () => {
    expect(ids("sp")).toContain("c4");
    expect(ids("spl")[0]).toBe("c4");
  });
});

describe("the name in the other alphabet", () => {
  /*
    These are the queries that matter most after the import. A customer types
    Arabic; fifteen hundred of the shop's games have an English name and no
    Arabic one, so there is no stored translation to match — only the sound.
  */
  it("finds an English-only listing from its Arabic spelling", () => {
    expect(ids("كيربي")).toContain("c1");
    expect(ids("ميترويد")).toContain("c3");
    expect(ids("سبلاتون")).toContain("c4");
    expect(ids("بوكيمون")).toContain("c6");
  });

  it("finds it when Arabic drops the short vowels English writes", () => {
    // «سوبر» romanises to «sobr» and «super» to «suber» — two edits apart, more
    // than any budget safe enough to use. Their consonants are both «sbr».
    expect(ids("سوبر")).toContain("c5");
  });

  it("still finds a game that does carry an Arabic title", () => {
    // The stored translation must keep winning where it exists.
    expect(ids("زيلدا")[0]).toBe("p1");
  });

  it("works in the other direction too", () => {
    // Latin letters against an Arabic-titled product.
    expect(ids("zelda")).toContain("p1");
  });
});

describe("a name spelled wrong", () => {
  it("forgives a substitution, an insertion and a deletion", () => {
    expect(ids("zolda")).toContain("p1");
    expect(ids("metrold")).toContain("c3");
    expect(ids("splaton")).toContain("c4");
    expect(ids("bayoneta")).toContain("c8");
  });

  it("forgives a slip in a short word without dropping the whole query", () => {
    /*
      The regression this test exists for. Every typed word has to match
      something or the product is removed — so one slip in «كرت» did not rank
      Mario Kart lower, it deleted it, and the relaxed fallback then answered
      with every Mario game in the shop. Three-letter words had a typo budget
      of zero.
    */
    expect(ids("mario krt")[0]).toBe("p2");
  });
});

describe("what it must still refuse", () => {
  it("answers a word no product has with nothing", () => {
    // The property the whole scoring policy exists to protect: a shop that
    // answers «غسالة» with Mario Kart is broken, and loosening the short-token
    // rungs must not have loosened this.
    expect(ids("غسالة")).toEqual([]);
    expect(ids("refrigerator")).toEqual([]);
  });

  it("does not let one letter outrank a full name", () => {
    const full = searchCatalogue(ALL, "metroid dread", { limit: 3 });
    expect(String(full[0]?.product["id"])).toBe("c3");
    expect(full[0]!.score).toBeGreaterThan(searchCatalogue(ALL, "m", { limit: 1 })[0]!.score);
  });

  it("keeps a two-word query meaning both words", () => {
    // «mario kart» must not become "every Mario game".
    expect(ids("mario kart")[0]).toBe("p2");
    expect(ids("mario kart")).not.toContain("c5");
  });
});
