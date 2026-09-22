/**
 * «أضف أن هناك حظ أوفر تكون النسبة أعلى من اللعبه ذات الخمسة آلاف، واجعل
 * التحكم بالنسب والتقسيمات تكون من الإدارة».
 *
 * Until now every spin that reached `pickWeighted` won a game. There was no
 * losing outcome to express, and no door for an admin to change a band or a
 * weight without a deploy.
 *
 * The trap in doing it is that the weights are PER GAME. Production holds 984
 * games at or under 5,000 د.ع at weight 100, 538 up to 10,000 at 30, 178 up to
 * 20,000 at 8, 2 up to 40,000 at 2 — a pool of 115,969 in which the cheapest
 * band's share is 98,400, the 84.9% the wheel screen prints. A «حظ أوفر»
 * written as a tier weight would be roughly eight hundred times smaller than
 * it looks: an admin typing 120, reasonably expecting something near 100,
 * would get one tenth of one percent.
 *
 * So the losing chance is set as a CHANCE and the weight derived from it.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIERS,
  DEFAULT_WHEEL_ODDS,
  LOSING_LABEL,
  losingWeightFor,
  normalizeWheelOdds,
  oddsBreakdown,
  weightForPriceIn,
  wheelOddsProblem,
  type WheelOdds,
} from "./wheel-odds";

/** The live catalogue, as counted in production, band by band. */
const COUNTS = [984, 538, 178, 2, 1];

const odds = (patch: Partial<WheelOdds> = {}): WheelOdds => ({ ...DEFAULT_WHEEL_ODDS, ...patch });

describe("losing is higher than the cheapest band, which is what was asked", () => {
  it("beats it at the default", () => {
    const rows = oddsBreakdown(odds(), COUNTS);
    const losing = rows.find((row) => row.label === LOSING_LABEL)!;
    const cheapest = rows.find((row) => row.label === "≤ 5,000")!;
    expect(losing.chance).toBeGreaterThan(cheapest.chance);
  });

  it("gives the losing chance the admin actually typed", () => {
    for (const percent of [10, 50, 80, 95]) {
      const rows = oddsBreakdown(odds({ losingPercent: percent }), COUNTS);
      const losing = rows.find((row) => row.label === LOSING_LABEL)!;
      expect(losing.chance * 100).toBeCloseTo(percent, 6);
    }
  });

  it("leaves every band its old share of what remains", () => {
    /*
      The cheapest band was 84.9% of the wheel. At a losing chance of 50% it
      should be half of that, not something else: adding a losing outcome must
      not silently re-rank the games.
    */
    const before = oddsBreakdown(odds({ losingPercent: 0 }), COUNTS);
    const after = oddsBreakdown(odds({ losingPercent: 50 }), COUNTS);
    for (const row of before) {
      const same = after.find((other) => other.label === row.label)!;
      expect(same.chance).toBeCloseTo(row.chance / 2, 9);
    }
  });

  it("shows no losing row at all when the admin turns it off", () => {
    expect(
      oddsBreakdown(odds({ losingPercent: 0 }), COUNTS).some((r) => r.label === LOSING_LABEL),
    ).toBe(false);
    expect(losingWeightFor(115_969, 0)).toBe(0);
  });

  it("is not comparable to a tier weight, which is the whole point", () => {
    /*
      The mistake this design exists to prevent, measured: a losing weight of
      120 against the live pool is 0.1%, not the 50% an admin would expect
      from a number that looks like the cheapest band's 100.
    */
    const pool = DEFAULT_TIERS.reduce((sum, tier, i) => sum + tier.weight * COUNTS[i]!, 0);
    expect(pool).toBe(115_969);
    expect((120 / (pool + 120)) * 100).toBeLessThan(0.2);
  });
});

