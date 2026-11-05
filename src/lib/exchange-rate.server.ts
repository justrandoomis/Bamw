import { getStoreSettings } from "./db.server";
import {
  DEFAULT_USD_IQD_RATE,
  normalizeUsdIqdRate,
  resolveUsdIqdRate,
  usdToIqd,
} from "./exchange-rate";

/**
 * USD → IQD conversion, read from the admin-configured store setting.
 *
 * The wallet balance is denominated in IQD everywhere in the app, so any
 * top-up priced in dollars has to be converted before it touches the balance.
 * The rule for which setting is the rate lives in `./exchange-rate.ts`, shared
 * with the storefront, the game pages and the admin screens, so the amount
 * quoted to a member before they pay is the amount they are credited.
 */
export { DEFAULT_USD_IQD_RATE, normalizeUsdIqdRate, usdToIqd };

export async function getUsdIqdRate(): Promise<number> {
  /*
    One number, off the base `store` row. Reading it through `getStore()` meant
    parsing the whole catalogue and normalising every product first — which is
    most of the 162 ms `/api/exchange-rates` was measured at.
  */
  const settings = await getStoreSettings();
  return resolveUsdIqdRate(settings);
}
