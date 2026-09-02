/**
 * `banana_market_offers` and `banana_bots` rows, as D1 stores them, and the
 * objects the application reads.
 *
 * The columns are snake_case and `BananaMarketOffer` / `BananaBot` are
 * camelCase, so `SELECT *` with a cast produces an object whose every
 * multi-word field is `undefined`. That is not a cosmetic problem here: the
 * bot-trading job compared `marketPrice - offer.priceIqd`, got NaN, and its
 * `nowTime - offerTime > waitingMinutes * 60_000` test was NaN > NaN — false,
 * forever. The market-making bots have never bought a single offer.
 *
 * Only `id`, `name`, `quantity` and `status` survived the cast, because those
 * column names happen to be one word.
 */

import type { BananaBot, BananaMarketOffer, BananaMarketOfferStatus } from "./types";

/** Exactly the columns of `banana_market_offers`. */
export interface BananaMarketOfferRow {
  id: string;
  user_id: string;
  quantity: number;
  price_iqd: number;
  locked_banana: number;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Exactly the columns of `banana_bots`. */
export interface BananaBotRow {
  id: string;
  name: string;
  budget_iqd: number | null;
  max_trade_banana: number | null;
  daily_limit_banana: number | null;
  max_total_banana: number | null;
  min_price_iqd: number | null;
  max_purchase_price_iqd: number | null;
  delay_strategy_json: string | null;
  trading_schedule_json: string | null;
  is_active: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * A number, or 0.
 *
 * Money and quantities are compared and bound into SQL. `undefined` binds are
 * rejected by D1 outright, and a NaN silently makes every comparison false —
 * which is exactly how a broken read turned into a job that did nothing at all
 * rather than a job that threw.
 */
function amount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** An optional numeric limit: absent stays absent, so `if (limit)` still works. */
function optionalAmount(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function toBananaMarketOffer(row: BananaMarketOfferRow): BananaMarketOffer {
  return {
    id: String(row.id),
    userId: String(row.user_id ?? ""),
    quantity: amount(row.quantity),
    priceIqd: amount(row.price_iqd),
    lockedBanana: amount(row.locked_banana),
    status: String(row.status ?? "active") as BananaMarketOfferStatus,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export function toBananaBot(row: BananaBotRow): BananaBot {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    budgetIqd: amount(row.budget_iqd),
    ...(optionalAmount(row.max_trade_banana) !== undefined
      ? { maxTradeBanana: optionalAmount(row.max_trade_banana) }
      : {}),
    ...(optionalAmount(row.daily_limit_banana) !== undefined
      ? { dailyLimitBanana: optionalAmount(row.daily_limit_banana) }
      : {}),
    ...(optionalAmount(row.max_total_banana) !== undefined
      ? { maxTotalBanana: optionalAmount(row.max_total_banana) }
      : {}),
    ...(optionalAmount(row.min_price_iqd) !== undefined
      ? { minPriceIqd: optionalAmount(row.min_price_iqd) }
      : {}),
    ...(optionalAmount(row.max_purchase_price_iqd) !== undefined
      ? { maxPurchasePriceIqd: optionalAmount(row.max_purchase_price_iqd) }
      : {}),
    ...(row.delay_strategy_json ? { delayStrategyJson: String(row.delay_strategy_json) } : {}),
    ...(row.trading_schedule_json ? { tradingScheduleJson: String(row.trading_schedule_json) } : {}),
    isActive: Number(row.is_active) === 1,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}
