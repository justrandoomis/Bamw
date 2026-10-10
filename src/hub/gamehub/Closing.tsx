import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Bell,
  ChevronDown,
  Heart,
  Info,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useHub } from "./hubContext";
import { Section } from "@/hub/ui/Section";
import { Panel } from "@/hub/ui/Panel";
import { Reveal } from "@/hub/ui/Bits";
import { useI18n } from "@/hub/i18n";
import { useCurrency } from "@/hub/context/CurrencyContext";
import { formatDate, formatRelativeTime } from "@/hub/utils/format";
import { cn } from "@/hub/utils/cn";
import { playSound } from "@/hub/utils/audio";
import { cdnImage } from "@/lib/img";

/* -------------------------------------------------------------------------- */
/* FAQ                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * FAQ accordion.
 *
 * Rendered as real buttons with `aria-expanded` rather than `<details>` so the
 * open state can be animated and, more importantly, so the answers are present
 * in the DOM for the FAQPage structured data to correspond to.
 */
export function FaqSection() {
  const { t } = useI18n();
  const { game } = useHub();
  const [open, setOpen] = useState<string | null>(null);
  const faq = game.faq ?? [];

  if (faq.length === 0) return null;

  return (
    <Section id="faq" title={t("faq.title")} subtitle={t("faq.subtitle")} weight="primary">
      <Reveal>
        <Panel className="divide-y divide-border/70 overflow-hidden">
          {faq.map((item, index) => {
            const expanded = open === item.id;
            return (
              <div key={`${item.id || item.question}-${index}`}>
                <button
                  onClick={() => setOpen(expanded ? null : item.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-start transition-colors hover:bg-muted/60"
                >
                  <span className="text-sm font-bold">{item.question}</span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 muted transition-transform duration-300",
                      expanded && "rotate-180",
                    )}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="px-5 pb-4 text-sm leading-[1.75] muted">{item.answer}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </Panel>
      </Reveal>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Purchase & activation                                                      */
/* -------------------------------------------------------------------------- */

export function PurchaseSection() {
  const { t } = useI18n();
  const { game } = useHub();
  const purchase = game.purchase;

  if (!purchase) return null;

  return (
    <Section
      id="purchase"
      title={t("purchase.title")}
      subtitle={t("purchase.subtitle")}
      weight="primary"
    >
      {purchase.steps && purchase.steps.length > 0 && (
        <Reveal>
          <Panel className="overflow-hidden p-5 sm:p-6">
            <ol className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              {purchase.steps.map((step, index) => (
                <li key={`${step.title}-${index}`} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-nin text-xs font-extrabold text-white">
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold">{step.title}</span>
                    {step.detail && (
                      <span className="mt-0.5 block text-xs leading-relaxed muted">
                        {step.detail}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        </Reveal>
      )}

      <Reveal delay={80}>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Panel className="p-5">
            <dl className="space-y-3 text-xs">
              {purchase.supportedRegions && purchase.supportedRegions.length > 0 && (
                <div className="flex items-baseline justify-between gap-4 border-b border-border/70 pb-2.5">
                  <dt className="muted">{t("purchase.supportedRegions")}</dt>
                  <dd className="font-bold">{purchase.supportedRegions.join(" · ")}</dd>
                </div>
              )}
              {purchase.deliveryTime && (
                <div className="flex items-baseline justify-between gap-4 border-b border-border/70 pb-2.5">
                  <dt className="muted">{t("purchase.delivery")}</dt>
                  <dd className="font-bold text-good">{purchase.deliveryTime}</dd>
                </div>
              )}
              {purchase.accountRegionRequirement && (
                <div>
                  <dt className="mb-1 muted">{t("purchase.accountRegion")}</dt>
                  <dd className="leading-relaxed">{purchase.accountRegionRequirement}</dd>
                </div>
              )}
            </dl>
          </Panel>

          <div className="space-y-3">
            {purchase.warnings?.map((warning, index) => (
              <div
                key={`${warning}-${index}`}
                className="flex items-start gap-3 rounded-panel border border-warn/25 bg-warn/[0.08] p-4"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                <p className="text-xs leading-relaxed">
                  <span className="font-extrabold text-warn">{t("purchase.warning")}: </span>
                  {warning}
                </p>
              </div>
            ))}
            {purchase.notes && purchase.notes.length > 0 && (
              <Panel className="p-4">
                <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider muted">
                  <Info className="h-3 w-3" />
                  {t("purchase.notes")}
                </p>
                <ul className="space-y-1.5 text-xs leading-relaxed muted">
                  {purchase.notes.map((note, index) => (
                    <li key={`${note}-${index}`} className="flex gap-2">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-foreground/25" />
                      {note}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Final CTA                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * "Ready to play?" — the closing conversion block.
 *
 * Restates the live best price rather than a static number, so the last thing
 * on the page cannot disagree with the price table above it.
 */
export function FinalCta() {
  const { t, intlLocale } = useI18n();
  const { formatConverted } = useCurrency();
  const {
    game,
    bestOffer,
    isWishlisted,
    toggleWishlist,
    openBuy,
    openAlert,
    priceVerdict,
    offersUpdatedAt,
  } = useHub();

  return (
    <Reveal>
      <section className="relative my-10 overflow-hidden rounded-panel border border-nin/25">
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(135deg,rgba(230,0,18,0.22),rgba(230,0,18,0.04)_55%,transparent)]"
        />
        {game.keyArtUrl && (
          <img
            aria-hidden
            src={cdnImage(game.keyArtUrl)}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover opacity-[0.12]"
          />
        )}

        <div className="relative flex flex-col items-start gap-6 p-7 sm:p-10 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="eyebrow mb-2 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-warn" />
              {t("cta.bestPriceNow")}
            </p>
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t("cta.title")}</h2>
            {bestOffer && (
              <div className="mt-3 flex flex-wrap items-baseline gap-3">
                <span className="num text-3xl font-extrabold text-good">
                  {formatConverted(bestOffer.offer.price)}
                </span>
                {bestOffer.offer.discountPercent != null && (
                  <span className="num rounded-md bg-good/15 px-2 py-0.5 text-xs font-extrabold text-good">
                    −{bestOffer.offer.discountPercent}%
                  </span>
                )}
                <span className="text-xs muted">
                  {bestOffer.offer.storeName} · {bestOffer.offer.region}
                </span>
                {priceVerdict && (
                  <span
                    className={cn(
                      "text-xs font-bold",
                      priceVerdict.id === "wait" ? "text-warn" : "text-good",
                    )}
                  >
                    {t(
                      `history.verdict${priceVerdict.id.charAt(0).toUpperCase()}${priceVerdict.id.slice(1)}` as never,
                    )}
                  </span>
                )}
              </div>
            )}
            {offersUpdatedAt && (
              <p className="mt-2 text-[11px] muted">
                {t("prices.lastUpdated")} {formatRelativeTime(offersUpdatedAt, intlLocale)}
              </p>
            )}
          </div>

          <div className="flex w-full flex-wrap gap-2 lg:w-auto">
            <button
              onClick={() => {
                playSound("confirm");
                openBuy();
              }}
              className="btn btn-primary h-13 min-w-[180px] flex-1 px-6 py-3.5 text-sm lg:flex-none"
            >
              <ShoppingBag className="h-4 w-4" />
              {t("cta.buyNow")}
            </button>
            <button
              onClick={toggleWishlist}
              className={cn(
                "btn h-13 flex-1 px-5 py-3.5 text-xs lg:flex-none",
                isWishlisted ? "border border-nin/40 bg-nin/15 text-nin-soft" : "btn-quiet",
              )}
            >
              <Heart className={cn("h-4 w-4", isWishlisted && "fill-current")} />
              {isWishlisted ? t("hero.inWishlist") : t("cta.addToWishlist")}
            </button>
            <button
              onClick={openAlert}
              className="btn btn-quiet h-13 flex-1 px-5 py-3.5 text-xs lg:flex-none"
            >
              <Bell className="h-4 w-4 text-warn" />
              {t("cta.trackPrice")}
            </button>
          </div>
        </div>
      </section>
    </Reveal>
  );
}

/* -------------------------------------------------------------------------- */
/* Data transparency                                                          */
/* -------------------------------------------------------------------------- */

/** Closes the page by naming where the facts above came from. */
export function DataSourcesNote() {
  const { t, intlLocale } = useI18n();
  const { game } = useHub();
  const sources = game.dataSources ?? [];

  if (sources.length === 0) return null;

  return (
    <div className="mb-8 rounded-panel border border-border/70 bg-muted/50 p-5">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider muted">
        <ShieldAlert className="h-3 w-3" />
        {t("data.transparency")}
      </p>
      <p className="mt-2 text-xs leading-relaxed muted">{t("data.transparencyNote")}</p>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px]">
        {sources.map((source, index) => (
          <li key={`${source.label || source.url}-${index}`} className="muted">
            {source.url ? (
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold hover:text-foreground hover:underline"
              >
                {source.label}
              </a>
            ) : (
              <span className="font-semibold">{source.label}</span>
            )}
            {source.updatedAt && (
              <span className="ms-1.5">· {formatDate(source.updatedAt, intlLocale)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
