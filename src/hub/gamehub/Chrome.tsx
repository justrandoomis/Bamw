import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bell, Heart, Share2, ShoppingBag } from "lucide-react";
import { isAwaitingRelease } from "@/lib/release";
import { useHub } from "./hubContext";
import { useActiveSection } from "@/hub/hooks/useActiveSection";
import { useI18n } from "@/hub/i18n";
import { useCurrency } from "@/hub/context/CurrencyContext";
import { useNotifications } from "@/hub/context/NotificationContext";
import { cn } from "@/hub/utils/cn";
import { playSound } from "@/hub/utils/audio";

export interface NavItem {
  id: string;
  label: string;
}

/**
 * Section rail.
 *
 * Sticks under the app header and tracks the section in view. On narrow
 * screens it scrolls horizontally and auto-scrolls the active chip into view,
 * which is what makes a thirty-section page navigable on a phone.
 */
export function HubNav({ items }: { items: NavItem[] }) {
  const { game } = useHub();
  const active = useActiveSection(items.map((item) => item.id));
  const railRef = useRef<HTMLDivElement | null>(null);

  // Keep the active chip visible in the horizontal rail without yanking the page vertically.
  useEffect(() => {
    if (!active || !railRef.current) return;
    const rail = railRef.current;
    const chip = rail.querySelector<HTMLElement>(`[data-nav-id="${active}"]`);
    if (!chip) return;

    const targetLeft = chip.offsetLeft - rail.clientWidth / 2 + chip.clientWidth / 2;
    rail.scrollTo({
      left: targetLeft,
      behavior: "smooth",
    });
  }, [active]);

  return (
    <div className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-900/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 lg:px-6">
        <div
          ref={railRef}
          className="no-scrollbar flex flex-1 gap-1 overflow-x-auto py-2.5"
          role="navigation"
          aria-label={game.title}
        >
          {items.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              data-nav-id={item.id}
              onClick={() => playSound("select")}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors duration-200",
                active === item.id
                  ? "bg-nin text-white"
                  : "muted hover:bg-white/[0.06] hover:text-white",
              )}
            >
              {item.label}
            </a>
          ))}
        </div>

        <ShareButton title={game.title} />
      </div>
    </div>
  );
}

function ShareButton({ title }: { title: string }) {
  const { t } = useI18n();
  const { addNotification } = useNotifications();

  const onShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Sheet dismissed — fall through to the clipboard path.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      addNotification({ title: t("common.linkCopied"), type: "success" });
    } catch {
      addNotification({ title: t("common.error"), type: "warning" });
    }
  };

  return (
    <button
      onClick={() => void onShare()}
      aria-label={t("common.share")}
      className="hidden shrink-0 rounded-lg p-2 muted transition-colors hover:bg-white/[0.06] hover:text-white sm:block"
    >
      <Share2 className="h-4 w-4" />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Sticky buy bar                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Mobile purchase bar.
 *
 * Appears once the hero CTA scrolls away and hides again at the page footer, so
 * it never covers the final CTA it duplicates.
 */
export function StickyBuyBar() {
  const { t } = useI18n();
  const { formatConverted } = useCurrency();
  const { addNotification } = useNotifications();
  const { game, bestOffer, isWishlisted, toggleWishlist, openBuy, openAlert } = useHub();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const heroBuyButton = document.getElementById("hero-buy-button");
      let pastHero = window.scrollY > 600;
      if (heroBuyButton) {
        // Trigger only when the hero buy button has completely scrolled above viewport
        pastHero = heroBuyButton.getBoundingClientRect().bottom < 0;
      }
      const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
      setVisible(pastHero && !nearBottom);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!bestOffer) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: "110%" }}
          animate={{ y: 0 }}
          exit={{ y: "110%" }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
          className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-ink-900/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl lg:hidden"
        >
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider muted">
                {t("cta.bestPriceNow")}
              </p>
              <p className="flex items-baseline gap-2">
                <span className="num text-lg font-extrabold text-good">
                  {formatConverted(bestOffer.offer.price)}
                </span>
                {bestOffer.offer.discountPercent != null && (
                  <span className="num text-[10px] font-extrabold text-good">
                    −{bestOffer.offer.discountPercent}%
                  </span>
                )}
              </p>
            </div>

            <button
              onClick={() => {
                toggleWishlist();
                addNotification({
                  title: isWishlisted ? t("wishlist.removed") : t("wishlist.added"),
                  ...(isWishlisted
                    ? {}
                    : { message: t("wishlist.addedBody", { title: game.title }) }),
                  type: "success",
                });
              }}
              aria-label={t("hero.addToWishlist")}
              className={cn(
                "shrink-0 rounded-xl p-3 transition-colors",
                isWishlisted ? "bg-nin/15 text-nin-soft" : "bg-white/[0.06] muted",
              )}
            >
              <Heart className={cn("h-5 w-5", isWishlisted && "fill-current")} />
            </button>
            <button
              onClick={openAlert}
              aria-label={t("hero.trackPrice")}
              className="shrink-0 rounded-xl bg-white/[0.06] p-3 text-warn"
            >
              <Bell className="h-5 w-5" />
            </button>
            <button
              onClick={() => openBuy()}
              className="btn btn-primary h-12 shrink-0 px-6 text-sm"
            >
              {/* Before launch this opens the release panel, not a purchase. */}
              <ShoppingBag className="h-4 w-4" />
              {isAwaitingRelease(game.rawProduct ?? {}) ? "سجّل مسبقاً" : t("hero.buyNow")}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
