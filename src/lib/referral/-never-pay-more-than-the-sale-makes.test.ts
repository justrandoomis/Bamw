/**
 * @vitest-environment node
 *
 * Which purchases a referral may be paid on, decided by arithmetic.
 *
 * A referred order gives up both halves at once: ten per cent off the friend's
 * price, ten per cent into the referrer's wallet. So the shop parts with a
 * fifth of a sale it still had to buy the stock for, and whether that is a
 * promotion or a loss is a fact about the margin.
 *
 * Measured against the live catalogue on 5 Sep 2026, over all 150 products:
 *
 *   | category  | products | margin min | median | max   | under 20% |
 *   |-----------|---------:|-----------:|-------:|------:|----------:|
 *   | game      |      141 |      40.6% |  82.1% | 91.5% |         0 |
 *   | gift_card |        8 |    -871.4% |   2.9% |  2.9% |         8 |
 *   | hardware  |        1 |      21.2% |  21.2% | 21.2% |         0 |
 *
 * The gift cards were kept out by name. That worked exactly as long as
 * somebody remembered to keep the list current — and the same list was
 * refusing hardware, amiibo, accessories and used stock by *kind* while the
 * admin's category whitelist said they were allowed, so the setting could not
 * change the outcome it appeared to control.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_REFERRAL_SETTINGS } from "./config";
import { evaluateReferralLine } from "./eligibility";

const settings = { ...DEFAULT_REFERRAL_SETTINGS };

/** A line for a product, priced by the record rather than by the caller. */
function line(productId: string, extra: Record<string, unknown> = {}) {
  return { productId, quantity: 1, unitPriceIqd: 0, ...extra };
}

describe("a sale the shop cannot afford to refer", () => {
  it("refuses a top-up card, whose margin is smaller than the giveaway", () => {
    // The $5 eShop card as production carries it: 7,500 against 6,800.
    const card = {
      id: "prd_eshop",
      category: "cat_gift_cards",
      kind: "digital_code",
      price: 7_500,
      cost: 6_800,
    };
    const verdict = evaluateReferralLine({ settings, product: card, line: line("prd_eshop") });
    expect(verdict.eligible).toBe(false);
  });

  it("refuses it on the arithmetic even when its category is allowed", () => {
    /*
      The list of excluded categories is the admin's dial, and an admin can
      turn it the wrong way. The margin floor is not a second opinion about
      the same question — it is the one thing that cannot be configured into
      selling at a loss.
    */
    const permissive = { ...settings, eligibleCategories: [...settings.eligibleCategories, "gift_card" as const] };
    const card = { id: "prd_eshop", category: "cat_gift_cards", price: 7_500, cost: 6_800 };
    const verdict = evaluateReferralLine({
      settings: permissive,
      product: card,
      line: line("prd_eshop"),
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("margin_too_thin");
  });

  it("allows a game, where the thinnest margin in the shop is twice the giveaway", () => {
    const game = {
      id: "prd_game",
      category: "cat_nintendo",
      kind: "account",
      price: 10_000,
      cost: 5_940, // 40.6%: the thinnest of the 141 games on record.
    };
    const verdict = evaluateReferralLine({ settings, product: game, line: line("prd_game") });
    expect(verdict.eligible).toBe(true);
  });

  it("judges the selection's price, not the record's headline", () => {
    /*
      The discount comes off what was actually chosen. A product whose cheap
      option undercuts its headline price has a thinner margin on that option
      than the record's own numbers suggest, and that is the one being sold.
    */
    const product = {
      id: "prd_thin_option",
      category: "cat_nintendo",
      kind: "account",
      price: 30_000,
      cost: 8_000,
      options: [{ id: "cheap", name: "خيار", price: 9_000 }],
    };
    expect(evaluateReferralLine({ settings, product, line: line("prd_thin_option") }).eligible).toBe(
      true,
    );
    const chosen = evaluateReferralLine({
      settings,
      product,
      line: line("prd_thin_option", { optionId: "cheap" }),
    });
    expect(chosen.eligible).toBe(false);
    expect(chosen.reason).toBe("margin_too_thin");
  });

  it("allows a product with no cost on record: unknown is not thin", () => {
    /*
      Refusing here would take the programme away from a whole catalogue the
      moment costs went unfilled. Every product live today carries one.
    */
    const product = { id: "prd_uncosted", category: "cat_nintendo", kind: "account", price: 10_000 };
    expect(evaluateReferralLine({ settings, product, line: line("prd_uncosted") }).eligible).toBe(
      true,
    );
  });
});

describe("the category whitelist actually decides the category", () => {
  /*
    Hardware, amiibo, accessories and used stock were listed as eligible
    categories and refused by kind at the same time. The setting looked like a
    decision that had been made and could not change the outcome.
  */
  const cases = [
    { id: "prd_console", category: "cat_hardware", kind: "hardware", price: 100_000, cost: 60_000 },
    { id: "prd_amiibo", category: "cat_amiibo", kind: "amiibo", price: 30_000, cost: 15_000 },
    { id: "prd_case", category: "cat_accessories", kind: "accessory", price: 12_000, cost: 5_000 },
  ];

  for (const product of cases) {
    it(`lets a ${product.kind} through when its category is allowed`, () => {
      const verdict = evaluateReferralLine({ settings, product, line: line(product.id) });
      expect(verdict.eligible).toBe(true);
    });

    it(`still refuses a ${product.kind} when its category is not`, () => {
      const verdict = evaluateReferralLine({
        settings: { ...settings, eligibleCategories: ["game"] },
        product,
        line: line(product.id),
      });
      expect(verdict.eligible).toBe(false);
      expect(verdict.reason).toBe("category_excluded");
    });
  }

  it("keeps refusing the kinds no setting should be able to allow", () => {
    /*
      A wallet top-up would pay a commission on money moving into the shop, and
      a marketplace listing is somebody else's stock — there is no margin of
      the shop's to pay out of. Neither is an admin's decision to make.
    */
    for (const kind of ["wallet_topup", "subscription", "marketplace", "service"]) {
      const product = { id: `prd_${kind}`, category: "cat_nintendo", kind, price: 50_000, cost: 1 };
      const verdict = evaluateReferralLine({ settings, product, line: line(`prd_${kind}`) });
      expect(verdict.eligible).toBe(false);
      expect(verdict.reason).toBe("kind_excluded");
    }
  });
});
