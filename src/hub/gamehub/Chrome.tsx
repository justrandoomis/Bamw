import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Heart, ShoppingBag } from "lucide-react";
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

  /*
    A rail of clay that follows the page: the sections as a pressed track with
    the one in view raised out of it — the same control as the shop's other
    segmented choices. Share moved up into the hero, next to back.
  */
  return (
    <div className="sticky top-0 z-30 px-3 pb-1 pt-[max(env(safe-area-inset-top),0.5rem)] sm:px-4">
      <div className="mx-auto max-w-6xl">
        <div
          ref={railRef}
          className="no-scrollbar flex gap-0.5 overflow-x-auto rounded-full border border-[var(--clay-rim)] bg-[var(--page)]/85 p-1 shadow-md backdrop-blur-xl"
          role="navigation"
          aria-label={game.title}
        >
          {items.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              data-nav-id={item.id}
              aria-current={active === item.id ? "location" : undefined}
              onClick={() => playSound("select")}
              className={cn(
                "flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[12.5px] font-bold transition-colors duration-200",
                active === item.id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </a>
          ))}
        </div>
      </div>
    </div>
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
  const { game, bestOffer, isWishlisted, toggleWishlist, openBuy } = useHub();
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

  /*
    The floating bar of clay that takes over once the purchase card has
    scrolled away — on every width now, since the card does not follow the
    page down. The price, a heart, and the one button.
  */
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: "130%" }}
          animate={{ y: 0 }}
          exit={{ y: "130%" }}
          transition={{ type: "spring", bounce: 0, duration: 0.4 }}
          className="fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),0.75rem)] z-40 mx-auto max-w-lg rounded-[24px] border border-[var(--clay-rim)] bg-[var(--page)]/90 p-2.5 shadow-xl backdrop-blur-xl"
        >
          <div className="flex items-center gap-2.5">
            <div className="min-w-0 flex-1 ps-1.5">
              <p className="text-[11px] font-bold text-muted-foreground">{t("cta.bestPriceNow")}</p>
              <p className="flex items-baseline gap-2">
                <span className="num text-[18px] font-black text-foreground">
                  {formatConverted(bestOffer.offer.price)}
                </span>
                {bestOffer.offer.discountPercent != null && (
                  <span className="num text-[11px] font-extrabold text-good">
                    −{bestOffer.offer.discountPercent}%
                  </span>
                )}
              </p>
            </div>

            <button
              type="button"
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
              aria-pressed={isWishlisted}
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] border border-[var(--clay-rim)] bg-card shadow-sm",
                isWishlisted ? "text-nin" : "text-foreground",
              )}
            >
              <Heart className={cn("h-5 w-5", isWishlisted && "fill-current")} />
            </button>
            <button
              type="button"
              onClick={() => openBuy()}
              className="btn btn-primary h-12 shrink-0 rounded-[16px] px-6 text-sm"
            >
              {/* Before launch this opens the release panel, not a purchase. */}
              <ShoppingBag className="h-4 w-4" />
              {isAwaitingRelease(game.rawProduct ?? {}) ? t("hero.preorder") : t("hero.buyNow")}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
