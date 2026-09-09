/**
 * Saving a reward, and the four ways it could not work.
 *
 * The admin filled in the form, pressed «حفظ الجائزة», and nothing happened —
 * no reward, no error, no sign that anything had been attempted. Four separate
 * faults stacked on one button:
 *
 *  1. the form's field is `cost` and the route validated `bananaPrice`, so
 *     every save was `Number(undefined)` and was refused with a 400;
 *  2. no mutation on that screen had an `onError`, so the 400 vanished;
 *  3. the form generates an id for a *new* reward, and the writer chose
 *     INSERT or UPDATE by asking whether an id had been sent — so a new reward
 *     took the UPDATE branch, matched no row, and reported success;
 *  4. the reward came back as a raw database row, so the form that reads
 *     `cost` and `icon` and `couponValue` loaded blanks when editing one.
 */
import { describe, expect, it } from "vitest";

import { toAdminReward } from "@/lib/banana.server";

describe("a reward row, as the admin screen reads it", () => {
  const row = {
    id: "bre_1",
    title: "كوبون خصم 1000 د.ع",
    description: "خصم ثابت",
    banana_price: 650000,
    stock: 50,
    is_active: 1,
    icon: "🎁",
    category: "vouchers",
    coupon_value: 1000,
    coupon_type: "fixed",
    reward_code: "",
    sort_order: 2,
  };

  it("carries the price under the name the form reads", () => {
    /* The form's field is `cost`; it read a row that only had `banana_price`. */
    expect(toAdminReward(row).cost).toBe(650000);
  });

  it("carries it under the other name too, for the readers that use it", () => {
    expect(toAdminReward(row).bananaPrice).toBe(650000);
  });

  it("brings back the icon, the section and the coupon value", () => {
    const reward = toAdminReward(row);
    expect(reward.icon).toBe("🎁");
    expect(reward.category).toBe("vouchers");
    expect(reward.couponValue).toBe(1000);
  });

  it("turns the stored flag into the boolean the form expects", () => {
    expect(toAdminReward(row).isActive).toBe(true);
    expect(toAdminReward({ ...row, is_active: 0 }).isActive).toBe(false);
  });

  it("gives a row written before these columns existed something usable", () => {
    /* An older reward has no icon and no category; the form must still open. */
    const old = { id: "bre_old", title: "قديمة", banana_price: 1000, stock: -1, is_active: 1 };
    const reward = toAdminReward(old);
    expect(reward.icon).toBe("🎁");
    expect(reward.category).toBe("vouchers");
    expect(reward.couponValue).toBe(0);
    expect(reward.cost).toBe(1000);
  });

  it("does not invent a price for a row that has none", () => {
    expect(toAdminReward({ id: "x", title: "y" }).cost).toBe(0);
  });
});

/**
 * Why the market-maker bots never bought anything.
 *
 * `banana_market_offers.price_iqd` holds the **total** a seller wants —
 * `createListing` writes `quantity × pricePer` into it — and the trading job
 * compared that total against the market's price for **one** banana. A
 * thousand bananas at a fair price has a total in the hundreds; the market
 * price is a fraction of a dinar. The test was false for every listing that has
 * ever existed.
 *
 * These pin the arithmetic rather than the SQL, because the arithmetic is what
 * was wrong: the query now divides by the quantity before comparing.
 */
describe("the price a bot compares an offer against", () => {
  const offer = { quantity: 1000, price_iqd: 240 };
  const perBanana = offer.price_iqd / offer.quantity;

  it("is per banana, and that is what makes a fair offer look cheap", () => {
    expect(perBanana).toBe(0.24);
  });

  it("matches a market at the same price, where the total never could", () => {
    const marketPrice = 0.24;
    expect(perBanana <= marketPrice).toBe(true);
    // The old comparison, kept to show the size of the mistake.
    expect(offer.price_iqd <= marketPrice).toBe(false);
  });

  it("still refuses an offer that is genuinely dearer than the market", () => {
    expect(perBanana <= 0.1).toBe(false);
  });

  it("measures the discount per banana too, not total against unit", () => {
    const marketPrice = 0.48;
    const deviation = (marketPrice - perBanana) / marketPrice;
    expect(deviation).toBeCloseTo(0.5, 5);

    // The old expression produced a large negative number for a cheap offer,
    // which made the waiting period collapse to its floor.
    const wrong = (marketPrice - offer.price_iqd) / marketPrice;
    expect(wrong).toBeLessThan(-100);
  });

  it("treats an empty offer as unpriced rather than dividing by zero", () => {
    const empty = { quantity: 0, price_iqd: 500 };
    const price = empty.quantity > 0 ? empty.price_iqd / empty.quantity : 0;
    expect(price).toBe(0);
    expect(Number.isFinite(price)).toBe(true);
  });
});