describe("what an admin may save", () => {
  it("refuses a set with no bands", () => {
    expect(wheelOddsProblem(odds({ tiers: [] }))).toMatch(/بلا فئات/);
  });

  it("refuses a set where every weight is zero", () => {
    const flat = DEFAULT_TIERS.map((tier) => ({ ...tier, weight: 0 }));
    expect(wheelOddsProblem(odds({ tiers: flat }))).toMatch(/أكبر من صفر/);
  });

  it("refuses bounds that do not ascend", () => {
    const jumbled = [
      { upTo: 10_000, weight: 1, label: "a" },
      { upTo: 5_000, weight: 1, label: "b" },
    ];
    expect(wheelOddsProblem(odds({ tiers: jumbled }))).toMatch(/تصاعدية/);
  });

  it("refuses an open-topped band that is not last", () => {
    const wrong = [
      { upTo: null, weight: 1, label: "a" },
      { upTo: 5_000, weight: 1, label: "b" },
    ];
    expect(wheelOddsProblem(odds({ tiers: wrong }))).toMatch(/الأخيرة/);
  });

  it("refuses a negative weight and a losing chance out of range", () => {
    expect(wheelOddsProblem(odds({ tiers: [{ upTo: 1, weight: -1, label: "x" }] }))).toMatch(/وزن/);
    expect(wheelOddsProblem(odds({ losingPercent: 99 }))).toMatch(/بين 0 و 95/);
  });

  it("refuses a fractional ticket price", () => {
    expect(wheelOddsProblem(odds({ ticketPriceBananas: 2.5 }))).toMatch(/عددًا صحيحًا/);
  });

  it("accepts the shipped set", () => {
    expect(wheelOddsProblem(DEFAULT_WHEEL_ODDS)).toBeNull();
  });
});

describe("what comes back out of the settings document", () => {
  it("survives a JSON round trip with its open top intact", () => {
    /*
      `JSON.stringify(Number.POSITIVE_INFINITY)` is `null`, so a top band
      written with Infinity came back with no bound at all — silently, and
      only for the most expensive games.
    */
    const stored = JSON.parse(JSON.stringify(DEFAULT_WHEEL_ODDS));
    const back = normalizeWheelOdds(stored);
    expect(back.tiers[back.tiers.length - 1]!.upTo).toBeNull();
    expect(weightForPriceIn(back.tiers, 749_000).label).toBe("> 40,000");
  });

  it("sorts a jumbled set instead of mis-banding the catalogue", () => {
    const back = normalizeWheelOdds({
      tiers: [
        { upTo: 20_000, weight: 8, label: "c" },
        { upTo: 5_000, weight: 100, label: "a" },
        { upTo: 10_000, weight: 30, label: "b" },
      ],
    });
    expect(back.tiers.map((t) => t.label)).toEqual(["a", "b", "c"]);
    expect(weightForPriceIn(back.tiers, 4_000).label).toBe("a");
  });

  it("falls back to the shipped bands rather than bricking every spin", () => {
    expect(normalizeWheelOdds({ tiers: [] }).tiers).toEqual(DEFAULT_TIERS);
    expect(normalizeWheelOdds({ tiers: [{ upTo: 5_000, weight: 0, label: "x" }] }).tiers).toEqual(
      DEFAULT_TIERS,
    );
    expect(normalizeWheelOdds(undefined).tiers).toEqual(DEFAULT_TIERS);
  });

  it("treats a ticket price of nothing as a price the owner has not set", () => {
    expect(normalizeWheelOdds({}).ticketPriceBananas).toBe(0);
  });
});

describe("the breakdown the wheel screen prints", () => {
  it("is returned by position, so an edited label cannot merge two bands", () => {
    const rows = oddsBreakdown(
      odds({
        tiers: [
          { upTo: 5_000, weight: 1, label: "same" },
          { upTo: 10_000, weight: 1, label: "same" },
        ],
        losingPercent: 0,
      }),
      [10, 30],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.games).toBe(10);
    expect(rows[1]!.games).toBe(30);
  });

  it("adds up to one", () => {
    const total = oddsBreakdown(odds(), COUNTS).reduce((sum, row) => sum + row.chance, 0);
    expect(total).toBeCloseTo(1, 9);
  });

  it("says nothing is certain when there are no games at all", () => {
    expect(oddsBreakdown(odds(), [0, 0, 0, 0, 0]).every((row) => row.chance === 0)).toBe(true);
  });
});
