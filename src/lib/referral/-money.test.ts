/**
 * @vitest-environment node
 */
/**
 * The arithmetic, in whole dinars.
 *
 * IQD has no subunit in this store, and a referral is a percentage of a price
 * — which is exactly the shape that produces 999.9999999999999 in floating
 * point and a wallet balance nobody can explain. Basis points and integer
 * multiplication before division are what keep it exact.
 */

import { describe, expect, it } from "vitest";

import {
  applyBps,
  bpsToPercent,
  percentToBps,
  referralAmounts,
  reversalAmount,
  toBps,
  toIqd,
} from "./money";

describe("percentages as basis points", () => {
  it("reads 10% as 1000 bps and back", () => {
    expect(percentToBps(10)).toBe(1000);
    expect(bpsToPercent(1000)).toBe(10);
  });

  it("refuses a rate that is not a rate", () => {
    expect(percentToBps("abc")).toBeUndefined();
    expect(percentToBps(-1)).toBeUndefined();
    expect(percentToBps(101)).toBeUndefined();
  });

  it("keeps a half-percent, which whole percent would lose", () => {
    expect(percentToBps(7.5)).toBe(750);
    expect(applyBps(20_000, 750)).toBe(1_500);
  });
});

describe("applyBps", () => {
  it("is exact where floating point is not", () => {
    // 0.1 * 10_000 in IEEE-754 is 1000.0000000000001.
    expect(applyBps(10_000, 1000)).toBe(1000);
    expect(Number.isInteger(applyBps(10_000, 1000))).toBe(true);
  });

  it("floors rather than rounds, so the shop never overpays a fraction", () => {
    expect(applyBps(12_345, 1000)).toBe(1234);
    expect(applyBps(1, 1000)).toBe(0);
  });

  it("treats nonsense as zero instead of NaN", () => {
    expect(applyBps(Number.NaN, 1000)).toBe(0);
    expect(applyBps(10_000, Number.NaN)).toBe(0);
    expect(toIqd("١٢")).toBe(0);
    expect(toBps("-5")).toBe(0);
  });
});

describe("the worked example from the specification", () => {
  it("10,000 IQD gives a 1,000 discount and a 1,000 reward", () => {
    const amounts = referralAmounts({
      originalPriceIqd: 10_000,
      buyerPercentBps: 1000,
      referrerPercentBps: 1000,
    });

    expect(amounts.originalPriceIqd).toBe(10_000);
    expect(amounts.buyerDiscountIqd).toBe(1_000);
    expect(amounts.buyerPaysIqd).toBe(9_000);
    expect(amounts.referrerRewardIqd).toBe(1_000);
  });

  it("pays the referrer from the original price, not the discounted one", () => {
    const amounts = referralAmounts({
      originalPriceIqd: 10_000,
      buyerPercentBps: 1000,
      referrerPercentBps: 1000,
    });
    // 10% of 9,000 would be 900. The reward is 10% of 10,000.
    expect(amounts.referrerRewardIqd).not.toBe(900);
    expect(amounts.referrerRewardIqd).toBe(1_000);
  });

  it("caps the reward when the admin set a ceiling", () => {
    const amounts = referralAmounts({
      originalPriceIqd: 100_000,
      buyerPercentBps: 1000,
      referrerPercentBps: 1000,
      maxRewardIqd: 5_000,
    });
    expect(amounts.buyerDiscountIqd).toBe(10_000);
    expect(amounts.referrerRewardIqd).toBe(5_000);
  });

  it("never discounts more than the price", () => {
    const amounts = referralAmounts({
      originalPriceIqd: 10_000,
      buyerPercentBps: 10_000,
      referrerPercentBps: 1000,
    });
    expect(amounts.buyerDiscountIqd).toBe(10_000);
    expect(amounts.buyerPaysIqd).toBe(0);
  });
});

describe("reversing a reward", () => {
  it("takes back the whole reward on a full refund", () => {
    expect(reversalAmount(1_000, 9_000, 9_000)).toBe(1_000);
  });

  it("takes back the refunded share on a partial one", () => {
    // Half the order came back, so half the reward goes with it.
    expect(reversalAmount(1_000, 4_500, 9_000)).toBe(500);
  });

  it("rounds a partial reversal up, so no dinar of it is left behind", () => {
    expect(reversalAmount(1_000, 1, 3)).toBe(334);
  });

  it("takes back nothing when nothing was refunded", () => {
    expect(reversalAmount(1_000, 0, 9_000)).toBe(0);
  });

  it("never takes back more than the reward", () => {
    expect(reversalAmount(1_000, 20_000, 9_000)).toBe(1_000);
  });
});
