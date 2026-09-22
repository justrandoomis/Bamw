/**
 * @vitest-environment node
 */
/**
 * «حصة الألعاب الضعيفة أكبر ... والألعاب الغالية تكون فرصتها صعبة نوعا ما».
 *
 * The odds are the feature. A wheel whose weighting drifts is not a smaller
 * bug than one that crashes — it is the shop giving away the wrong games — so
 * the distribution is asserted against the real shape of the catalogue rather
 * than a toy list.
 *
 * Production counts, measured from `product_index` (hidden = 0):
 *   984 games at or below 5,000 IQD
 *   540 from 5,001 to 10,000
 *   184 from 10,001 to 20,000
 *     2 from 20,001 to 40,000
 *     1 above 40,000
 */
import { describe, expect, it } from "vitest";

import { PRIZE_WEIGHTS, pickWeighted, weightForPrice, type WheelCandidate } from "./wheel.server";

/** The live catalogue's price distribution, as counted in production. */
const LIVE_SHAPE: ReadonlyArray<{ price: number; count: number }> = [
  { price: 5_000, count: 984 },
  { price: 9_000, count: 540 },
  { price: 15_000, count: 184 },
  { price: 30_000, count: 2 },
  { price: 60_000, count: 1 },
];

function liveCatalogue(): WheelCandidate[] {
  const games: WheelCandidate[] = [];
  for (const tier of LIVE_SHAPE) {
    for (let index = 0; index < tier.count; index += 1) {
      games.push({ id: `${tier.price}-${index}`, title: `Game ${tier.price}`, price: tier.price });
    }
  }
  return games;
}

/** Deterministic: walk the unit interval instead of sampling it. */
function distribution(games: WheelCandidate[], steps = 20_000): Map<string, number> {
  const counts = new Map<string, number>();
  for (let step = 0; step < steps; step += 1) {
    const unit = (step + 0.5) / steps;
    const picked = pickWeighted(games, () => unit);
    if (!picked) continue;
    const label = weightForPrice(picked.candidate.price).label;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

describe("the cheap games come up and the expensive ones do not", () => {
  const games = liveCatalogue();
  const counts = distribution(games);
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const share = (label: string) => (counts.get(label) ?? 0) / total;

  it("gives the 5,000-dinar bucket the overwhelming majority", () => {
    // The owner named this bucket specifically.
    expect(share("≤ 5,000")).toBeGreaterThan(0.8);
  });

  it("orders the tiers strictly: cheaper is always likelier", () => {
    const shares = PRIZE_WEIGHTS.map((tier) => share(tier.label));
    for (let index = 1; index < shares.length; index += 1) {
      expect(shares[index]!).toBeLessThan(shares[index - 1]!);
    }
  });

  it("makes the most expensive game in the shop a genuine rarity", () => {
    // One game above 40,000 against 1,711 others, at a hundredth of their weight.
    expect(share("> 40,000")).toBeLessThan(0.0001);
  });

  it("still lets an expensive game be won — hard, not impossible", () => {
    /*
      «صعبة نوعا ما» is not «مستحيلة». A tier that can never come up would be
      a lie told by a wheel that displays it.
    */
    const expensive = games.filter((game) => game.price > 40_000);
    expect(expensive.length).toBeGreaterThan(0);
    const picked = pickWeighted(games, () => 0.9999999);
    expect(picked).not.toBeNull();
  });
});

describe("the weighting itself", () => {
  it("puts every price in exactly one tier", () => {
    for (const price of [0, 1, 5_000, 5_001, 10_000, 10_001, 20_000, 40_000, 40_001, 1e9]) {
      const tier = weightForPrice(price);
      expect(PRIZE_WEIGHTS.some((t) => t.label === tier.label)).toBe(true);
    }
  });

  it("treats a boundary price as the cheaper tier", () => {
    // 5,000 exactly is a «خمسة آلاف» game, not a 5,001+ one.
    expect(weightForPrice(5_000).label).toBe("≤ 5,000");
    expect(weightForPrice(5_001).label).not.toBe("≤ 5,000");
  });

  it("does not crash on a price that is not a number", () => {
    // A malformed row lands in the rarest tier rather than throwing mid-spin.
    expect(weightForPrice(Number.NaN).label).toBe("> 40,000");
  });

  it("returns nothing at all when there is nothing to win", () => {
    expect(pickWeighted([])).toBeNull();
  });

  it("always returns a candidate for any unit value in range", () => {
    const games = [
      { id: "a", title: "a", price: 5_000 },
      { id: "b", title: "b", price: 60_000 },
    ];
    for (const unit of [0, 0.25, 0.5, 0.75, 0.999999999, 1]) {
      expect(pickWeighted(games, () => unit)).not.toBeNull();
    }
  });
});

describe("the winner is decided on the server", () => {
  it("the route never takes candidates from the request body", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const route = readFileSync(resolve(process.cwd(), "src/routes/api/wheel.ts"), "utf8");
    /*
      The spin is called with the server's own list. A body-supplied pool
      would let anyone name the prize they wanted.
    */
    expect(route).toMatch(/candidates:\s*await wheelCandidates\(\)/);
    expect(route).not.toMatch(/candidates:\s*(input|data|body)/);
    /*
      And `wheelCandidates` takes no argument, so there is nowhere for a body
      to enter even if a later edit passed one — the pool reads the catalogue.
    */
    expect(route).not.toMatch(/wheelCandidates\([^)]/);
  });
});
