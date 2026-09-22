/**
 * Why the most famous games in the shop are the ones without a square cover.
 *
 * The owner, with a screenshot of banan.to:
 *
 *   «والصور المربعة الألعاب خاصة المشهورة منها لا توجد»
 *
 * Not a coincidence, and not the obscure Japanese-only releases that make up
 * most of the 469 without a card. Two faults, both of which hit the biggest
 * names first:
 *
 * 1. `slugifyTitle` ran `normalize("NFKD")` and then replaced everything
 *    outside `[a-zA-Z0-9]` with a HYPHEN. NFKD leaves the accent of «é» behind
 *    as U+0301, so every Pokémon key in this catalogue read `poke-mon`, and not
 *    one of those is a page. Fifteen rows of the supplier sheet are affected —
 *    fourteen Pokémon/Pokkén titles and «Märchen Forest».
 *
 * 2. Three rows name more than one product: «Pokémon Sword / Shield», «Pokémon
 *    Scarlet / Violet», «Pokémon Scarlet + The Hidden Treasure of Area Zero».
 *    Nintendo sells each half separately, so NO key built from the whole row
 *    can resolve however the accent is spelled, and Europe's exact-title search
 *    refused them for the same reason.
 *
 * The repository already knew the answer to (1) in two other files, and already
 * held the answer to (2) in its own data: the supplier sheet's «Matched Title»
 * is Nintendo's own name for the row, stored as `canonicalTitle`, and for the
 * Scarlet + DLC row it already says «Pokémon Scarlet». The filler never passed
 * it.
 */
import { describe, expect, it } from "vitest";

import {
  candidateKeys,
  identityMatch,
  slugifyTitle,
  titleAlternatives,
} from "./lib/nintendo-store.mjs";
import { europeRows } from "./lib/nintendo-eu-search.mjs";

describe("the accent NFKD leaves behind", () => {
  it("spells Pokémon the way Nintendo does, not «poke-mon»", () => {
    expect(slugifyTitle("Pokémon Scarlet")).toBe("pokemon-scarlet");
    expect(slugifyTitle("Pokkén Tournament DX")).toBe("pokken-tournament-dx");
    expect(slugifyTitle("Märchen Forest")).toBe("marchen-forest");
  });

  it("still drops the trademark marks and spells out the plus", () => {
    expect(slugifyTitle("Pikmin™ 4")).toBe("pikmin-4");
    expect(slugifyTitle("Mario + Rabbids Sparks of Hope")).toBe("mario-plus-rabbids-sparks-of-hope");
  });

  it("puts a real Pokémon key within reach of the store", () => {
    const keys = candidateKeys({ title: "Pokémon Brilliant Diamond", platform: "switch" });
    expect(keys).toContain("pokemon-brilliant-diamond-switch");
    expect(keys.join(" ")).not.toContain("poke-mon");
  });
});

describe("one row, more than one game", () => {
  it("offers each half of a spaced slash, with the franchise carried across", () => {
    expect(titleAlternatives("Pokémon Sword / Shield")).toEqual([
      "Pokémon Sword / Shield",
      "Pokémon Sword",
      "Pokémon Shield",
    ]);
    expect(titleAlternatives("Pokémon Scarlet / Violet")).toEqual([
      "Pokémon Scarlet / Violet",
      "Pokémon Scarlet",
      "Pokémon Violet",
    ]);
  });

  it("offers the game without its add-on", () => {
    expect(titleAlternatives("Pokémon Scarlet + The Hidden Treasure of Area Zero")).toEqual([
      "Pokémon Scarlet + The Hidden Treasure of Area Zero",
      "Pokémon Scarlet",
    ]);
  });

  it("NEVER cuts a single game whose name contains a slash", () => {
    /*
      Six rows of the sheet carry an unspaced slash and every one is one game.
      Splitting them would send the filler looking for «Fate stay night», and a
      wrong page is far worse than a missing cover.
    */
    for (const title of [
      "Fate/stay night REMASTERED",
      "FINAL FANTASY X/X-2 HD Remaster",
      ".hack//G.U. Last Recode",
      "Nari Kids Park: Ultraman R/B",
    ]) {
      expect(titleAlternatives(title), title).toEqual([title]);
    }
  });

  it("always offers the whole title first, so nothing that works today stops", () => {
    for (const title of [
      "Pokémon Sword / Shield",
      "Tony Hawk's Pro Skater 3 + 4",
      "Super Mario Party",
    ]) {
      expect(titleAlternatives(title)[0], title).toBe(title);
    }
  });
});

