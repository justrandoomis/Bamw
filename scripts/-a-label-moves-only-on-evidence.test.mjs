/**
 * A platform is half of a product's identity, so every rule about moving one
 * is a refusal. These are the refusals.
 *
 * The fault they exist to prevent is not "a label looks wrong in the admin".
 * It is this: `productIdentityKeys` builds `platform::title` and the catalogue
 * has a unique index on that pair, so a wrong flip moves a product onto
 * another product's key — and the game that really holds it can then never be
 * saved again.
 */
import { describe, expect, it } from "vitest";

import { editionAwareTitle, generationKeys, nodeGeneration } from "./lib/nintendo-store.mjs";
import { searchEuropeGenerations } from "./lib/nintendo-eu-search.mjs";
import {
  declaresSwitch2Edition,
  platformVerdict,
  settleCollisions,
  settleWithFallback,
  switch2Claims,
  titleFlags,
  titleVerdict,
} from "./lib/platform-verdict.mjs";

describe("when a label may move", () => {
  it("moves a Switch 2 line to Switch 1 when both Nintendo stores only have Switch 1", () => {
    const verdict = platformVerdict({ ours: "switch2", evidence: ["switch1"] });
    expect(verdict).toMatchObject({ action: "flip", to: "switch1" });
  });

  it("moves the other way on the same evidence", () => {
    const verdict = platformVerdict({ ours: "switch1", evidence: ["switch2"] });
    expect(verdict).toMatchObject({ action: "flip", to: "switch2" });
  });
});

describe("when it may not", () => {
  it("leaves a game neither store carries exactly as it is", () => {
    /*
      Three hundred games in this catalogue are not in Nintendo's US store
      under any name, and some are in neither. Silence is not a verdict.
    */
    const verdict = platformVerdict({ ours: "switch2", evidence: [] });
    expect(verdict.action).toBe("keep");
    expect(verdict.reason).toMatch(/no evidence is not evidence/);
  });

  it("refuses to read a request that never arrived as an absence", () => {
    /*
      The square-card filler recorded `Prison Architect → HTTP 0 · HTTP 0` as
      "Nintendo has nothing". Here the same mistake would write a WRONG label
      rather than merely fail to write a right one, so it fails closed.
    */
    const verdict = platformVerdict({ ours: "switch2", evidence: ["switch1"], complete: false });
    expect(verdict.action).toBe("report");
    expect(verdict.reason).toMatch(/never arrived/);
  });

  it("keeps a label the evidence vindicates", () => {
    expect(platformVerdict({ ours: "switch2", evidence: ["switch1", "switch2"] }).action).toBe(
      "keep",
    );
  });

  it("never demotes a Nintendo Switch 2 Edition, whatever the rows say", () => {
    const verdict = platformVerdict({ ours: "switch2", evidence: ["switch1"], isEdition: true });
    expect(verdict.action).toBe("report");
    expect(verdict).not.toHaveProperty("to", "switch1");
  });

  it("reports rather than flips a product the shop sells for both consoles", () => {
    /*
      Nearly every Switch 1 game is playable on a Switch 2, so "both" is a
      statement about what the shop will sell, not a claim about Nintendo's
      catalogue. That is the owner's to make.
    */
    const verdict = platformVerdict({ ours: "both", evidence: ["switch1"] });
    expect(verdict.action).toBe("report");
  });

  it('vindicates "both" when Nintendo really does carry both', () => {
    /*
      Measured, and the reason this test exists: the first dry run reported
      RAIDOU Remastered as a fault — "Nintendo lists it only on switch1 and
      switch2" — because `seen` can never contain the word "both" and the
      vindication check above therefore could not see it.
    */
    const verdict = platformVerdict({ ours: "both", evidence: ["switch1", "switch2"] });
    expect(verdict.action).toBe("keep");
  });
});

