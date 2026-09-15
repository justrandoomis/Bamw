import { getStoreSettings } from "./db.server";

/**
 * USD → IQD conversion, read from the admin-configured store setting.
 *
 * The wallet balance is denominated in IQD everywhere in the app, so any
 * top-up priced in dollars has to be converted before it touches the balance.
 * The rate the admin sets in the dashboard (`usdExchangeRate`) is the single
 * source of truth; the storefront reads the same value through
 * `/api/exchange-rates`, so the amount quoted to a member before they pay is
 * the amount they are credited.
 */
export const DEFAULT_USD_IQD_RATE = 1320;

/** Guardrail: a mistyped rate must not silently mint or destroy balance. */
const MIN_RATE = 100;
const MAX_RATE = 100_000;

export function normalizeUsdIqdRate(value: unknown): number {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < MIN_RATE || rate > MAX_RATE) {
    return DEFAULT_USD_IQD_RATE;
  }
  return rate;
}

export async function getUsdIqdRate(): Promise<number> {
  /*
    One number, off the base `store` row. Reading it through `getStore()` meant
    parsing the whole catalogue and normalising every product first — which is
    most of the 162 ms `/api/exchange-rates` was measured at.
  */
  const settings = await getStoreSettings();
  return normalizeUsdIqdRate(settings["usdExchangeRate"]);
}

/** Convert a USD amount to whole IQD. Rounded down so a rate change can never overpay. */
export function usdToIqd(amountUsd: number, rate: number): number {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return 0;
  return Math.floor(amountUsd * normalizeUsdIqdRate(rate));
}