describe("the shop's own record answers first", () => {
  it("builds keys from the canonical title the sheet already holds", () => {
    const keys = candidateKeys({
      title: "Pokémon Scarlet + The Hidden Treasure of Area Zero",
      canonicalTitle: "Pokémon Scarlet",
      platform: "switch",
    });
    expect(keys).toContain("pokemon-scarlet-switch");
  });

  it("does not let the extra shapes push the slug-derived key off the end", () => {
    const keys = candidateKeys({
      title: "Pokémon Scarlet / Violet",
      canonicalTitle: "Pokémon Violet",
      slug: "pokemon-violet-switch",
      platform: "switch",
    });
    expect(keys).toContain("pokemon-violet-switch");
  });
});

describe("the page it finds is still the game it asked for", () => {
  const row = {
    title: "Pokémon Sword / Shield",
    platform: "switch",
    canonicalTitle: "Pokémon Shield",
  };

  it("accepts the half it went looking for", () => {
    expect(identityMatch(row, { name: "Pokémon Shield", platform: { label: "Switch" } }).ok).toBe(
      true,
    );
    expect(identityMatch(row, { name: "Pokémon Sword", platform: { label: "Switch" } }).ok).toBe(
      true,
    );
  });

  it("still refuses a sequel, which is what equality was for", () => {
    /*
      The check widened the SET of acceptable titles; it did not relax the
      comparison. Containment once read «Xenoblade Chronicles 2» as a match for
      «Xenoblade Chronicles: Definitive Edition» and wrote one game's facts onto
      the other.
    */
    const xeno = { title: "Xenoblade Chronicles: Definitive Edition", platform: "switch" };
    const verdict = identityMatch(xeno, {
      name: "Xenoblade Chronicles 2",
      platform: { label: "Switch" },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("is not");
  });

  it("refuses a different Pokémon game that was never on the row", () => {
    const verdict = identityMatch(row, {
      name: "Pokémon Scarlet",
      platform: { label: "Switch" },
    });
    expect(verdict.ok).toBe(false);
  });
});

describe("Europe is asked one title at a time", () => {
  /** The European index, as the two rows that actually exist there. */
  const index = [
    { title: "Pokémon Sword", image_url_sq_s: "/sword.jpg" },
    { title: "Pokémon Shield", image_url_sq_s: "/shield.jpg" },
  ];
  const fetchJson = async (url) => {
    const q = decodeURIComponent(new URL(url).searchParams.get("q") ?? "").toLowerCase();
    const docs = index.filter((row) => q && row.title.toLowerCase().includes(q.toLowerCase()));
    return { ok: true, status: 200, json: { response: { docs } } };
  };

  it("finds a half of the row that the whole row could never match", async () => {
    const found = await europeRows("Pokémon Sword / Shield", fetchJson);
    expect(found.ok).toBe(true);
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0].title).toBe("Pokémon Sword");
  });

  it("returns ONE row, not both halves — pooling them would read as an ambiguity", async () => {
    /*
      Deliberately a loop rather than one pooled search. Both halves in one
      `exact` list trips the «rows share this exact title» refusal downstream,
      which is there so an ambiguous search is never guessed at.
    */
    const found = await europeRows("Pokémon Sword / Shield", fetchJson);
    expect(found.rows.map((row) => row.title)).toEqual(["Pokémon Sword"]);
  });

  it("reports a real miss instead of claiming one of the halves", async () => {
    const found = await europeRows("A Game Nobody Sells", fetchJson);
    expect(found.ok).toBe(false);
    expect(found.reason).toBeTruthy();
  });
});