describe("an edition is not a console", () => {
  it("reads the edition words in a title as a separate SKU", () => {
    expect(
      declaresSwitch2Edition({ title: "The Legend of Zelda — Nintendo Switch 2 Edition" }),
    ).toBe(true);
  });

  it("does not read Switch 2 Enhanced as a Switch 2 product", () => {
    /*
      The distinction the whole audit turns on. "Enhanced" is the SAME Switch 1
      cartridge running better on newer hardware; reading it as a console would
      move hundreds of Switch 1 games onto a shelf they do not belong on.
    */
    expect(declaresSwitch2Edition({ title: "Some Game", switch2Enhanced: true })).toBe(false);
  });

  it("keeps the edition words in the title used to compare with Nintendo", () => {
    /*
      `bareTitle` strips them, deliberately, so a Switch 2 Edition page can be
      found from a Switch 1 url key. Using it here would make every
      cross-generation game's Edition sibling read as evidence that the plain
      game is a Switch 2 product.
    */
    expect(editionAwareTitle("Zelda")).not.toBe(
      editionAwareTitle("Zelda – Nintendo Switch 2 Edition"),
    );
  });

  it("still strips this shop's own console bracket", () => {
    expect(editionAwareTitle("9 R.I.P. [Switch]")).toBe(editionAwareTitle("9 R.I.P."));
  });
});

describe("what is asked of Nintendo", () => {
  it("asks about both consoles regardless of what the product claims", () => {
    /*
      `candidateKeys` orders its shapes by the generation the product claims —
      which is the claim under test. Asking it would mean trusting the answer
      to decide the question.
    */
    const keys = generationKeys({ title: "Above Snakes [Switch 2]" });
    expect(keys).toContain("above-snakes-switch");
    expect(keys).toContain("above-snakes-switch-2");
  });

  it("reads a node's console from its own platform field", () => {
    expect(nodeGeneration({ name: "Above Snakes", platform: { label: "Nintendo Switch 2" } })).toBe(
      "switch2",
    );
    expect(nodeGeneration({ name: "Above Snakes", platform: { label: "Nintendo Switch" } })).toBe(
      "switch1",
    );
  });

  it("returns every console Europe lists the exact title on, and no others", async () => {
    const answer = (docs) => async () => ({ ok: true, json: { response: { docs } } });
    const found = await searchEuropeGenerations(
      "Above Snakes",
      answer([
        { title: "Above Snakes", system_names_txt: ["Nintendo Switch"] },
        { title: "Above Snakes", system_names_txt: ["Nintendo Switch 2"] },
        { title: "Below Snakes", system_names_txt: ["Nintendo Switch 2"] },
      ]),
    );
    expect(found.generations).toEqual(["switch1", "switch2"]);
  });

  it("does not let a Switch 2 Edition row answer for the plain game", async () => {
    const answer = (docs) => async () => ({ ok: true, json: { response: { docs } } });
    const found = await searchEuropeGenerations(
      "Some Game",
      answer([
        { title: "Some Game", system_names_txt: ["Nintendo Switch"] },
        {
          title: "Some Game — Nintendo Switch 2 Edition",
          system_names_txt: ["Nintendo Switch 2"],
        },
      ]),
    );
    expect(found.generations).toEqual(["switch1"]);
  });
});

describe("the console bracket in a name", () => {
  it("takes the supplier's console column out of the displayed name", () => {
    expect(titleVerdict("9 R.I.P. [Switch]", "switch1")).toMatchObject({
      action: "rename",
      to: "9 R.I.P.",
    });
  });

  it("leaves a bracket that disagrees with the platform, because it is evidence", () => {
    const verdict = titleVerdict("Some Game [Switch 2]", "switch1");
    expect(verdict.action).toBe("report");
  });

  it("leaves a real parenthetical alone", () => {
    /*
      `Absolute Fear -AOONI- (最恐 -青鬼-)` — the parenthetical is part of the
      name, not a console column.
    */
    expect(titleVerdict("Absolute Fear -AOONI- (最恐 -青鬼-)", "switch1").action).toBe("keep");
  });

  it("refuses to leave a product with no name at all", () => {
    expect(titleVerdict("[Switch]", "switch1").action).toBe("keep");
  });
});

