import { useMemo, useState } from "react";
import { ExternalLink, Globe, Lock, RefreshCw, ShieldCheck, TrendingDown } from "lucide-react";
import type { RegionCode, StoreOffer } from "@/hub/types";
import type { RankedOffer } from "@/hub/utils/priceIntelligence";
import { Segmented } from "@/hub/ui/Bits";
import { Panel } from "@/hub/ui/Panel";
import { useI18n } from "@/hub/i18n";
import { useCurrency } from "@/hub/context/CurrencyContext";
import { formatDate, formatRelativeTime } from "@/hub/utils/format";
import { cn } from "@/hub/utils/cn";

/**
 * "Where should I buy it?"
 *
 * Every row shows the store's own currency as the authoritative price and the
 * converted figure underneath, marked approximate. Region-locked offers carry
 * the account requirement inline — the single most common reason a cheap
 * regional price turns out to be unusable.
 */

interface Props {
  ranked: RankedOffer[];
  region: RegionCode | "ALL";
  onRegionChange: (region: RegionCode | "ALL") => void;
  availableRegions: RegionCode[];
  updatedAt: string | null;
  isRefreshing?: boolean;
  onBuy?: (offer: StoreOffer) => void;
  editionNames?: Map<string, string>;
}

export default function GlobalPriceTracker({
  ranked,
  region,
  onRegionChange,
  availableRegions,
  updatedAt,
  isRefreshing,
  onBuy,
  editionNames,
}: Props) {
  const { t, intlLocale } = useI18n();
  const { formatNative, formatConverted, currency } = useCurrency();
  const [showAll, setShowAll] = useState(false);

  const availabilityLabels: Record<StoreOffer["availability"], string> = {
    "in-stock": t("prices.inStock"),
    "low-stock": t("prices.lowStock"),
    "out-of-stock": t("prices.outOfStock"),
    preorder: t("prices.preorder"),
    delisted: t("prices.delisted"),
  };

  const formatLabels: Record<StoreOffer["format"], string> = {
    "digital-code": t("nintendo.digital"),
    "digital-account": t("nintendo.digital"),
    physical: t("nintendo.physical"),
    subscription: t("nintendo.nso"),
  };

  const regionOptions = useMemo(
    () => [
      { id: "ALL" as const, label: t("prices.allRegions"), count: ranked.length },
      ...availableRegions.map((code) => ({ id: code, label: code })),
    ],
    [availableRegions, ranked.length, t],
  );

  // Our own offers lead the table: they are the ones that can actually be bought
  // here, and they are the cheapest by policy. Everything else keeps its rank.
  const ordered = useMemo(
    () =>
      [...ranked].sort(
        (a, b) => Number(b.offer.firstParty ?? false) - Number(a.offer.firstParty ?? false),
      ),
    [ranked],
  );

  const visible = showAll ? ordered : ordered.slice(0, 6);

  if (ranked.length === 0) {
    return (
      <p className="rounded-2xl bg-muted/50 p-6 text-center text-sm muted">
        {t("prices.noOffers")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          size="sm"
          value={region}
          onChange={onRegionChange}
          ariaLabel={t("prices.region")}
          options={regionOptions}
        />
        {updatedAt && (
          <span className="flex items-center gap-1.5 text-[11px] muted">
            <RefreshCw className={cn("h-3 w-3", isRefreshing && "animate-spin")} />
            {t("prices.lastUpdated")} {formatRelativeTime(updatedAt, intlLocale)}
          </span>
        )}
      </div>

      <Panel className="overflow-hidden">
        {/* Header row — desktop only; the mobile layout is a stacked list. */}
        <div className="hidden border-b border-border/70 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider muted lg:grid lg:grid-cols-[1.6fr_0.7fr_1fr_0.8fr_1fr_auto] lg:gap-3">
          <span>{t("prices.store")}</span>
          <span>{t("prices.region")}</span>
          <span>{t("prices.edition")}</span>
          <span>{t("prices.format")}</span>
          <span className="text-end">{t("prices.price")}</span>
          <span className="w-24" />
        </div>

        <ul>
          {visible.map(({ offer, isBest }, index) => {
            const unavailable =
              offer.availability === "out-of-stock" || offer.availability === "delisted";
            return (
              <li
                key={`${offer.id || offer.storeName}-${index}`}
                className={cn(
                  "relative border-b border-border/70 px-4 py-3.5 transition-colors last:border-b-0",
                  "lg:grid lg:grid-cols-[1.6fr_0.7fr_1fr_0.8fr_1fr_auto] lg:items-center lg:gap-3",
                  (isBest || offer.firstParty) && "bg-good/[0.06]",
                  unavailable && "opacity-55",
                )}
              >
                {(isBest || offer.firstParty) && (
                  <span className="absolute inset-y-0 start-0 w-[3px] bg-good" aria-hidden />
                )}

                {/* Store */}
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-bold">{offer.storeName}</span>
                      {offer.official && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-good" />}
                    </span>
                    {offer.firstParty ? (
                      <span className="mt-0.5 flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-good">
                        <TrendingDown className="h-3 w-3" />
                        {t("prices.ourStore")}
                      </span>
                    ) : isBest ? (
                      <span className="mt-0.5 flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-good">
                        <TrendingDown className="h-3 w-3" />
                        {t("prices.bestPrice")}
                      </span>
                    ) : null}
                  </span>
                </div>

                {/* Region */}
                <div className="mt-2 flex items-center gap-1.5 text-xs lg:mt-0">
                  <Globe className="h-3 w-3 muted lg:hidden" />
                  <span className="font-semibold">{offer.region}</span>
                  {offer.regionLocked && (
                    <span title={t("prices.regionLockedNote")}>
                      <Lock className="h-3 w-3 text-warn" />
                    </span>
                  )}
                </div>

                {/* Edition */}
                <div className="mt-1 truncate text-xs muted lg:mt-0">
                  {offer.editionId ? (editionNames?.get(offer.editionId) ?? offer.editionId) : "—"}
                </div>

                {/* Format */}
                <div className="mt-1 text-xs muted lg:mt-0">{formatLabels[offer.format]}</div>

                {/* Price */}
                <div className="mt-2 lg:mt-0 lg:text-end">
                  <div className="flex items-baseline gap-2 lg:justify-end">
                    <span className={cn("num text-base font-extrabold", isBest && "text-good")}>
                      {formatNative(offer.price)}
                    </span>
                    {offer.discountPercent != null && (
                      <span className="num rounded bg-good/15 px-1.5 py-0.5 text-[10px] font-extrabold text-good">
                        −{offer.discountPercent}%
                      </span>
                    )}
                  </div>
                  {offer.price.currency !== currency && (
                    <span className="block text-[11px] muted lg:text-end">
                      <span className="num">≈ {formatConverted(offer.price)}</span>
                    </span>
                  )}
                  {offer.listPrice && (
                    <span className="block text-[11px] muted lg:text-end">
                      <span className="num line-through">{formatNative(offer.listPrice)}</span>
                    </span>
                  )}
                </div>

                {/* Action */}
                <div className="mt-3 flex items-center gap-2 lg:mt-0 lg:w-24 lg:justify-end">
                  {unavailable ? (
                    <span className="text-[11px] font-bold muted">
                      {availabilityLabels[offer.availability]}
                    </span>
                  ) : offer.firstParty && onBuy ? (
                    <button
                      onClick={() => onBuy(offer)}
                      className="btn btn-primary h-9 w-full px-3 text-xs lg:w-auto"
                    >
                      {t("hero.buyNow")}
                    </button>
                  ) : (
                    <a
                      href={offer.url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="btn btn-quiet h-9 w-full px-3 text-xs lg:w-auto"
                    >
                      {t("prices.goToStore")}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                {/* Row footnotes */}
                {(offer.regionLocked || offer.notes || offer.saleEndsAt) && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] muted lg:col-span-6">
                    {offer.regionLocked && offer.accountRegionRequired && (
                      <span className="text-warn">
                        {t("prices.regionLocked")}: {offer.accountRegionRequired}
                      </span>
                    )}
                    {offer.saleEndsAt && (
                      <span>
                        {t("prices.saleEnds")} {formatDate(offer.saleEndsAt, intlLocale)}
                      </span>
                    )}
                    {offer.notes && <span>{offer.notes}</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {ranked.length > 6 && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="w-full border-t border-border/70 py-3 text-xs font-bold text-nin-soft transition-colors hover:bg-muted/60"
          >
            {showAll ? t("common.showLess") : `${t("common.viewAll")} (${ranked.length})`}
          </button>
        )}
      </Panel>

      <p className="text-[11px] muted">{t("prices.autoUpdate")}</p>
    </div>
  );
}
