import { CandlestickChart, MessageCircle, ShoppingCart, User } from "lucide-react";
import { useCartStore, cartCount } from "../store/useCartStore";
import { BananaIcon } from "./Icons";
import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import { preloadSound } from "../utils/audio";

preloadSound("bumper_end");
preloadSound("home");
preloadSound("hover");
preloadSound("hover_s");
preloadSound("select");
preloadSound("turn_on");

const navItems = [
  { id: "home", icon: BananaIcon, label: "الرئيسية", sound: "select" },
  { id: "market", icon: CandlestickChart, label: "سوق الموز", sound: "select" },
  { id: "chat", icon: MessageCircle, label: "المحادثة", sound: "select" },
  { id: "cart", icon: ShoppingCart, label: "السلة", sound: "select" },
  { id: "profile", icon: User, label: "حسابي", sound: "select" },
];

/** Taps arriving this soon after a view change are leftovers from the previous
 * screen (e.g. the finger that pressed "back" landing on a freshly mounted
 * button), so they are ignored. */
const SETTLE_MS = 350;

export default function BottomNav({
  currentView,
  onNavigate,
}: {
  currentView: string;
  onNavigate: (v: string) => void;
}) {
  const settledAt = useRef(0);
  const { t } = useI18n();
  const count = useCartStore((s) => cartCount(s.lines));

  useEffect(() => {
    settledAt.current = Date.now() + SETTLE_MS;
  }, [currentView]);

  return (
    /*
      A floating dock of clay: lifted off the page on its own shadow, the
      material translucent so the page reads through it, and the section the
      member is in pressed out of it as a raised piece.
    */
    <div
      dir="rtl"
      className="mx-auto mb-[max(env(safe-area-inset-bottom),0.75rem)] flex w-[calc(100%-1.5rem)] max-w-lg shrink-0 transform-gpu items-center justify-around rounded-[28px] border border-[var(--clay-rim)] bg-[var(--page)]/80 px-2 py-2 backdrop-blur-xl clay-3 pointer-events-auto sm:gap-6 z-50"
    >
      {navItems.map((item) => {
        const isActive =
          currentView === item.id || (currentView === "details" && item.id === "home");
        const Icon = item.icon;
        const label = t(item.label);

        return (
          <button
            key={item.id}
            {...(isActive ? {} : { "data-ui-sound": item.sound, "data-ui-channel": "bottom_nav" })}
            onClick={(e) => {
              if (isActive) return;
              if (Date.now() < settledAt.current) return;
              onNavigate(item.id);
            }}
            className="relative flex h-12 w-14 flex-col items-center justify-center rounded-2xl clay-press"
            title={label}
            suppressHydrationWarning
          >
            {isActive && (
              <motion.div
                layoutId="nav-pill"
                className="absolute inset-0 rounded-2xl bg-card clay-1"
                transition={{ type: "spring", bounce: 0, duration: 0.35 }}
              />
            )}
            {item.id === "cart" && count > 0 && (
              <div className="absolute -top-1 right-0 z-20 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[var(--brand-red)] px-1 text-[10px] font-bold text-white clay-btn">
                {count}
              </div>
            )}
            <Icon
              className={`w-6 h-6 relative z-10 transition-colors duration-300 ${isActive ? "text-foreground" : "text-muted-foreground"}`}
              {...(item.id === "home" ? { solid: isActive } : {})}
            />
          </button>
        );
      })}
    </div>
  );
}