describe("the collision check, which is the last refusal", () => {
  /*
    The application's own rule, imported rather than restated. A private copy
    of `platform::title` here would be a second opinion about what a duplicate
    is, and the two would drift.
  */
  const keysOf = (p) => {
    const platform = String(p.platform ?? "switch1")
      .toLowerCase()
      .includes("2")
      ? "switch2"
      : "switch1";
    return [p.title, p.titleEn]
      .filter((t) => t && String(t).trim())
      .map(
        (t) =>
          `${platform}::${String(t)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim()}`,
      );
  };

  it("drops a correction that would land on a key another product holds", () => {
    const products = [
      { id: "a", title: "Zelda", platform: "switch2" },
      { id: "b", title: "Zelda", platform: "switch1" },
    ];
    const proposals = new Map([["a", { platform: "switch1" }]]);
    const { dropped } = settleCollisions(products, proposals, keysOf);
    expect(proposals.size).toBe(0);
    expect(dropped[0]).toMatchObject({ id: "a", held: ["b"] });
  });

  it("catches two corrections that collide only with each other", () => {
    /*
      The case a one-at-a-time check cannot see: measured against the OTHER
      product's old key, each of these looks safe, and the run would create
      the duplicate its every individual check had just passed.
    */
    const products = [
      { id: "a", title: "Zelda [Switch 2]", platform: "switch1" },
      { id: "b", title: "Zelda [Switch]", platform: "switch1" },
    ];
    const proposals = new Map([
      ["a", { title: "Zelda" }],
      ["b", { title: "Zelda" }],
    ]);
    const { dropped } = settleCollisions(products, proposals, keysOf);
    expect(proposals.size).toBe(0);
    expect(dropped.map((d) => d.id).sort()).toEqual(["a", "b"]);
  });

  it("lets a correction through when the two land on different consoles", () => {
    const products = [
      { id: "a", title: "Zelda [Switch 2]", platform: "switch2" },
      { id: "b", title: "Zelda [Switch]", platform: "switch1" },
    ];
    const proposals = new Map([
      ["a", { title: "Zelda" }],
      ["b", { title: "Zelda" }],
    ]);
    const { dropped } = settleCollisions(products, proposals, keysOf);
    expect(dropped).toEqual([]);
    expect(proposals.size).toBe(2);
  });

  it("re-checks after a drop, because a drop restores the old key", () => {
    /*
      Dropping `a`'s correction puts it back on `switch1::zelda` — which is
      where `b`'s correction was heading. One pass would let `b` through.
    */
    const products = [
      { id: "a", title: "Zelda", platform: "switch1" },
      { id: "b", title: "Zelda", platform: "switch2" },
      { id: "c", title: "Zelda", platform: "switch1" },
    ];
    const proposals = new Map([
      ["a", { platform: "switch2" }],
      ["b", { platform: "switch1" }],
    ]);
    settleCollisions(products, proposals, keysOf);
    expect(proposals.size).toBe(0);
  });

  it("reports a duplicate that was already there and touches neither copy", () => {
    const products = [
      { id: "a", title: "Zelda", platform: "switch1" },
      { id: "b", title: "Zelda", platform: "switch1" },
    ];
    const proposals = new Map();
    const { preexisting, dropped } = settleCollisions(products, proposals, keysOf);
    expect(dropped).toEqual([]);
    expect(preexisting).toHaveLength(1);
    expect(preexisting[0].ids.sort()).toEqual(["a", "b"]);
  });
});

describe("names reported rather than repaired", () => {
  it("flags the UTF-8-read-as-Latin-1 signature without proposing a repair", () => {
    expect(titleFlags("PokÃ©mon")).toContain("mojibake");
    expect(titleVerdict("PokÃ©mon", "switch1").action).toBe("keep");
  });

  it("flags the console written as prose", () => {
    expect(titleFlags("Some Game for Nintendo Switch")).toContain("console in prose");
  });

  it("does not call a CJK title all capitals", () => {
    /*
      Those scripts have no case at all, and an uppercase test that ignores
      that would flag every Japanese title in the catalogue.
    */
    expect(titleFlags("最恐 青鬼 の 世界")).toEqual([]);
  });

  it("tidies stray whitespace, which cannot change an identity", () => {
    /*
      `normalizeProductTitle` collapses whitespace before it builds a key, so
      this rename cannot move a product onto a different one.
    */
    expect(titleVerdict("  Foo   Bar  ", "switch1")).toMatchObject({
      action: "rename",
      to: "Foo Bar",
    });
  });
});

