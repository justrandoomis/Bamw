/**
 * @vitest-environment node
 */
/**
 * The programme's settings and its product rules, read as the server reads
 * them.
 *
 * `readReferralSettings` is total on purpose: the store's settings document is
 * a loose bag written by several generations of the admin screen, and a rate
 * that comes back `NaN` does not fail loudly — it quietly pays nobody. Every
 * malformed value here has to land on a default instead.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_REFERRAL_SETTINGS, readReferralSettings } from "./config";
import { evaluateReferralLine } from "./eligibility";

const OFFLINE = {
  productId: "prd_1",
  kind: "account",
  quantity: 1,
  unitPriceIqd: 10_000,
  optionId: "offline_account",
  typeId: "standard_offline",
};

const GAME = {
  id: "prd_1",
  title: "لعبة",
  price: 10_000,
  kind: "account",
  category: "cat_nintendo",
};

describe("reading the settings", () => {
  it("falls back to the safe defaults when nothing is configured", () => {
    expect(readReferralSettings(undefined)).toEqual(DEFAULT_REFERRAL_SETTINGS);
    expect(readReferralSettings({})).toEqual(DEFAULT_REFERRAL_SETTINGS);
  });

  it("ships the defaults the specification asks for", () => {
    expect(DEFAULT_REFERRAL_SETTINGS.buyerPercentBps).toBe(1000);
    expect(DEFAULT_REFERRAL_SETTINGS.referrerPercentBps).toBe(1000);
    expect(DEFAULT_REFERRAL_SETTINGS.linkTtlDays).toBe(30);
    expect(DEFAULT_REFERRAL_SETTINGS.firstPurchaseOnly).toBe(true);
    expect(DEFAULT_REFERRAL_SETTINGS.stackWithCoupon).toBe(false);
    /*
      Every section the shop sells, except the top-up cards: at 7,500 against a
      6,800 cost, ten per cent to the buyer and ten to the referrer is 1,500
      against a 700 margin, so a referred card would be sold at a loss. The
      card's own copy already says it is excluded from every promotion.
    */
    expect(DEFAULT_REFERRAL_SETTINGS.eligibleCategories).toEqual([
      "game",
      "hardware",
      "amiibo",
      "accessory",
      "used",
      "bundle",
    ]);
    expect(DEFAULT_REFERRAL_SETTINGS.eligibleCategories).not.toContain("gift_card");
    // Three days of hold, then the order must also be complete.
    expect(DEFAULT_REFERRAL_SETTINGS.holdDays).toBe(3);
    // The two rules that made the offer almost unreachable, now off.
    expect(DEFAULT_REFERRAL_SETTINGS.restrictToSharedProduct).toBe(false);
    expect(DEFAULT_REFERRAL_SETTINGS.offlineAccountsOnly).toBe(false);
  });

  it("reads whole percent from the admin form and basis points from storage", () => {
    expect(readReferralSettings({ referral: { buyerPercent: 15 } }).buyerPercentBps).toBe(1500);
    expect(readReferralSettings({ referral: { buyerPercentBps: 1500 } }).buyerPercentBps).toBe(1500);
  });

  it("keeps a rate of zero, which is a real choice", () => {
    expect(readReferralSettings({ referral: { referrerPercent: 0 } }).referrerPercentBps).toBe(0);
  });

  it("refuses nonsense rather than turning it into NaN", () => {
    const settings = readReferralSettings({
      referral: { buyerPercent: "abc", referrerPercent: null, linkTtlDays: "soon" },
    });
    expect(settings.buyerPercentBps).toBe(1000);
    expect(settings.referrerPercentBps).toBe(1000);
    expect(settings.linkTtlDays).toBe(30);
  });

  it("bounds a link window somebody typed as ten years", () => {
    expect(readReferralSettings({ referral: { linkTtlDays: 4000 } }).linkTtlDays).toBe(365);
    expect(readReferralSettings({ referral: { linkTtlDays: 0 } }).linkTtlDays).toBe(1);
  });

  it("refuses an empty category list, which would silently disable the programme", () => {
    expect(readReferralSettings({ referral: { eligibleCategories: [] } }).eligibleCategories).toEqual(
      DEFAULT_REFERRAL_SETTINGS.eligibleCategories,
    );
    expect(
      readReferralSettings({ referral: { eligibleCategories: ["game", "bundle", "nonsense"] } })
        .eligibleCategories,
    ).toEqual(["game", "bundle"]);
  });

  it("still reads the older flat keys", () => {
    const settings = readReferralSettings({
      referralEnabled: false,
      referralBuyerPercent: 20,
      referralOwnerPercent: 5,
    });
    expect(settings.enabled).toBe(false);
    expect(settings.buyerPercentBps).toBe(2000);
    expect(settings.referrerPercentBps).toBe(500);
  });
});

