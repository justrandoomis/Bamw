/**
 * One dollar rate for the whole shop.
 *
 * Production held two: «إعدادات السعر» wrote `usdExchangeRate` (1320) and the
 * currency screen wrote `usd_iqd_rate` (1550) that nothing read; game pages
 * used a bundled 1310. And a $20 eShop card top-up was credited as 23 IQD.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_USD_IQD_RATE,
  rechargeCredit,
  resolveUsdIqdRate,
  usdIqdRateSettings,
} from "./exchange-rate";

describe("resolveUsdIqdRate", () => {
  it("reads the canonical key first", () => {
    expect(resolveUsdIqdRate({ usdExchangeRate: 1480, usd_iqd_rate: 1550 })).toBe(1480);
  });

  it("reads the legacy key a shop may only ever have saved", () => {
    expect(resolveUsdIqdRate({ usd_iqd_rate: 1550 })).toBe(1550);
    expect(resolveUsdIqdRate({ usdExchangeRate: 0, usd_iqd_rate: 1550 })).toBe(1550);
  });

  it("refuses a mistyped rate and falls back", () => {
    expect(resolveUsdIqdRate({ usdExchangeRate: 1.5 })).toBe(DEFAULT_USD_IQD_RATE);
    expect(resolveUsdIqdRate({ usdExchangeRate: "abc" })).toBe(DEFAULT_USD_IQD_RATE);
    expect(resolveUsdIqdRate(undefined)).toBe(DEFAULT_USD_IQD_RATE);
  });

  it("is saved under both spellings, as one number", () => {
    expect(usdIqdRateSettings(1550)).toEqual({ usdExchangeRate: 1550, usd_iqd_rate: 1550 });
  });
});

describe("rechargeCredit", () => {
  const settings = { usdExchangeRate: 1500, nintendoBonusPercent: 15 };

  it("converts an eShop card's dollars, bonus included, at the shop's rate", () => {
    // $20 + 15% = $23 → 34,500 IQD; it used to credit 23.
    const credit = rechargeCredit("eshop_card", 20, settings);
    expect(credit).toMatchObject({ credited: 34_500, dollars: true, bonusPercent: 15, rate: 1500 });
  });

  it("converts a crypto transfer without a bonus", () => {
    expect(rechargeCredit("crypto", 10, settings).credited).toBe(15_000);
  });

  it("leaves dinar methods as they were", () => {
    expect(rechargeCredit("zain_cash", 25_000, settings)).toMatchObject({
      credited: 25_000,
      dollars: false,
    });
  });

  it("never converts an amount that is already dinars", () => {
    expect(rechargeCredit("crypto", 30_000, settings)).toMatchObject({
      credited: 30_000,
      dollars: false,
    });
  });

  it("respects a switched-off bonus", () => {
    expect(
      rechargeCredit("eshop_card", 10, { ...settings, nintendoBonusEnabled: false }).credited,
    ).toBe(15_000);
  });
});
