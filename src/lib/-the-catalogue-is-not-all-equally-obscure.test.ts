/**
 * Six buckets, not two.
 *
 * The owner's screenshot of the live roulette: «لعبة غير مشهورة — سعر منخفض»
 * 24.5% over 983 games, «لعبة غير مشهورة — سعر أعلى» 0.49% over 724, and the
 * four famous buckets at 0.000%. Every eligible game read `low`, because
 * popularity had exactly one source — a table an admin fills in by hand — and
 * nobody had filled in seventeen hundred rows.
 *
 * That is not a classification. It is the absence of one, rendered as though
 * it were a finding.
 */
import { describe, expect, it } from "vitest";

import { fameTier, FAMOUS_RANK, KNOWN_RANK } from "./roulette-fame";

describe("a household name is not «غير مشهورة»", () => {
  it("calls the very biggest sellers famous", () => {
    for (const title of [
      "Mario Kart 8 Deluxe",
      "Animal Crossing: New Horizons",
      "Super Smash Bros. Ultimate",
      "The Legend of Zelda: Breath of the Wild",
      "Super Mario Odyssey",
    ]) {
      expect(fameTier(title), title).toBe("high");
    }
  });

  it("calls a game on the list but far down it half-famous", () => {
    // Real, published sales — just not a household name.
    expect(fameTier("ASTRAL CHAIN")).toBe("medium");
  });

  it("leaves the long tail alone", () => {
    for (const title of ["9 R.I.P.", "Absolute Fear -AOONI-", "Some Obscure Visual Novel"]) {
      expect(fameTier(title), title).toBe("low");
    }
  });

  it("is not fooled by the shop's own platform suffixes", () => {
    /*
      The catalogue writes «[Switch 2]» and «Nintendo Switch 2 Edition» into
      titles. A flagship re-release must not be demoted for being a re-release.
    */
    expect(fameTier("Mario Kart 8 Deluxe [Switch 2]")).toBe("high");
    expect(fameTier("The Legend of Zelda: Breath of the Wild — Nintendo Switch 2 Edition")).toBe(
      "high",
    );
  });
});

describe("the demand tier is consulted, but only when it actually knows", () => {
  it("promotes a game the shop calls flagship", () => {
    // Keyed by slug, and not on the worldwide list under this title.
    expect(fameTier("Mario Kart World", "mario-kart-world")).toBe("high");
  });

  it("does NOT promote a game merely because the tier table defaults", () => {
    /*
      `demandTierFor` answers `standard` for any slug it does not know. Reading
      that as evidence would promote the whole catalogue to medium — the exact
      mirror of the bug being fixed.
    */
    expect(fameTier("Some Obscure Visual Novel", "a-slug-nobody-has-tiered")).toBe("low");
  });

  it("takes the more generous of the two sources", () => {
    // Famous by sales stays famous even if its slug is untiered.
    expect(fameTier("Mario Kart 8 Deluxe", "a-slug-nobody-has-tiered")).toBe("high");
  });

  it("works with no slug at all", () => {
    expect(fameTier("Mario Kart 8 Deluxe")).toBe("high");
    expect(fameTier("Some Obscure Visual Novel")).toBe("low");
  });
});

describe("the cuts are named, so they can be argued with", () => {
  it("keeps the two thresholds ordered and on the list", () => {
    expect(FAMOUS_RANK).toBeLessThan(KNOWN_RANK);
    expect(FAMOUS_RANK).toBeGreaterThan(0);
  });

  it("refuses nothing — every input gets a tier", () => {
    for (const title of [undefined, null, "", 0, {}, []]) {
      expect(["low", "medium", "high"]).toContain(fameTier(title as never));
    }
  });
});