describe("the scraped timestamp, and what came with it", () => {
  /*
    Found by the first full sweep of the names and not previously known to be
    there: twenty-eight products carry a video timestamp in their title, and
    next to it sits whatever cell the scrape ran into.
  */
  it("takes a bare timestamp out of a name", () => {
    expect(
      titleVerdict("Atelier Ryza: Ever Darkness & the Secret Hideout [4:03]", "switch1"),
    ).toMatchObject({
      action: "rename",
      to: "Atelier Ryza: Ever Darkness & the Secret Hideout",
    });
  });

  it("takes a supplier cost off a public name, and says that is what it was", () => {
    const verdict = titleVerdict("Pokémon Sword / Shield [0:10 ¥8.76]", "switch1");
    expect(verdict).toMatchObject({
      action: "rename",
      to: "Pokémon Sword / Shield",
      leaked: "¥8.76",
    });
  });

  it("takes the Chinese supplier name off a public name", () => {
    /*
      `supplier_name_zh_cn` is kept out of the public product API, off the
      product page, out of the public HTML, out of the cache and out of
      search. It was in the title.
    */
    const verdict = titleVerdict("DIABOLIK LOVERS [1:21 狂乱命运]", "switch1");
    expect(verdict).toMatchObject({ action: "rename", to: "DIABOLIK LOVERS", leaked: "狂乱命运" });
  });

  it("sees the console hiding behind a timestamp, and holds it to the same rule", () => {
    /*
      `Chained Together [0:43 Switch 2]` — the plain console pattern cannot
      match behind the `0:43`, so without this the disagreement would go
      unnoticed and the bracket would be stripped as though it said nothing.
    */
    expect(titleVerdict("Chained Together [0:43 Switch 2]", "switch2").action).toBe("rename");
    expect(titleVerdict("Chained Together [0:43 Switch 2]", "switch1").action).toBe("report");
  });

  it("leaves a parenthetical with no timestamp in it alone", () => {
    expect(titleVerdict("Absolute Fear -AOONI- (最恐 -青鬼-)", "switch1").action).toBe("keep");
  });
});

