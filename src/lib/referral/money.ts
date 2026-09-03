/**
 * Referral money, in whole dinars.
 *
 * Every figure in this programme is Iraqi dinars, and IQD has no subunit in
 * this store — prices are stored and displayed as integers. Percentages are
 * therefore never floating point: a rate is basis points (1000 bps = 10%) and
 * an amount is `floor(price * bps / 10000)`, which keeps the arithmetic exact
 * for any price the catalogue can hold and always rounds in the shop's favour
 * rather than a fraction of a dinar the wallet cannot represent.
 */

/** 100% in basis points. */
export const BPS_DENOMINATOR = 10_000;

/** The programme's default rate for both sides: 10%. */
export const DEFAULT_PERCENT_BPS = 1_000;

/**
 * The buyer's discount: 10%, and only on their first qualifying order, ever.
 */
export const BUYER_PERCENT_BPS = 1_000;

/**
 * The referrer's share: 5%, fixed.
 *
 * Fixed in code rather than read from the store settings because the rule is
 * that it is fixed. Production still carries a `referrerPercentBps` of 1000
 * from the programme's first version; leaving that readable would have paid
 * 10% while the rule said 5%, so the setting is no longer consulted for this
 * side and the admin screen no longer offers it.
 *
 * Unlike the buyer's discount this is paid on *every* qualifying order the
 * referred member ever places, not only the first.
 */
export const REFERRER_PERCENT_BPS = 500;

/** Largest order line this arithmetic will accept, as a sanity bound. */
const MAX_PRICE_IQD = 1_000_000_000;

/** A percentage given as a whole percent (10) turned into basis points. */
export function percentToBps(percent: unknown): number | undefined {
  const value = Number(percent);
  if (!Number.isFinite(value)) return undefined;
  const bps = Math.round(value * 100);
  if (bps < 0 || bps > BPS_DENOMINATOR) return undefined;
  return bps;
}

/** Basis points read back as whole percent, for display only. */
export function bpsToPercent(bps: number): number {
  return Math.round((bps / BPS_DENOMINATOR) * 1000) / 10;
}

/** Coerce anything to a whole, non-negative dinar amount. */
export function toIqd(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(MAX_PRICE_IQD, Math.floor(parsed));
}

/** Coerce anything to basis points inside [0, 10000]. */
export function toBps(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(BPS_DENOMINATOR, Math.floor(parsed));
}

/**
 * `amount × bps / 10000`, floored.
 *
 * Integer throughout: the multiplication happens before the division, so
 * 10,000 IQD at 1000 bps is exactly 1,000 and never 999.9999999999999.
 */
export function applyBps(amountIqd: number, bps: number): number {
  const amount = toIqd(amountIqd);
  const rate = toBps(bps);
  if (amount === 0 || rate === 0) return 0;
  return Math.floor((amount * rate) / BPS_DENOMINATOR);
}

export interface ReferralAmountsInput {
  /** The catalogue price of the qualifying line, before any referral discount. */
  originalPriceIqd: number;
  buyerPercentBps: number;
  referrerPercentBps: number;
  /** Cap on the referrer's reward. Zero or absent means no cap. */
  maxRewardIqd?: number;
}

export interface ReferralAmounts {
  originalPriceIqd: number;
  buyerDiscountIqd: number;
  referrerRewardIqd: number;
  buyerPaysIqd: number;
  buyerPercentBps: number;
  referrerPercentBps: number;
}

/**
 * Both sides of one referral.
 *
 * The reward is taken from the **original** price, not from what the buyer
 * ended up paying — a 10,000 dinar game discounts 1,000 for the buyer and pays
 * the referrer 1,000, not 900. The buyer's discount can never exceed the price
 * itself, so a rate of 100% leaves a zero-dinar line rather than a negative one.
 */
export function referralAmounts(input: ReferralAmountsInput): ReferralAmounts {
  const originalPriceIqd = toIqd(input.originalPriceIqd);
  const buyerPercentBps = toBps(input.buyerPercentBps);
  const referrerPercentBps = toBps(input.referrerPercentBps);

  const buyerDiscountIqd = Math.min(originalPriceIqd, applyBps(originalPriceIqd, buyerPercentBps));
  const uncappedReward = applyBps(originalPriceIqd, referrerPercentBps);
  const cap = toIqd(input.maxRewardIqd ?? 0);
  const referrerRewardIqd = cap > 0 ? Math.min(cap, uncappedReward) : uncappedReward;

  return {
    originalPriceIqd,
    buyerDiscountIqd,
    referrerRewardIqd,
    buyerPaysIqd: originalPriceIqd - buyerDiscountIqd,
    buyerPercentBps,
    referrerPercentBps,
  };
}

/**
 * The share of a reward that a partial refund takes back.
 *
 * `refundedIqd / paidIqd` of the reward, rounded up so the shop never leaves
 * a dinar of an unearned reward behind, and never more than the reward itself.
 */
export function reversalAmount(rewardIqd: number, refundedIqd: number, paidIqd: number): number {
  const reward = toIqd(rewardIqd);
  const refunded = toIqd(refundedIqd);
  const paid = toIqd(paidIqd);
  if (reward === 0 || refunded === 0) return 0;
  if (paid === 0 || refunded >= paid) return reward;
  return Math.min(reward, Math.ceil((reward * refunded) / paid));
}
