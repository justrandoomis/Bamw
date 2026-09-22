/**
 * «السوق ميت ولا يعمل بشكل نهائي».
 *
 * The owner set «سعر الافتتاح المرجعي للموز» to 0.0004 and the shop priced at
 * zero. Production held, exactly:
 *
 *     {"basePrice":0.0004,"minPrice":0.0001,"maxPrice":0.0003, ...}
 *
 * Two faults stacked, and either alone was enough. The base sat ABOVE the
 * ceiling, so `spotPriceAt` clamped every price to 0.0003 and the number the
 * owner typed meant nothing. And the whole band sat below a rounding step of
 * 0.001, so whatever survived the clamp rounded to 0.000 anyway.
 *
 * A market priced at nothing is not a cosmetic fault. `processBotTrading`
 * returns on `!(marketPrice > 0)`, so the bots never ran; a listing priced per
 * banana against a zero spot is meaningless; and the board stayed empty. One
 * constant and one missing comparison killed every part of it.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MARKET_CONFIG,
  marketConfigProblem,
  repairBand,
  spotPriceAt,
  type BananaMarketConfig,
} from "./banana-market-config.server";
import { PRICE_STEP, formatPrice, roundPrice, roundsToZero } from "./banana-price";

/** What production actually held when the owner reported the market dead. */
const PRODUCTION: BananaMarketConfig = {
  ...DEFAULT_MARKET_CONFIG,
  basePrice: 0.0004,
  minPrice: 0.0001,
  maxPrice: 0.0003,
};

describe("the price this shop actually wants", () => {
  it("expresses four ten-thousandths of a dinar instead of erasing it", () => {
    expect(roundPrice(0.0004)).toBe(0.0004);
    expect(roundsToZero(0.0004)).toBe(false);
  });

  it("still prices a shop that works in whole fils exactly as before", () => {
    expect(roundPrice(0.24)).toBe(0.24);
    expect(spotPriceAt({ ...DEFAULT_MARKET_CONFIG }, Date.UTC(2026, 0, 1))).toBeGreaterThan(0.2);
  });

  it("prints a price without rounding it away", () => {
    /*
      The admin panel printed `toFixed(3)`, so the one screen that would have
      revealed the fault reported the same 0.000 the customers saw.
    */
    expect(formatPrice(0.0004)).toBe("0.0004");
    expect(formatPrice(0.24)).toBe("0.240");
    expect(formatPrice(1)).toBe("1.000");
  });

  it("names a smallest usable price a person can read", () => {
    expect(formatPrice(PRICE_STEP)).not.toMatch(/e-/);
  });
});

describe("a base outside its own band", () => {
  it("is refused when an admin tries to save it", () => {
    const problem = marketConfigProblem(PRODUCTION);
    expect(problem).toBeTruthy();
    expect(problem).toContain("خارج حدوده");
  });

  it("is accepted once the band admits it", () => {
    expect(marketConfigProblem({ ...PRODUCTION, maxPrice: 0.0006 })).toBeNull();
  });

  it("refuses a band no price can sit inside", () => {
    /*
      A floor and a ceiling that both round to nothing. Refusing names the
      smallest usable number instead of saving it and leaving the admin to
      wonder why the engine ignored them.
    */
    const problem = marketConfigProblem({
      ...DEFAULT_MARKET_CONFIG,
      basePrice: PRICE_STEP / 10,
      minPrice: PRICE_STEP / 100,
      maxPrice: PRICE_STEP / 2,
    });
    expect(problem).toContain("يُقرَّب إلى صفر");
  });

  it("refuses a floor above its ceiling", () => {
    expect(
      marketConfigProblem({ ...DEFAULT_MARKET_CONFIG, minPrice: 2, maxPrice: 1, basePrice: 1.5 }),
    ).toContain("أدنى سعر أكبر من أعلى سعر");
  });

  it("refuses a base of zero", () => {
    expect(marketConfigProblem({ ...DEFAULT_MARKET_CONFIG, basePrice: 0 })).toContain(
      "أكبر من صفر",
    );
  });
});

describe("the shop that is already in that state", () => {
  /*
    A refusal only protects the next save. The catalogue in production has been
    priced at zero since the day the value was written, and nobody is going to
    guess that re-typing the same number into a different tab would fix it.
  */
  it("prices above zero once the band is repaired around the base", () => {
    const repaired = { ...PRODUCTION, maxPrice: PRODUCTION.basePrice };
    for (let i = 0; i < 100; i += 1) {
      const p = spotPriceAt(repaired, Date.UTC(2026, 0, 1) + i * 5 * 60 * 1000);
      expect(p).toBeGreaterThan(0);
    }
  });

  it("would have priced at exactly zero before the repair", () => {
    /*
      The failure, reproduced. Clamped to the 0.0003 ceiling, then rounded at
      the old three-decimal step: `Math.round(0.0003 * 1000) / 1000` is 0.
    */
    const clamped = Math.min(PRODUCTION.maxPrice, Math.max(PRODUCTION.minPrice, 0.0004));
    expect(clamped).toBe(0.0003);
    expect(Math.round(clamped * 1000) / 1000).toBe(0);
    // And at the step the market uses now, the same number is a real price.
    expect(roundPrice(clamped)).toBe(0.0003);
  });
});

describe("the repair, on the way out of the database", () => {
  it("widens the ceiling to admit the base the owner typed", () => {
    const fixed = repairBand(PRODUCTION);
    expect(fixed.maxPrice).toBe(0.0004);
    expect(fixed.basePrice).toBe(0.0004);
    // The floor the admin never saw is left where it was.
    expect(fixed.minPrice).toBe(0.0001);
  });

  it("lowers the floor when the base is below it", () => {
    const fixed = repairBand({ ...DEFAULT_MARKET_CONFIG, basePrice: 0.05, minPrice: 0.1 });
    expect(fixed.minPrice).toBe(0.05);
    expect(fixed.basePrice).toBe(0.05);
  });

  it("leaves a configuration that was already usable exactly as it was", () => {
    expect(repairBand(DEFAULT_MARKET_CONFIG)).toEqual(DEFAULT_MARKET_CONFIG);
  });

  it("does not mutate what it was given", () => {
    const before = { ...PRODUCTION };
    repairBand(PRODUCTION);
    expect(PRODUCTION).toEqual(before);
  });

  it("makes the repaired configuration one the admin could have saved", () => {
    expect(marketConfigProblem(repairBand(PRODUCTION))).toBeNull();
  });
});
