/**
 * The market did not die in one place. It died in four, all the same way.
 *
 * `Math.round(x * 1000) / 1000` appeared in the engine, in the bot listings,
 * in a member's own listing and in the chart — four independent copies of the
 * assumption that a price has three decimals. This shop's banana is worth
 * 0.0004 د.ع, so every one of them rendered it as nothing:
 *
 *   - the spot price, so `processBotTrading` stood down on `marketPrice > 0`;
 *   - the bot offers, which then fell back to each bot's own stale floor —
 *     production's six carry floors of 0.643 to 0.769, seeded when the price
 *     was around 1 — and listed at nineteen hundred times the market;
 *   - the one real member listing ever created, 430,000 bananas for 50.0047
 *     IQD, which read 0.000 to its own owner;
 *   - the chart, which drew the whole history flat along zero.
 *
 * Fixing one would have looked like fixing none. These pin all four.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_MARKET_CONFIG, spotPriceAt } from "./banana-market-config.server";
import { roundPrice } from "./banana-price";

/** The shop as the owner configured it, with the band repaired around the base. */
const SHOP = { ...DEFAULT_MARKET_CONFIG, basePrice: 0.0004, minPrice: 0.0001, maxPrice: 0.0004 };

describe("a price of four ten-thousandths, everywhere it is computed", () => {
  it("survives the spot engine", () => {
    for (let i = 0; i < 200; i += 1) {
      const p = spotPriceAt(SHOP, Date.UTC(2026, 0, 1) + i * 5 * 60 * 1000);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThanOrEqual(SHOP.maxPrice);
    }
  });

  it("survives a member's own listing", () => {
    // The one offer this shop has ever had: 430,000 bananas for 50.0047 IQD.
    expect(roundPrice(50.0047 / 430_000)).toBeGreaterThan(0);
    expect(Math.round((50.0047 / 430_000) * 1000) / 1000).toBe(0);
  });

  it("survives the chart", () => {
    expect(roundPrice(0.000116)).toBe(0.000116);
  });
});

describe("a bot's own floor is a preference, not a rule", () => {
  /*
    Production's bots carry `min_price_iqd` between 0.643 and 0.769 against a
    market priced at 0.0004. Applying the bot's floor AFTER the market's band,
    as the code did, let a stale per-bot number put the whole board three
    orders of magnitude above the market. The band has to be last.
  */
  const band = (bandFloor: number, bandCeiling: number, botFloor: number, spot: number) => {
    let pricePer = roundPrice(spot);
    if (botFloor) pricePer = Math.max(pricePer, botFloor);
    return roundPrice(Math.min(bandCeiling, Math.max(bandFloor, pricePer)));
  };

  it("keeps a bot with a stale floor inside the market's ceiling", () => {
    expect(band(0.0001, 0.0004, 0.769, 0.0004)).toBe(0.0004);
  });

  it("still honours a floor that sits inside the band", () => {
    expect(band(0.1, 1, 0.5, 0.2)).toBe(0.5);
  });

  it("leaves a bot with no floor at the market price", () => {
    expect(band(0.1, 1, 0, 0.24)).toBe(0.24);
  });
});
