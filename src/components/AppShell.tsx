import { useEffect, useState, useMemo, type ReactNode } from "react";
import { playSound } from "../utils/audio";
import {
  Search,
  ChevronRight,
  Shield,
  Globe,
  Coins,
  User,
  Palette,
  MapPin,
  Loader2,
} from "lucide-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { motion, AnimatePresence } from "motion/react";
import { useI18n } from "../i18n";
import { useCurrency } from "../context/CurrencyContext";
import { useAuth } from "../hooks/useAuth";
import { useStoreData } from "../hooks/useStoreData";
import { availableThemes } from "../lib/themes";
import { THEME_COOKIE, writeCookie } from "../lib/prefs";
import CurrencyModal from "./CurrencyModal";
import FlowerMenu from "./FlowerMenu";
import { cdnImage } from "@/lib/img";
import BottomNav from "./BottomNav";
import Header from "./Header";
import { trackBrowsing, getSessionId } from "@/lib/activity.functions";

const viewToPath: Record<string, string> = {
  home: "/",
  store: "/",
  market: "/banana_market",
  chat: "/chat",
  orders: "/orders",
  cart: "/cart",
  profile: "/profile",
  wallet: "/wallet",
  admin: "/admin",
};

export default function AppShell({
  children,
  currentView = "home",
  hideNav = false,
  onBack,
}: {
  children: ReactNode;
  currentView?: string;
  hideNav?: boolean;
  onBack?: () => void;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const lang = useI18n((state) => state.lang);
  const { t } = useI18n();
  const { data: store } = useStoreData();
  const isLoading = useRouterState({ select: (s) => s.status === "pending" });

  // Track browsing history on route change
  useEffect(() => {
    const sid = getSessionId();
    trackBrowsing({
      data: {
        path: pathname,
        sessionId: sid || undefined,
        metadata: { referrer: document.referrer },
      },
    }).catch(console.error);
  }, [pathname]);

  const handleNavigate = (view: string) => {
    if (view.startsWith("product/")) {
      const id = view.split("/")[1];
      void navigate({ to: "/product/$productId", params: { productId: id || "" } });
      return;
    }
    const path = viewToPath[view] ?? "/";
    if (path !== pathname) void navigate({ to: path });
  };

  const isTelegramMiniApp =
    typeof window !== "undefined" &&
    (window.location.search.includes("tgWebAppStartParam") ||
      window.location.search.includes("tgWebAppData") ||
      !!(window as any).Telegram?.WebApp?.initData);

  return (
    <div
      className="flex min-h-screen flex-col bg-[var(--page)]"
      dir={lang === "en" ? "ltr" : "rtl"}
      suppressHydrationWarning={true}
    >
      {!isTelegramMiniApp && (
        <Header
          currentView={currentView}
          onBack={onBack ?? (() => void navigate({ to: "/" }))}
          onNavigate={handleNavigate}
          products={store?.products ?? []}
        />
      )}
      {/*
        The header is fixed, so it takes no room: the page starts exactly its
        height below the top, or the first lines sit behind it. The home page
        alone runs its banner under the bar, which is transparent there.
      */}
      <main
        className={`relative flex-1 ${!hideNav && !isTelegramMiniApp ? "pb-[72px]" : ""} ${
          !isTelegramMiniApp && currentView !== "home" ? "pt-[var(--header-h)]" : ""
        }`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="flex-1"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {!hideNav && !isTelegramMiniApp && (
        <div
          id="app-bottom-nav"
          className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none [&>*]:pointer-events-auto"
        >
          <BottomNav currentView={currentView} onNavigate={handleNavigate} />
        </div>
      )}
    </div>
  );
}
