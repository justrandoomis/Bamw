/**
 * «دعم أوسع عند الكتابة بأي لغة ... لأن الألعاب الباقية لا تدعمها بسبب نقص
 * المعلومات» — and the owner was right about the cause.
 *
 * Fifteen hundred games arrived from the supplier's sheet with one English
 * string each: 1,546 of the catalogue's 1,714 rows carry no Arabic name at
 * all. So an Arabic query has nothing to match and must cross scripts through
 * `phoneticKey`, which romanises each side independently — «فاير» becomes
 * "fair" while "fire" stays "fire", two edits apart against a budget of one.
 *
 * These are the six franchises measured at zero against the real catalogue
 * while their games sat in it, and the washing machine that must keep
 * returning nothing.
 */
import { describe, expect, it } from "vitest";

import { buildProductIndex, searchProducts } from "./products";

/**
 * The shape the browser actually receives: an English title and little else.
 * Writing a `titleAr` into this fixture would test a catalogue the shop does
 * not have.
 */
const game = (id: string, title: string) => ({
  id,
  title,
  titleEn: title,
  slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  price: 9000,
  kind: "game",
  isActive: true,
});

const CATALOGUE = [
  game("fe1", "Fire Emblem Engage"),
  game("fe2", "Fire Emblem Three Houses"),
  game("op1", "One Piece Odyssey"),
  game("op2", "One Piece Pirate Warriors 4"),
  game("dz1", "Disney Illusion Island"),
  game("dz2", "Disney Dreamlight Valley"),
  game("sb1", "SpongeBob SquarePants: The Cosmic Shake"),
  game("sf1", "Street Fighter 6"),
  game("mc1", "Minecraft"),
  game("zl1", "The Legend of Zelda: Tears of the Kingdom"),
  game("mr1", "Super Mario Odyssey"),
  game("so1", "Sonic Frontiers"),
  game("kb1", "Kirby and the Forgotten Land"),
  // Bystanders: ordinary titles that must not start answering Arabic nouns.
  game("x1", "Salt and Sacrifice"),
  game("x2", "Sally Face"),
  game("x3", "Gal Guardians"),
  game("x4", "Magical Craft"),
  game("x5", "Two Point Hospital"),
  game("x6", "Door Kickers"),
];

const index = buildProductIndex(CATALOGUE);
const hits = (query: string) => searchProducts(index, query, 20).map((row) => row.product["id"]);

describe("an Arabic query finds the game it names", () => {
  it.each([
    ["فاير امبلم", ["fe1", "fe2"]],
    ["ون بيس", ["op1", "op2"]],
    ["ديزني", ["dz1", "dz2"]],
    ["سبونج بوب", ["sb1"]],
    ["ستريت فايتر", ["sf1"]],
    ["ماين كرافت", ["mc1"]],
    ["زيلدا", ["zl1"]],
    ["ماريو", ["mr1"]],
    ["سونيك", ["so1"]],
    ["كيربي", ["kb1"]],
  ])("«%s» finds its games", (query, expected) => {
    const found = hits(query);
    for (const id of expected) expect(found).toContain(id);
  });

  it("puts the real game first, not a lookalike", () => {
    /*
      The failure mode of every rejected fix was answering these queries with
      something that merely sounded similar — «ماين كرافت» with Magical Craft,
      «ون بيس» with Attack on Titan 2. Finding the game is not enough; it has
      to lead.
    */
    expect(hits("ماين كرافت")[0]).toBe("mc1");
    expect(hits("ون بيس")[0]).toBe("op1");
  });
});

describe("and a word that is not a game still finds nothing", () => {
  /*
    The one non-negotiable constraint. «غسالة» is a washing machine; the revert
    recorded at relevance.ts:135-149 exists because a previous widening
    answered it with Salt and Sacrifice, Sally Face and Gal Guardians — all
    three of which are in the fixture above, deliberately.

    Three separate proposed fixes were measured to break this and were not
    taken. A named alias cannot: it only fires on a word somebody typed.
  */
  it.each(["غسالة", "خبز", "تلفزيون", "سيارة", "قميص"])("«%s» returns nothing", (query) => {
    expect(hits(query)).toEqual([]);
  });
});

describe("the aliases are aliases, not a widening", () => {
  it("leaves English search exactly as it was", () => {
    expect(hits("fire emblem")).toContain("fe1");
    expect(hits("minecraft")).toContain("mc1");
  });

  it("does not make an unrelated Arabic word match by accident", () => {
    // «كراسي» (chairs) shares letters with «كرافت» but is not it.
    expect(hits("كراسي")).toEqual([]);
  });
});
