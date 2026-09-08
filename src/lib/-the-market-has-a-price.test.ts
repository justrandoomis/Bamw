/**
 * The Banana Market, priced.
 *
 * Production showed «موزة واحدة $0.00» to every customer and «السعر الحالي:
 * 0.000 د.ع» to the admin, while the engine's base price is 0.24. Two faults
 * met: a stored zero was obeyed as if it were a price, and the admin panel
 * that would have corrected it could not save — its route had no handler for
 * anything the panel sent, so the shop was pinned at a price nobody chose.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MARKET_CONFIG,
  changePercent24h,
  spotPriceAt,
  type BananaMarketConfig,
} from "./banana-market-config.server";

const config = (patch: Partial<BananaMarketConfig> = {}): BananaMarketConfig => ({
  ...DEFAULT_MARKET_CONFIG,
  ...patch,
});

describe("the spot price", () => {
  it("never leaves the admin's floor and ceiling", () => {
    const c = config({ basePrice: 0.24, minPrice: 0.2, maxPrice: 0.3, volatilityPercent: 500 });
    for (let i = 0; i < 400; i += 1) {
      const p = spotPriceAt(c, Date.UTC(2026, 0, 1) + i * 5 * 60 * 1000);
      expect(p).toBeGreaterThanOrEqual(c.minPrice);
      expect(p).toBeLessThanOrEqual(c.maxPrice);
    }
  });

  it("is the same for everyone at the same moment", () => {
    const at = Date.UTC(2026, 4, 7, 13, 22);
    expect(spotPriceAt(config(), at)).toBe(spotPriceAt(config(), at));
  });

  it("moves — a market that never moves is a number, not a market", () => {
    const c = config({ minPrice: 0.01, maxPrice: 10 });
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      seen.add(spotPriceAt(c, Date.UTC(2026, 0, 1) + i * 5 * 60 * 1000));
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it("stays inside the volatility the admin allowed", () => {
    const c = config({ basePrice: 1, minPrice: 0.01, maxPrice: 100, volatilityPercent: 10 });
    for (let i = 0; i < 300; i += 1) {
      const p = spotPriceAt(c, Date.UTC(2026, 0, 1) + i * 5 * 60 * 1000);
      // The waves sum to at most ±1.1 of the amplitude.
      expect(p).toBeGreaterThan(0.85);
      expect(p).toBeLessThan(1.15);
    }
  });

  it("is never zero while the base price is real", () => {
    const c = config({ basePrice: 0.24, minPrice: 0.05, maxPrice: 5, volatilityPercent: 6 });
    for (let i = 0; i < 300; i += 1) {
      expect(spotPriceAt(c, Date.UTC(2026, 0, 1) + i * 5 * 60 * 1000)).toBeGreaterThan(0);
    }
  });
});

describe("the 24-hour change", () => {
  it("is a percentage, not a ratio", () => {
    const pct = changePercent24h(config(), Date.UTC(2026, 4, 7, 13, 22));
    expect(Math.abs(pct)).toBeLessThan(100);
  });

  it("is zero when the price cannot move", () => {
    expect(changePercent24h(config({ volatilityPercent: 0 }))).toBe(0);
  });
});
