/**
 * The shop's dollar rate — one number, read the same way on every screen.
 *
 * Prices are stored in whole Iraqi dinars. A dollar figure is only ever a
 * conversion of that, so the whole shop has to agree on ONE rate. It did not:
 *
 *   - «إعدادات السعر» saved `usdExchangeRate` (1320 in production);
 *   - «الإعدادات العامة وإعدادات العملة», the screen that calls itself the
 *     currency setting, saved `usd_iqd_rate` (the owner set 1550) — a key
 *     nothing ever read;
 *   - the game pages converted at a 1310 snapshot bundled into the app;
 *   - the storefront fell back to an outside feed's official rate, the wallet
 *     preview to 1500, Binance credits to 1320.
 *
 * So a customer switching to dollars saw a different price on the card, on
 * the game page and in the cart, and none of them was the owner's rate.
 *
 * `usdExchangeRate` is the canonical key. Both admin screens now edit it and
 * write the legacy key alongside, so older readers agree; a shop that only
 * ever saved the legacy key is still read correctly.
 */

export const DEFAULT_USD_IQD_RATE = 1320;

/** Guardrail: a mistyped rate (1.5, 15, 1500000) must not silently mint or destroy balance. */
const MIN_RATE = 100;
const MAX_RATE = 100_000;

export function isValidUsdIqdRate(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= MIN_RATE && rate <= MAX_RATE;
}

export function normalizeUsdIqdRate(value: unknown, fallback = DEFAULT_USD_IQD_RATE): number {
  return isValidUsdIqdRate(value) ? Number(value) : fallback;
}

/** The rate the shop runs on, from its settings document. */
export function resolveUsdIqdRate(settings: Record<string, unknown> | null | undefined): number {
  const canonical = settings?.["usdExchangeRate"];
  if (isValidUsdIqdRate(canonical)) return Number(canonical);
  const legacy = settings?.["usd_iqd_rate"];
  if (isValidUsdIqdRate(legacy)) return Number(legacy);
  return DEFAULT_USD_IQD_RATE;
}

/** What a screen saves: both spellings, the same number. */
export function usdIqdRateSettings(rate: number): { usdExchangeRate: number; usd_iqd_rate: number } {
  const value = normalizeUsdIqdRate(Math.round(Number(rate)));
  return { usdExchangeRate: value, usd_iqd_rate: value };
}

/** Convert a USD amount to whole IQD. Rounded down so a rate change can never overpay. */
export function usdToIqd(amountUsd: number, rate: number): number {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return 0;
  return Math.floor(amountUsd * normalizeUsdIqdRate(rate));
}

/**
 * Top-up methods whose amount the member types in DOLLARS.
 *
 * The sheet marks them (`dollars: true` in components/wallet/methods.ts) and
 * previews «(amount + bonus) × rate» in dinars — but the request stored the
 * dollar figure and approval credited it as dinars, so a $20 eShop card became
 * 23 IQD. Binance has its own path, which already converts.
 */
export const DOLLAR_RECHARGE_METHODS: ReadonlySet<string> = new Set(["eshop_card", "crypto"]);

export function isDollarRechargeMethod(method: string | null | undefined): boolean {
  return DOLLAR_RECHARGE_METHODS.has(String(method ?? ""));
}

/**
 * An amount of 10,000 or more cannot be a dollar card or transfer this shop
 * takes (eShop cards run $10–$100), so it is read as dinars already — a guard
 * against ever converting one figure twice.
 */
const DOLLAR_AMOUNT_CEILING = 10_000;

export interface RechargeCredit {
  /** Whole dinars the wallet receives. */
  credited: number;
  /** True when `amount` was dollars and has been converted. */
  dollars: boolean;
  bonusPercent: number;
  rate: number;
}

/**
 * What the wallet receives for a top-up request: the eShop bonus applied, and
 * a dollar amount converted at the shop's rate — the figure the top-up sheet
 * promised. One function for the approval and for the card the reviewer sees,
 * so the two cannot disagree.
 */
export function rechargeCredit(
  method: string,
  amount: number,
  settings: Record<string, unknown> | null | undefined,
): RechargeCredit {
  const rate = resolveUsdIqdRate(settings);
  const bonusPercent =
    method === "eshop_card" && settings?.["nintendoBonusEnabled"] !== false
      ? Number(settings?.["nintendoBonusPercent"] || 15)
      : 0;
  const withBonus = amount * (1 + bonusPercent / 100);
  const dollars = isDollarRechargeMethod(method) && amount < DOLLAR_AMOUNT_CEILING;
  return {
    credited: dollars ? usdToIqd(withBonus, rate) : withBonus,
    dollars,
    bonusPercent,
    rate,
  };
}
