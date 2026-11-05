import { createFileRoute } from "@tanstack/react-router";
import { getStoreSettings } from "@/lib/db.server";
import { DEFAULT_USD_IQD_RATE, resolveUsdIqdRate } from "@/lib/exchange-rate";
import { guard, json } from "@/lib/http.server";

/*
  The shop's own rate, and nothing else.

  This used to read the WHOLE catalogue (`getStore()`) to find one setting, so
  on a cold isolate the dollar rate waited behind five megabytes of products —
  and when that load hung, so did every price on the page. It also fell back
  to an outside feed's official rate (~1310) whenever the setting was missing,
  which is not the rate the shop sells at and not the one Binance credits at.
  The rate is a business setting; the shop states it, and every screen uses it.
*/
export const Route = createFileRoute("/api/exchange-rates")({
  server: {
    handlers: {
      GET: async () =>
        guard(async () => {
          try {
            const settings = await getStoreSettings();
            const rate = resolveUsdIqdRate(settings);
            return json({ rates: { USD: 1, IQD: rate }, usdIqdRate: rate, source: "shop" });
          } catch {
            return json({
              rates: { USD: 1, IQD: DEFAULT_USD_IQD_RATE },
              usdIqdRate: DEFAULT_USD_IQD_RATE,
              source: "default",
            });
          }
        }),
    },
  },
});
