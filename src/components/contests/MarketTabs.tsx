import { tr, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { playSound } from "@/utils/audio";

export type MarketTab = "market" | "events";

/** The contests first: they are where `/banana` opens. */
const TABS: { id: MarketTab; icon: string; label: string }[] = [
  { id: "events", icon: "🏆", label: "الفعاليات والمسابقات" },
  { id: "market", icon: "🍌", label: "سوق الموز" },
];

/**
 * «في /banana_market اجعل هنالك شريط علوي ينتقل بين سوق الموز والفعاليات
 * والمسابقات» — one control, two halves, pinned under the site header while
 * the page scrolls beneath it. The tab lives in the address (`?tab=market`),
 * so a link from Telegram or Instagram opens the half it means.
 */
export default function MarketTabs({
  tab,
  onChange,
}: {
  tab: MarketTab;
  onChange: (tab: MarketTab) => void;
}) {
  const { lang } = useI18n();
  return (
    <div
      data-market-tabs
      className="sticky top-[var(--header-h)] z-30 bg-[var(--page)]/95 px-4 pb-2 pt-3 backdrop-blur supports-[backdrop-filter]:bg-[var(--page)]/80"
      dir={lang === "en" ? "ltr" : "rtl"}
    >
      <div
        role="tablist"
        aria-label={tr("أقسام السوق")}
        className="mx-auto grid max-w-3xl grid-cols-2 gap-1 rounded-2xl border border-border bg-muted/70 p-1"
      >
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                if (active) return;
                playSound("klick", 0.4);
                onChange(item.id);
              }}
              className={cn(
                "flex min-h-11 items-center justify-center gap-1 whitespace-nowrap rounded-xl px-1 text-[clamp(11.5px,3.3vw,13.5px)] font-black transition-colors",
                active
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span aria-hidden="true" className="hidden min-[380px]:inline">
                {item.icon}
              </span>
              <span>{tr(item.label)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
