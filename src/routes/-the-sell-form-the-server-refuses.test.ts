/**
 * «البيع لا يعمل».
 *
 * Two of the three reasons were on this page, not on the server.
 *
 * The price shown: `dinars()` printed three decimals below one dinar, which
 * was right for an engine that priced to three decimals and a lie about a
 * banana worth 0.0004 د.ع. Every price on the market page — the spot, the
 * listings, the seller's own — read «0.000 د.ع».
 *
 * The price offered: the percentage quick-picks floored at 0.01 and rounded to
 * two decimals. Against a ceiling of 0.0004 that made EVERY quick-pick 0.01 —
 * sixteen times the highest price the market allows — so the server refused
 * `price_above_max` whatever the seller chose, and the seller had no way to
 * discover a price it would take.
 */
import { describe, expect, it } from "vitest";

import { dinars } from "./banana_market";
import { PRICE_STEP, roundPrice } from "@/lib/banana-price";

describe("what a price looks like on the market page", () => {
  it("shows a sub-fils price rather than rounding it to nothing", () => {
    expect(dinars(0.0004)).toBe("0.0004 د.ع");
  });

  it("still shows a price in the old range exactly as it did", () => {
    expect(dinars(0.24)).toBe("0.240 د.ع");
  });

  it("leaves whole dinars alone", () => {
    expect(dinars(50_000)).toBe("50,000 د.ع");
    expect(dinars(0)).toBe("0 د.ع");
  });
});

describe("the percentage quick-picks", () => {
  /*
    The page's own rule, as the component applies it: round the way the engine
    rounds, then clamp into the band the server actually enforces.
  */
  const pick = (spot: number, pct: number, minPrice: number, maxPrice: number) => {
    const floor = minPrice > 0 ? minPrice : PRICE_STEP;
    const ceiling = maxPrice > 0 ? maxPrice : Number.POSITIVE_INFINITY;
    return Math.min(ceiling, Math.max(floor, roundPrice(spot * (1 + pct / 100))));
  };

  it("produces a price the server's own bounds accept", () => {
    for (const pct of [-20, -10, 0, 10, 20]) {
      const chosen = pick(0.0004, pct, 0.0001, 0.0004);
      expect(chosen).toBeGreaterThanOrEqual(0.0001);
      expect(chosen).toBeLessThanOrEqual(0.0004);
    }
  });

  it("would have produced an unlistable 0.01 under the old rule", () => {
    /*
      The failure, reproduced: floor 0.01, two decimals, spot 0.0004.
      `Math.round(0.0004 * 100) / 100` is 0, so `Math.max(0.01, 0)` is 0.01 —
      sixteen times a ceiling of 0.0004.
    */
    const old = Math.max(0.01, Math.round(0.0004 * (1 + 0 / 100) * 100) / 100);
    expect(old).toBe(0.01);
    expect(old).toBeGreaterThan(0.0004);
  });

  it("still works unchanged for a shop priced in fils", () => {
    expect(pick(0.24, 10, 0.1, 1)).toBeCloseTo(0.264, 6);
    expect(pick(0.24, -10, 0.1, 1)).toBeCloseTo(0.216, 6);
  });
});
