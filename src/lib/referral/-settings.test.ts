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
    expect(DEFAULT_REFERRAL_SETTINGS.eligibleCategories).toEqual(["game"]);
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
      ["game"],
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

  it("refuses the online account", () => {
    const verdict = evaluateReferralLine({
      settings,
      product: GAME,
      line: { ...OFFLINE, optionId: "online_account", typeId: "standard_online" },
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("not_offline_account");
  });

  it("refuses hardware, cards, accessories and used stock", () => {
    for (const [category, kind] of [
      ["cat_hardware", "hardware"],
      ["cat_gift_cards", "digital_code"],
      ["cat_accessories", "accessory"],
      ["cat_used", "used"],
      ["cat_amiibo", "collectible"],
    ] as [string, string][]) {
      const verdict = evaluateReferralLine({
        settings,
        product: { ...GAME, category, kind },
        line: { ...OFFLINE, kind },
      });
      expect(verdict.eligible).toBe(false);
    }
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

  it("pays only on the game the link was shared for", () => {
    const verdict = evaluateReferralLine({
      settings,
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
