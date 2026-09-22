/**
 * The default shelf order is the world's best sellers, not an accident.
 *
 * The owner: «اجعل الالعاب الاكثر مبيعا عالميا تظهر افتراضيا وليس ترتيب
 * عشوائي».
 *
 * It was `newest`, which for a catalogue where 1,530 games were imported in one
 * batch means 1,530 games sharing a timestamp to the minute — an order a
 * customer cannot perceive as anything but random, because in the part that
 * matters it IS arbitrary.
 *
 * These pin two things: that the list ranks what it claims to rank, and that
 * the messy shapes this shop's own titles come in still match it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BEST_SELLER_COUNT,
  UNRANKED,
  bestSellerRank,
  comparableTitle,
  isBestSeller,
} from "./bestSellers";

const category = readFileSync(
  path.resolve(__dirname, "../routes/category.$categoryId.tsx"),
  "utf8",
);

describe("the ranking is the published order", () => {
  it("puts Mario Kart 8 Deluxe first", () => {
    expect(bestSellerRank("Mario Kart 8 Deluxe")).toBe(1);
  });

  it("keeps Nintendo's own order among the biggest sellers", () => {
    const order = [
      "Mario Kart 8 Deluxe",
      "Animal Crossing: New Horizons",
      "Super Smash Bros. Ultimate",
      "The Legend of Zelda: Breath of the Wild",
      "Super Mario Odyssey",
    ].map((t) => bestSellerRank(t));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
  });

  /*
    The deliberate, stated bias. Nintendo publishes no per-title Switch figure
    for anybody else's game, so third-party titles are ordered by judgement —
    and every one of them sits below every first-party title rather than being
    interleaved on the strength of a number that does not exist.
  */
  it("ranks every third-party title below every Nintendo one", () => {
    const nintendo = ["Mario Kart 8 Deluxe", "Fire Emblem Engage", "Astral Chain"];
    const others = ["Minecraft", "Stardew Valley", "EA SPORTS FC 27"];
    const worstNintendo = Math.max(...nintendo.map((t) => bestSellerRank(t)));
    const bestOther = Math.min(...others.map((t) => bestSellerRank(t)));
    expect(bestOther).toBeGreaterThan(worstNintendo);
  });

  it("names a head, not a census", () => {
    expect(BEST_SELLER_COUNT).toBeGreaterThan(90);
    expect(bestSellerRank("Zettai Kaikyuu Gakuen")).toBe(UNRANKED);
    expect(isBestSeller("Fuyuzono Sacrifice")).toBe(false);
  });

  it("answers for an empty or absent title without throwing", () => {
    expect(bestSellerRank("")).toBe(UNRANKED);
    expect(bestSellerRank(null)).toBe(UNRANKED);
    expect(bestSellerRank(undefined)).toBe(UNRANKED);
    expect(bestSellerRank(42)).toBe(UNRANKED);
  });
});

describe("this shop's own titles still match", () => {
  /*
    Real titles, copied from the catalogue. Every one of them carries a
    platform suffix that is not part of the game's name, and a matcher that did
    not strip them would miss all of them.
  */
  it("strips the platform suffixes the catalogue adds", () => {
    expect(comparableTitle("EA SPORTS FC 27 switch 2")).toBe("ea sports fc 27");
    expect(comparableTitle("SpongeBob SquarePants: Titans of the Tide switch 1")).toBe(
      "spongebob squarepants titans of the tide",
    );
    expect(comparableTitle("Xenoblade Chronicles 3 – Nintendo Switch 2 Edition")).toBe(
      "xenoblade chronicles 3",
    );
    expect(comparableTitle("Mario Kart World [Switch 2]")).toBe("mario kart world");
  });

  it("folds the Zelda titles to the name the list uses", () => {
    expect(comparableTitle("The Legend of Zelda: Tears of the Kingdom switch 1")).toBe(
      "zelda tears of the kingdom",
    );
  });

  it("ranks the real catalogue rows, suffixes and all", () => {
    for (const title of [
      "The Legend of Zelda: Tears of the Kingdom — Nintendo Switch 2 Edition",
      "Super Mario Odyssey",
      "Mario Kart World [Switch 2]",
      "Minecraft",
      "Xenoblade Chronicles 3 – Nintendo Switch 2 Edition",
      "EA SPORTS FC 27 switch 2",
      "SpongeBob SquarePants: Titans of the Tide switch 1",
    ]) {
      expect(bestSellerRank(title), title).toBeLessThan(UNRANKED);
    }
  });

  /*
    Longest key first. "Mario Kart 8 Deluxe" and "Mario Kart World" are two
    different games and the shorter key must not swallow the longer one.
  */
  it("does not let a shorter title capture a longer one", () => {
    expect(bestSellerRank("Mario Kart 8 Deluxe")).not.toBe(bestSellerRank("Mario Kart World"));
    expect(bestSellerRank("Super Mario Party")).not.toBe(
      bestSellerRank("Mario Party Superstars"),
    );
  });
});

describe("the shelf opens on it", () => {
  it("defaults to the best sellers", () => {
    expect(category).toContain('useState<SortOption>("best_sellers")');
    expect(category).not.toContain('useState<SortOption>("newest")');
  });

  it("offers it by name, and keeps the older orders", () => {
    expect(category).toContain('<option value="best_sellers">{t("الأكثر مبيعًا عالميًا")}</option>');
    expect(category).toContain('<option value="newest">{t("الأحدث")}</option>');
    expect(category).toContain('<option value="price_asc">');
  });

  it("resets the filters back to it, not to the old default", () => {
    expect(category).toContain('setSortBy("best_sellers");');
    expect(category).not.toContain('setSortBy("newest");');
  });

  /*
    The comparator runs about 29,270 times on this shelf. The key is built once
    per product, as every other sort key on this page already is.
  */
  it("computes the rank once per product, not inside the comparator", () => {
    const at = category.indexOf("filtered.sort((a: any, b: any)");
    expect(category.slice(at)).not.toContain("bestSellerRank(");
    expect(category).toContain("const ranked =");
  });

  it("breaks a tie on freshness, so the unranked tail keeps its old order", () => {
    const at = category.indexOf('case "best_sellers": {');
    expect(at).toBeGreaterThan(-1);
    const arm = category.slice(at, at + 420);
    expect(arm).toContain("if (rankA !== rankB) return rankA - rankB;");
    expect(arm).toContain("if (freshA !== freshB) return freshB - freshA;");
  });

  /*
    A listing with no artwork comes last whatever the member chose. That rule
    predates this one and must survive it.
  */
  it("still puts the games with no picture last", () => {
    expect(category).toContain("return picturedFirst(filtered);");
  });
});