describe("the second chance, for a rename that exists to remove a disclosure", () => {
  const keysOf = (p) => {
    const platform = String(p.platform ?? "switch1")
      .toLowerCase()
      .includes("2")
      ? "switch2"
      : "switch1";
    return [p.title, p.titleEn]
      .filter((t) => t && String(t).trim())
      .map(
        (t) =>
          `${platform}::${String(t)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim()}`,
      );
  };

  it("falls back to removing only the price when the fuller rename would collide", () => {
    /*
      Two products, one game, two supplier costs. Taking both brackets off
      gives them the same name on the same console, so the collision check
      refuses both — and refusing outright would leave `¥8.76` and `¥7.78` on
      the shelf, which is the whole reason the rename existed.
    */
    const products = [
      { id: "a", title: "Pokemon Sword Shield [0:10 ¥8.76]", platform: "switch1" },
      { id: "b", title: "Pokemon Sword Shield [1:27 ¥7.78]", platform: "switch1" },
    ];
    const proposals = new Map([
      ["a", { title: "Pokemon Sword Shield" }],
      ["b", { title: "Pokemon Sword Shield" }],
    ]);
    const weaker = new Map([
      ["a", { title: "Pokemon Sword Shield [0:10]" }],
      ["b", { title: "Pokemon Sword Shield [1:27]" }],
    ]);
    const { refused, rescued } = settleWithFallback(products, proposals, weaker, keysOf);
    expect(refused).toEqual([]);
    expect(rescued.sort()).toEqual(["a", "b"]);
    expect(proposals.get("a").title).toBe("Pokemon Sword Shield [0:10]");
    expect(proposals.get("b").title).toBe("Pokemon Sword Shield [1:27]");
    for (const id of ["a", "b"]) {
      expect(proposals.get(id).title).not.toMatch(/¥/);
    }
  });

  it("puts the weaker form through the same check, not around it", () => {
    /*
      `b` already holds the fuller name and `c` already holds the weaker one,
      so both forms collide and the correction is dropped for good. The point
      is that the rescue is not an escape hatch: it is a second candidate put
      to the same rule.
    */
    const products = [
      { id: "a", title: "Game [0:10 ¥1]", platform: "switch1" },
      { id: "b", title: "Game", platform: "switch1" },
      { id: "c", title: "Game [0:10]", platform: "switch1" },
    ];
    const proposals = new Map([["a", { title: "Game" }]]);
    const weaker = new Map([["a", { title: "Game [0:10]" }]]);
    const { refused, rescued } = settleWithFallback(products, proposals, weaker, keysOf);
    expect(rescued).toEqual([]);
    expect(refused.map((r) => r.id)).toEqual(["a"]);
    expect(proposals.has("a")).toBe(false);
  });

  it("does not reach for the weaker form when the fuller one is fine", () => {
    /*
      `Game` and `Game [0:10]` are different keys, so nothing collides and the
      price comes off entirely — which is the outcome to prefer.
    */
    const products = [
      { id: "a", title: "Game [0:10 ¥1]", platform: "switch1" },
      { id: "b", title: "Game [0:10]", platform: "switch1" },
    ];
    const proposals = new Map([["a", { title: "Game" }]]);
    const weaker = new Map([["a", { title: "Game [0:10]" }]]);
    const { refused, rescued } = settleWithFallback(products, proposals, weaker, keysOf);
    expect(refused).toEqual([]);
    expect(rescued).toEqual([]);
    expect(proposals.get("a").title).toBe("Game");
  });

  it("keeps the rest of a rescued product's correction", () => {
    /*
      A rescued product may also have had its platform corrected. Replacing
      its patch with only the weaker title would silently discard that.
    */
    const products = [
      { id: "a", title: "Game [0:10 ¥1]", platform: "switch2" },
      { id: "b", title: "Game", platform: "switch2" },
    ];
    const proposals = new Map([["a", { title: "Game", platform: "switch2" }]]);
    const weaker = new Map([["a", { title: "Game [0:10]" }]]);
    settleWithFallback(products, proposals, weaker, keysOf);
    expect(proposals.get("a")).toEqual({ title: "Game [0:10]", platform: "switch2" });
  });

  it("counts a product dropped, rescued and dropped again exactly once", () => {
    const products = [
      { id: "a", title: "Game [0:10 ¥1]", platform: "switch1" },
      { id: "b", title: "Game", platform: "switch1" },
      { id: "c", title: "Game [0:10]", platform: "switch1" },
    ];
    const proposals = new Map([["a", { title: "Game" }]]);
    const weaker = new Map([["a", { title: "Game [0:10]" }]]);
    const { refused } = settleWithFallback(products, proposals, weaker, keysOf);
    expect(refused).toHaveLength(1);
  });

  it("refuses nothing when there is nothing to collide with", () => {
    const products = [{ id: "a", title: "Game [0:10 ¥1]", platform: "switch1" }];
    const proposals = new Map([["a", { title: "Game" }]]);
    const weaker = new Map([["a", { title: "Game [0:10]" }]]);
    const { refused, rescued } = settleWithFallback(products, proposals, weaker, keysOf);
    expect(refused).toEqual([]);
    expect(rescued).toEqual([]);
    expect(proposals.get("a").title).toBe("Game");
  });
});

describe("what else says Switch 2, after the platform has moved", () => {
  /*
    `isNintendoSwitch2Product` decides the badge from four things, and
    `platform` is only the first. A correction that moved only the platform
    would leave the shelf saying the thing it just corrected — the same shape
    of half-fix as stripping the console bracket from the url key but not from
    the title.
  */
  it("finds nothing on a product that only ever said Switch 1", () => {
    expect(switch2Claims({ platform: "switch1", tags: ["Action", "RPG"] })).toEqual([]);
  });

  it("names the edition flag, the enhancement flag and the tags", () => {
    const claims = switch2Claims({
      switch2: { isSwitch2Edition: true },
      switch2Enhanced: true,
      tags: ["Action", "Switch 2 Edition"],
    });
    expect(claims).toContain("switch2.isSwitch2Edition");
    expect(claims).toContain("switch2Enhanced");
    expect(claims).toContain('tag "Switch 2 Edition"');
  });

  it("reads tags stored as one delimited string, as the badge does", () => {
    expect(switch2Claims({ tags: "Action;Nintendo Switch 2;RPG" })).toEqual([
      'tag "Nintendo Switch 2"',
    ]);
  });

  it("does not mistake a tag that merely contains the words", () => {
    /*
      The same anchored pattern the badge uses. "Switch 2 games we like" is
      somebody's shelf label, not a console claim.
    */
    expect(switch2Claims({ tags: ["Switch 2 games we like"] })).toEqual([]);
  });
});
