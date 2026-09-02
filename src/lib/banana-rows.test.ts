import { describe, expect, it } from "vitest";

import {
  toBananaBot,
  toBananaMarketOffer,
  type BananaBotRow,
  type BananaMarketOfferRow,
} from "./banana-rows";

/**
 * Why the market-making bots never bought anything.
 *
 * `SELECT * FROM banana_market_offers` returns snake_case columns; the job read
 * `offer.priceIqd` and `offer.createdAt`. Both were undefined, so the price
 * deviation was NaN, the waiting period was NaN, and `nowTime - NaN > NaN` is
 * false for every offer, on every tick, forever.
 */

const offerRow: BananaMarketOfferRow = {
  id: "bmo_1",
  user_id: "usr_9",
  quantity: 500,
  price_iqd: 2.5,
  locked_banana: 500,
  status: "active",
  created_at: "2026-09-01T10:00:00.000Z",
  updated_at: "2026-09-01T10:00:00.000Z",
};

const botRow: BananaBotRow = {
  id: "bot_1",
  name: "صانع السوق",
  budget_iqd: 50000,
  max_trade_banana: 1000,
  daily_limit_banana: 5000,
  max_total_banana: null,
  min_price_iqd: 1,
  max_purchase_price_iqd: 5,
  delay_strategy_json: null,
  trading_schedule_json: null,
  is_active: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("an offer as the trading job reads it", () => {
  it("carries the price and the timestamp the whole decision rests on", () => {
    const offer = toBananaMarketOffer(offerRow);
    expect(offer.priceIqd).toBe(2.5);
    expect(offer.createdAt).toBe("2026-09-01T10:00:00.000Z");
    expect(Number.isNaN(new Date(offer.createdAt).getTime())).toBe(false);
    expect(offer.userId).toBe("usr_9");
    expect(offer.lockedBanana).toBe(500);
  });

  it("never yields NaN for a figure that will be compared or bound into SQL", () => {
    // D1 rejects an undefined bind outright, and NaN makes every comparison
    // false — which is how a broken read became a job that silently did nothing.
    const offer = toBananaMarketOffer({} as BananaMarketOfferRow);
    for (const value of [offer.priceIqd, offer.lockedBanana, offer.quantity]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(offer.userId).toBe("");
  });

  it("computes a real deviation and waiting period", () => {
    // The exact arithmetic the job does.
    const marketPrice = 5;
    const offer = toBananaMarketOffer(offerRow);
    const deviation = (marketPrice - offer.priceIqd) / marketPrice;
    const waitingMinutes = Math.max(10, 60 - deviation * 100);
    expect(deviation).toBeCloseTo(0.5);
    expect(waitingMinutes).toBe(10);
  });
});

describe("a bot as the trading job reads it", () => {
  it("carries the budget the spend is checked against", () => {
    const bot = toBananaBot(botRow);
    // `bot.budgetIqd < offer.priceIqd` was `undefined < undefined` — false, so
    // the budget check passed for every bot no matter what it could afford.
    expect(bot.budgetIqd).toBe(50000);
    expect(bot.maxTradeBanana).toBe(1000);
    expect(bot.isActive).toBe(true);
  });

  it("leaves an unset limit unset, so `if (limit)` still means 'no limit'", () => {
    const bot = toBananaBot(botRow);
    expect(bot.maxTotalBanana).toBeUndefined();
    expect("maxTotalBanana" in bot).toBe(false);
  });

  it("treats a missing budget as nothing to spend, not as unlimited", () => {
    const bot = toBananaBot({ ...botRow, budget_iqd: null });
    expect(bot.budgetIqd).toBe(0);
    expect(bot.budgetIqd < toBananaMarketOffer(offerRow).priceIqd).toBe(true);
  });

  it("reads the active flag as a boolean, not a number", () => {
    expect(toBananaBot({ ...botRow, is_active: 0 }).isActive).toBe(false);
    expect(toBananaBot({ ...botRow, is_active: null }).isActive).toBe(false);
  });
});
