/**
 * Six of the shop's biggest games were ranked as if nobody had heard of them.
 *
 * The owner, reporting the symptom two months before anyone found the cause:
 *
 *   «هنالك ألعاب قوية وسعرها غالي وفي نفس الوقت مشهورة جدا لكن سعرها خمسة
 *    آلاف بدل ٨ و ٧.»
 *
 * `comparableTitle` folds a title with the SEARCH normalizer, and that function
 * turns everything which is not a letter or a digit into a space — correct for
 * a query box, wrong inside a word. «Luigi's Mansion 3» became «luigi s mansion
 * 3», which does not contain the list's key «luigis mansion 3». So the key
 * never matched, on any of the three screens that ask.
 *
 * It is worth being exact about what that cost, because none of it announced
 * itself: the home shelf put a 14.7-million-copy game behind unknown indies,
 * the roulette weighted it as a nobody, and — once the price ladder started
 * reading fame — it was priced at the bottom rung, 5,000.
 *
 * A test per dead key, because a list is only as good as the matching, and the
 * matching had been wrong since the list was written.
 */
import { describe, expect, it } from "vitest";

import { bestSellerRank, comparableTitle, UNRANKED } from "./bestSellers";
import { cheapRungFor, fameBandFor } from "./repricing";

/** The six keys whose real title carries an elided apostrophe. */
const ELIDED: readonly [string, string][] = [
  ["Luigi's Mansion 3", "luigis mansion 3"],
  ["Pokémon: Let's Go, Pikachu!", "pokemon lets go pikachu"],
  ["Pokémon: Let's Go, Eevee!", "pokemon lets go eevee"],
  ["Super Mario 3D World + Bowser's Fury", "super mario 3d world bowsers fury"],
  ["The Legend of Zelda: Link's Awakening", "zelda links awakening"],
  ["Yoshi's Crafted World", "yoshis crafted world"],
];

describe("a title with an apostrophe reaches its own row on the list", () => {
  it.each(ELIDED)("%s", (title) => {
    expect(bestSellerRank(title)).not.toBe(UNRANKED);
  });

  /* The catalogue holds both spellings; a fix for one of them is half a fix. */
  it.each(ELIDED)("%s, typed with a curly apostrophe", (title) => {
    expect(bestSellerRank(title.replace(/'/g, "’"))).not.toBe(UNRANKED);
  });

  it("folds the apostrophe away rather than into a word break", () => {
    expect(comparableTitle("Luigi's Mansion 3")).toBe("luigis mansion 3");
    expect(comparableTitle("Luigi’s Mansion 3")).toBe("luigis mansion 3");
  });

  /*
    The one way this fix could do harm: joining two words that were separate.
    An apostrophe is removed; a space, a colon and a plus sign are not.
  */
  it("still separates words that a punctuation mark separated", () => {
    expect(comparableTitle("Super Mario 3D World + Bowser's Fury")).toBe(
      "super mario 3d world bowsers fury",
    );
    expect(comparableTitle("Mario vs. Donkey Kong")).toBe("mario vs donkey kong");
  });

  it("invents no rank for a game that is genuinely not on the list", () => {
    expect(bestSellerRank("Laundry Store Simulator")).toBe(UNRANKED);
    expect(bestSellerRank("Kiniro no Hidamari to Kimi no Tonari")).toBe(UNRANKED);
  });

  /*
    THE PRICE, which is what the owner was actually looking at. Luigi's Mansion
    3 is the fourth best-selling exclusive in this shop's catalogue and it was
    sitting on the «غير مشهورة» rung.
  */
  it("prices the fourteen-million-copy game off the bottom rung", () => {
    const band = fameBandFor("Luigi's Mansion 3");
    expect(band).toBe("famous");
    expect(cheapRungFor(band, false)).toBe(7_000);
  });
});

describe("a family the owner priced by name is not «غير مشهورة»", () => {
  /*
    «دونكي كونك ب٨ الف». `NAMED_PRICES` anchors only Bananza, on the stated
    reasoning that the two Switch 1 titles «settle at 7,000 — which is his own
    figure for a Switch 1 game». The fame ladder broke that promise: neither is
    on `bestSellers.ts`, so both fell to 5,000 — a game he named at 8,000,
    priced at the bottom. This is what holds the promise.
  */
  it.each(["Donkey Kong Country Returns HD", "Mario vs. Donkey Kong"])(
    "%s lands on his Switch 1 figure, not the bottom rung",
    (title) => {
      const band = fameBandFor(title);
      expect(band).not.toBe("obscure");
      expect(cheapRungFor(band, false)).toBe(7_000);
    },
  );

  /*
    A promotion, never a demotion. If a Donkey Kong game ever reaches the top of
    the sales list, appearing in that family list must not pull it back down.
  */
  it("cannot pull a game the world's sales already call famous down to «معروفة»", () => {
    expect(fameBandFor("Mario Kart 8 Deluxe")).toBe("famous");
    expect(fameBandFor("Luigi's Mansion 3")).toBe("famous");
  });

  it("promotes nobody it was not asked to promote", () => {
    expect(fameBandFor("Laundry Store Simulator")).toBe("obscure");
    expect(fameBandFor("Super Mining Mechs")).toBe("obscure");
  });
});
