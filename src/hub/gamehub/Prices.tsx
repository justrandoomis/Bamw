import { useMemo } from "react";
import { Bell, LineChart } from "lucide-react";
import { useHub } from "./hubContext";
import { Section } from "@/hub/ui/Section";
import { Panel } from "@/hub/ui/Panel";
import { Reveal } from "@/hub/ui/Bits";
import GlobalPriceTracker from "@/hub/GlobalPriceTracker";
import PriceHistoryChart from "@/hub/PriceHistoryChart";
import { useI18n } from "@/hub/i18n";
import { useUser } from "@/hub/context/UserContext";
import { useCurrency } from "@/hub/context/CurrencyContext";
import { formatAmount } from "@/hub/utils/format";

/**
 * Price intelligence: the store comparison, the history chart, and the alert.
 *
 * Given `lead` weight and placed immediately after the hero — for this audience
 * "where do I buy it and is now a good time" outranks every other question on
 * the page.
 */
export function PricesSection() {
  const { t, intlLocale } = useI18n();
  const { currency } = useCurrency();
  const { getAlert } = useUser();
  const {
    game,
    ranked,
    region,
    setRegion,
    availableRegions,
    offersUpdatedAt,
    isRefreshingPrices,
    history,
    openAlert,
    openBuy,
  } = useHub();

  const editionNames = useMemo(
    () => new Map((game.editions ?? []).map((edition) => [edition.id, edition.name])),
    [game.editions],
  );

  const existingAlert = getAlert(game.slug);

  if ((game.offers ?? []).length === 0 && !history) return null;

  return (
    <Section
      id="prices"
      eyebrow={t("nav.prices")}
      title={t("prices.title")}
      subtitle={t("prices.subtitle")}
      weight="lead"
    >
      <Reveal>
        <GlobalPriceTracker
          ranked={ranked}
          region={region}
          onRegionChange={setRegion}
          availableRegions={availableRegions}
          updatedAt={offersUpdatedAt}
          isRefreshing={isRefreshingPrices}
          editionNames={editionNames}
          onBuy={(offer) => openBuy(offer.editionId)}
        />
      </Reveal>

      {history && (
        <Reveal delay={100}>
          <Panel className="mt-4 p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-base font-extrabold">
                <LineChart className="h-4 w-4 text-good" />
                {t("history.title")}
              </h3>
              <button
                onClick={openAlert}
                className="btn btn-quiet h-9 px-3.5 text-xs"
                aria-label={t("alert.title")}
              >
                <Bell className="h-3.5 w-3.5 text-warn" />
                {existingAlert
                  ? `${t("alert.active")} · ${formatAmount(existingAlert.targetAmount, existingAlert.currency, intlLocale)}`
                  : t("alert.notifyMe")}
              </button>
            </div>

            <PriceHistoryChart history={history} />

            <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-muted/50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-extrabold">{t("alert.title")}</p>
                <p className="mt-0.5 text-xs muted">{t("alert.subtitle")}</p>
              </div>
              <button onClick={openAlert} className="btn btn-quiet h-10 px-4 text-xs">
                <Bell className="h-4 w-4 text-warn" />
                {t("alert.notifyMe")}
              </button>
            </div>
          </Panel>
        </Reveal>
      )}

      {/* Converted figures are approximate; the store's own currency governs. */}
      <p className="mt-3 text-[11px] muted">
        {t("common.currency")}: {currency}
      </p>
    </Section>
  );
}
