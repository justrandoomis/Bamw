/**
 * The shelf under the services leads with games people have heard of.
 *
 * «في القسم الذي أسفل الخدمات المتجر في ألعاب نينتندو سويتش في الشريط اجعل
 *  يظهر الألعاب المشهورة وليست الألعاب عشوائية.»
 *
 * It was not random — it was alphabetical, which looks the same from the sofa.
 * `sortNintendoGamesForHome` ranked by square-card-first, then by THIS SHOP's
 * own sales, then by the order the products happened to arrive in. The shop
 * has barely sold any of seventeen hundred catalogue titles, so the middle
 * term was almost always a tie and the shelf fell through to the arrival
 * order: 9 R.I.P., Alan Wake, Alien, ASTRAL CHAIN, Assassin's Creed…
 *
 * ## The ranking already existed
 *
 * `bestSellers.ts` is a curated worldwide-sales order — 57 first-party titles
 * carrying Nintendo's own published unit figures in their comments, from Mario
 * Kart 8 Deluxe at ~67.3M down to Astral Chain at ~1.5M, then 45 third-party
 * titles below them. It was wired to the category page and nowhere else.
 *
 * So nothing here is invented. The shelf is told about a list the repository
 * already maintained, which is also what the owner asked for: fame measured by
 * worldwide sales.
 */
import { describe, expect, it } from "vitest";

import { bestSellerRank, UNRANKED } from "./bestSellers";
import { sortNintendoGamesForHome } from "./nintendoListing";

/** A card with a real square picture, since that term is unchanged and first. */
const game = (title: string, over: Record<string, unknown> = {}) => ({
  id: `p_${title.replace(/\W+/g, "_").toLowerCase()}`,
  title,
  nintendoCardImage: `/api/files/products/x/${title.slice(0, 4)}.webp`,
  price: 7000,
  ...over,
});

const titles = (list: ReturnType<typeof game>[]) =>
  sortNintendoGamesForHome(list as never[]).map((p) => String((p as { title: string }).title));

describe("the famous ones come first", () => {
  it("puts Mario Kart ahead of a game that merely starts with a digit", () => {
    // The owner's own screenshot, in miniature.
    const order = titles([
      game("9 R.I.P."),
      game("Alan Wake Remastered"),
      game("Mario Kart 8 Deluxe"),
      game("ASTRAL CHAIN"),
    ]);
    expect(order[0]).toBe("Mario Kart 8 Deluxe");
  });

  it("orders the famous ones among themselves by worldwide sales", () => {
    /*
      Not alphabetically, and not by the shop's own till. Animal Crossing
      (~47M) outsold Super Mario Odyssey (~29M), which outsold Astral Chain
      (~1.5M), and the shelf should say so.
    */
    const order = titles([
      game("ASTRAL CHAIN"),
      game("Super Mario Odyssey"),
      game("Animal Crossing: New Horizons"),
    ]);
    expect(order).toEqual([
      "Animal Crossing: New Horizons",
      "Super Mario Odyssey",
      "ASTRAL CHAIN",
    ]);
  });

  it("puts every ranked game ahead of every unranked one", () => {
    const order = titles([
      game("Some Obscure Visual Novel"),
      game("Another Unknown Game"),
      game("ASTRAL CHAIN"),
    ]);
    // Astral Chain is last on the best-seller list and still beats the unranked.
    expect(order[0]).toBe("ASTRAL CHAIN");
  });

  it("still keeps a game with no picture off the front", () => {
    /*
      Unchanged and deliberately still the FIRST term: a shelf that leads with
      «لم يتم إضافة الصورة بعد» looks broken however famous the game is.
    */
    const order = titles([
      game("Mario Kart 8 Deluxe", { nintendoCardImage: "" }),
      game("Some Obscure Visual Novel"),
    ]);
    expect(order[0]).toBe("Some Obscure Visual Novel");
  });

  it("is stable for two games nobody has heard of", () => {
    // Equal rank falls through to arrival order, as before — no reshuffling.
    const order = titles([game("Unknown Alpha"), game("Unknown Beta")]);
    expect(order).toEqual(["Unknown Alpha", "Unknown Beta"]);
  });

  it("matches a title through the shop's own platform suffixes", () => {
    /*
      The shop writes «[Switch 2]» and «Nintendo Switch 2 Edition» into titles.
      `comparableTitle` strips them, and the shelf has to benefit from that or
      the flagship re-releases would sink to the bottom.
    */
    expect(bestSellerRank("Mario Kart 8 Deluxe [Switch 2]")).toBeLessThan(UNRANKED);
    const order = titles([game("Some Obscure Visual Novel"), game("Mario Kart 8 Deluxe [Switch 2]")]);
    expect(order[0]).toBe("Mario Kart 8 Deluxe [Switch 2]");
  });
});
