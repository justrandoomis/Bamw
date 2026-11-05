import { useEffect, useState } from "react";

import { liveDealOf, occasionTheme, timeLeftLabel, type AppliedDeal } from "@/lib/deals";

/**
 * How an occasion deal looks: each occasion in its own colours, so a shopper
 * reads «الجمعة السوداء» or «عيد الفطر» before they read the number.
 *
 * Everything time-based renders after mount. The server cannot know the
 * visitor's clock, and a countdown painted on the server would disagree with
 * the one hydrated in the browser.
 */

/** The current time, ticking once a minute, and null until mounted. */
function useMinuteClock(enabled: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now;
}

/**
 * The product's deal if it is live right now.
 *
 * No ticking clock here: a shelf renders up to 1,700 cards, and the server
 * only ever attaches a deal that is live (re-checked on every catalogue
 * refresh), so the render-time check is enough. The countdown, which does need
 * to move, lives on the product page's banner alone.
 */
export function useLiveDeal(product: unknown): AppliedDeal | null {
  return liveDealOf(product);
}

/** A band across the bottom of a card's artwork. */
export function DealRibbon({ deal, className = "" }: { deal: AppliedDeal; className?: string }) {
  const theme = occasionTheme(deal.occasion);
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-1 px-1.5 py-[3px] text-[9px] font-black leading-none sm:px-2 sm:py-1 sm:text-[10px] ${className}`}
      style={{ background: theme.background, color: theme.foreground }}
      dir="rtl"
    >
      <span className="min-w-0 truncate">
        <span aria-hidden="true">{theme.emoji}</span> {deal.label}
      </span>
      <span
        className="shrink-0 rounded-full px-1.5 py-[2px] tabular-nums"
        style={{ background: theme.accent, color: "#111827" }}
        dir="ltr"
      >
        −{deal.percent}%
      </span>
    </div>
  );
}

/** A compact pill: emoji, occasion, percentage. */
export function DealBadge({ deal, className = "" }: { deal: AppliedDeal; className?: string }) {
  const theme = occasionTheme(deal.occasion);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black leading-none shadow-sm ${className}`}
      style={{ background: theme.background, color: theme.foreground }}
    >
      <span aria-hidden="true">{theme.emoji}</span>
      <span>{deal.label}</span>
      <span
        className="rounded-full px-1.5 py-[2px] tabular-nums"
        style={{ background: theme.accent, color: "#111827" }}
        dir="ltr"
      >
        −{deal.percent}%
      </span>
    </span>
  );
}

/**
 * The product page's deal strip: the occasion, the saving, and how long is left.
 * `saving` is the amount already formatted in the shopper's currency.
 */
export function DealBanner({
  deal,
  saving,
  className = "",
}: {
  deal: AppliedDeal;
  saving?: string;
  className?: string;
}) {
  const theme = occasionTheme(deal.occasion);
  const now = useMinuteClock(Boolean(deal.endsAt));
  const left = now !== null ? timeLeftLabel(deal.endsAt, now) : "";
  return (
    <div
      className={`relative overflow-hidden rounded-2xl px-3.5 py-2.5 shadow-md ${className}`}
      style={{ background: theme.background, color: theme.foreground }}
      role="note"
      aria-label={`${deal.label} — خصم ${deal.percent}%`}
    >
      {/* A soft sheen so every occasion reads as a sale, not a warning. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-8 -left-8 h-24 w-24 rounded-full opacity-25 blur-2xl"
        style={{ background: theme.accent }}
      />
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xl leading-none" aria-hidden="true">
            {theme.emoji}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-black leading-tight">{deal.label}</p>
            {saving ? (
              <p className="text-[11px] font-bold opacity-90">
                وفّر <span dir="ltr">{saving}</span>
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {left ? (
            <span className="rounded-full bg-black/25 px-2 py-1 text-[10.5px] font-bold tabular-nums">
              ⏳ ينتهي خلال {left}
            </span>
          ) : null}
          <span
            className="rounded-full px-2.5 py-1 text-sm font-black tabular-nums"
            style={{ background: theme.accent, color: "#111827" }}
            dir="ltr"
          >
            −{deal.percent}%
          </span>
        </div>
      </div>
    </div>
  );
}