describe("which line earns", () => {
  const settings = DEFAULT_REFERRAL_SETTINGS;

  it("takes a game bought as an offline account", () => {
    const verdict = evaluateReferralLine({ settings, product: GAME, line: OFFLINE });
    expect(verdict.eligible).toBe(true);
    expect(verdict.buyerPercentBps).toBe(1000);
  });

  it("pays on an online account too, now the offer is not offline-only", () => {
    /*
      This rule refused every online account, every physical item and every
      card, so the offer survived only on an offline-account line of the exact
      shared game — which is why the code looked dead.
    */
    const verdict = evaluateReferralLine({
      settings,
      product: GAME,
      line: { ...OFFLINE, optionId: "online_account", typeId: "standard_online" },
    });
    expect(verdict.eligible).toBe(true);
  });

  it("still refuses one when the shop turns the offline-only rule back on", () => {
    const verdict = evaluateReferralLine({
      settings: { ...settings, offlineAccountsOnly: true },
      product: GAME,
      line: { ...OFFLINE, optionId: "online_account", typeId: "standard_online" },
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("not_offline_account");
  });

  /*
    This test used to assert the opposite, and it was agreeing with a bug.

    The settings list hardware, amiibo, accessories, used stock and bundles as
    eligible categories, and `EXCLUDED_KINDS` refused all five *by kind* — so
    the whitelist could not change the outcome it appeared to control, and this
    test called that correct. The kind list is structural impossibilities only
    now, and the category list is the dial.

    Cards are still refused, and twice over: their category is not in the list,
    and their margin could not take the giveaway even if it were.
  */
  it("takes the category whitelist at its word", () => {
    for (const [category, kind] of [
      ["cat_hardware", "hardware"],
      ["cat_accessories", "accessory"],
      ["cat_used", "used"],
      ["cat_amiibo", "collectible"],
    ] as [string, string][]) {
      const verdict = evaluateReferralLine({
        settings,
        // A 60% margin: comfortably clear of the twenty per cent given away.
        product: { ...GAME, category, kind, cost: 4_000 },
        line: { ...OFFLINE, kind },
      });
      expect(verdict.eligible).toBe(true);
    }
  });

  it("refuses a category the shop has taken out", () => {
    const verdict = evaluateReferralLine({
      settings,
      product: { ...GAME, category: "cat_gift_cards", kind: "digital_code" },
      line: { ...OFFLINE, kind: "digital_code" },
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("category_excluded");
  });

  it("refuses a wallet top-up or a subscription however it is filed", () => {
    for (const kind of ["wallet_topup", "topup", "recharge", "subscription", "membership"]) {
      const verdict = evaluateReferralLine({
        settings,
        product: { ...GAME, kind },
        line: { ...OFFLINE, kind },
      });
      expect(verdict.eligible).toBe(false);
      expect(verdict.reason).toBe("kind_excluded");
    }
  });

  it("refuses a marketplace listing that is not the shop's own stock", () => {
    const verdict = evaluateReferralLine({
      settings,
      product: { ...GAME, isMarketplace: true },
      line: OFFLINE,
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("marketplace_item");
  });

  it("refuses a product the admin took out of the programme", () => {
    const verdict = evaluateReferralLine({
      settings,
      product: { ...GAME, referralEligible: false },
      line: OFFLINE,
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("product_excluded");
  });

  it("honours a per-product rate override", () => {
    const verdict = evaluateReferralLine({
      settings,
      product: { ...GAME, referralBuyerPercent: 20, referralOwnerPercent: 5 },
      line: OFFLINE,
    });
    expect(verdict.eligible).toBe(true);
    expect(verdict.buyerPercentBps).toBe(2000);
    expect(verdict.referrerPercentBps).toBe(500);
  });

  it("pays on any eligible game, not only the one the link was shared for", () => {
    // A referral brings a customer to the shop, not to one shelf of it.
    const verdict = evaluateReferralLine({
      settings,
      product: GAME,
      line: OFFLINE,
      sharedProductId: "prd_other",
    });
    expect(verdict.eligible).toBe(true);
  });

  it("still narrows to the shared product when the shop asks for it", () => {
    const verdict = evaluateReferralLine({
      settings: { ...settings, restrictToSharedProduct: true },
      product: GAME,
      line: OFFLINE,
      sharedProductId: "prd_other",
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("not_the_shared_product");
  });

  it("refuses everything while the programme is switched off", () => {
    const verdict = evaluateReferralLine({
      settings: { ...settings, enabled: false },
      product: GAME,
      line: OFFLINE,
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("programme_disabled");
  });
});

describe("the same-address rule", () => {
  it("is on by default, as specified", () => {
    expect(DEFAULT_REFERRAL_SETTINGS.blockSameIp).toBe(true);
    expect(readReferralSettings({}).blockSameIp).toBe(true);
  });

  it("can be switched off by the admin", () => {
    expect(readReferralSettings({ referral: { blockSameIp: false } }).blockSameIp).toBe(false);
    // A string from a form field reads the same way as a boolean.
    expect(readReferralSettings({ referral: { blockSameIp: "false" } }).blockSameIp).toBe(false);
  });

  it("stays on for a value it cannot read, rather than off", () => {
    // Failing open on a protection is the wrong direction.
    expect(readReferralSettings({ referral: { blockSameIp: "maybe" } }).blockSameIp).toBe(true);
  });
});
