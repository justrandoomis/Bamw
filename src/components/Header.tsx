import { useEffect, useState, useMemo, useRef } from "react";
import { playSound } from "../utils/audio";
import {
  Search,
  ChevronRight,
  Shield,
  Globe,
  Wallet,
  User,
  Palette,
  MapPin,
  Moon,
  Sun,
  Music,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useI18n } from "../i18n";
import { useAuth } from "../hooks/useAuth";
import LanguageCurrencyModal from "./LanguageCurrencyModal";
import FlowerMenu from "./FlowerMenu";
import { cdnImage } from "@/lib/img";
import NintendoCover from "@/components/NintendoCover";
import { useSettingsStore } from "../store/useSettingsStore";
import { filterPurchasable } from "@/lib/purchasable";
import { buildProductIndex, searchProducts } from "@/lib/search/products";
import { LANG_COOKIE, THEME_COOKIE, langFromPhone, readCookie, writeCookie } from "../lib/prefs";

export default function Header({
  currentView,
  onBack,
  onNavigate,
  products = [],
}: {
  currentView: string;
  onBack: () => void;
  onNavigate: (view: string) => void;
  products?: any[];
}) {
  const isHome = currentView === "home";
  // The profile / settings menu belongs on every screen, not just a few.
  const showProfile = true;

  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const { user, updateProfile } = useAuth();
  const [isLangCurrencyOpen, setIsLangCurrencyOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  /* -1 means "nothing highlighted"; Enter then goes to the results page. */
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { soundEnabled, musicEnabled, setSoundEnabled, setMusicEnabled } = useSettingsStore();

  /*
    First visit for a signed-in member: their registered phone number is a
    better signal than the browser locale. An Arab dial code means Arabic,
    anything else English. An explicit choice (cookie) always wins.
  */
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (readCookie(LANG_COOKIE)) return;
    const guess = langFromPhone((user as any)?.phone);
    if (!guess || guess === lang) return;
    writeCookie(LANG_COOKIE, guess);
    useI18n.setState({ lang: guess as never });
  }, [user, lang]);

  const handleSelectTheme = (themeId: string, isDark: boolean) => {
    playSound("bumper_end", 0.6);
    writeCookie(THEME_COOKIE, themeId);
    if (typeof document !== "undefined") {
      document.documentElement.dataset["theme"] = themeId;
      document.documentElement.classList.toggle("dark", isDark);
      document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    }
    if (user && updateProfile) {
      updateProfile.mutate({ settings: { theme: themeId } });
    }
  };

  // persisted language only after hydration — avoids SSR/client text mismatch
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  /*
    The dropdown used to be `title.includes(q) || titleEn.includes(q)`, and
    production made that worthless: every product has the same English string
    in both fields, so the test ran twice on one value, and the Arabic name —
    which 133 of the 150 products have — was not in the payload at all. In a
    shop whose every screen is Arabic, «زيلدا» found nothing.

    Now the catalogue is scored: folded Arabic, typos forgiven, run-together
    spellings, and every word the customer typed has to land somewhere. See
    src/lib/search/products.ts.

    Indexed once per catalogue, not once per keystroke: folding and stemming
    150 products costs roughly twice what answering a query does, and paying
    that on every letter is what turns a search box into a stuttering one on a
    mid-range phone.
  */
  const searchIndex = useMemo(
    () =>
      buildProductIndex(
        filterPurchasable<Record<string, unknown>>(products as Record<string, unknown>[]),
      ),
    [products],
  );

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return searchProducts(searchIndex, searchQuery, { limit: 6 }).map((row) => row.product as any);
  }, [searchQuery, searchIndex]);

  /* A highlight that outlived the list it pointed into would open the wrong game. */
  useEffect(() => setActiveIndex(-1), [searchQuery]);

  const openProduct = (product: any) => {
    playSound("hover_s", 0.6);
    onNavigate(`product/${product.id}`);
    setSearchQuery("");
    setIsSearchFocused(false);
  };

  const showAllResults = () => {
    const q = searchQuery.trim();
    if (!q) return;
    playSound("bumper_end", 0.6);
    searchInputRef.current?.blur();
    setIsSearchFocused(false);
    void navigate({ to: "/search", search: { q } });
  };

  /**
   * Arrow keys walk the list, Enter takes the highlighted game — or, when
   * nothing is highlighted, the whole result set on its own page.
   */
  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (searchResults.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      // Wraps through -1, so arrowing off either end returns to the typed text.
      setActiveIndex((current) => {
        const next = current + step;
        if (next < -1) return searchResults.length - 1;
        if (next >= searchResults.length) return -1;
        return next;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const active = activeIndex >= 0 ? searchResults[activeIndex] : undefined;
      if (active) openProduct(active);
      else showAllResults();
      return;
    }
    if (event.key === "Escape") {
      setIsSearchFocused(false);
      searchInputRef.current?.blur();
    }
  };

  const defaultAddress = user?.addresses?.find((a) => a.isDefault) ?? user?.addresses?.[0];

  const menuItems = [
    {
      label: t("اللغة والعملة"),
      icon: <Globe className="w-5 h-5" />,
      onClick: () => {
        playSound("bumper_end", 0.6);
        setIsLangCurrencyOpen(true);
      },
    },
    {
      label: t("المحفظة"),
      icon: <Wallet className="w-5 h-5" />,
      onClick: () => {
        playSound("bumper_end", 0.6);
        onNavigate("wallet");
      },
    },
    {
      label: t("الملف الشخصي"),
      icon: <User className="w-5 h-5" />,
      onClick: () => {
        playSound("user", 0.6);
        onNavigate("profile");
      },
    },
    {
      label: t("لون الخلفية والتخصيص"),
      icon: <Palette className="w-5 h-5" />,
      onClick: () => {
        playSound("bumper_end", 0.6);
      },
      subItems: [
        {
          label: musicEnabled ? t("إيقاف الموسيقى") : t("تشغيل الموسيقى"),
          icon: <Music className={`w-5 h-5 ${!musicEnabled ? "opacity-50" : ""}`} />,
          onClick: () => {
            setMusicEnabled(!musicEnabled);
            if (soundEnabled) playSound("switch_click", 0.6);
          },
        },
        {
          label: soundEnabled ? t("إيقاف أصوات النظام") : t("تشغيل أصوات النظام"),
          icon: soundEnabled ? (
            <Volume2 className="w-5 h-5" />
          ) : (
            <VolumeX className="w-5 h-5 opacity-50" />
          ),
          onClick: () => {
            setSoundEnabled(!soundEnabled);
            if (!soundEnabled) playSound("turn_on", 0.6);
          },
        },
        {
          label: t("الوضع الداكن"),
          icon: <Moon className="w-5 h-5" />,
          onClick: () => handleSelectTheme("midnight", true),
        },
        {
          label: t("الوضع الفاتح"),
          icon: <Sun className="w-5 h-5" />,
          onClick: () => handleSelectTheme("cream", false),
        },
      ],
    },
    {
      label: t("العنوان"),
      icon: <MapPin className="w-5 h-5" />,
      onClick: () => {
        playSound("bumper_end", 0.6);
        onNavigate("profile");
      },
      subItems: [
        {
          label: defaultAddress
            ? `${defaultAddress.label} — ${defaultAddress.city}`
            : t("العنوان الافتراضي"),
          icon: <span className="text-xs font-bold">🏠</span>,
          onClick: () => {
            playSound("bumper_end", 0.6);
            void navigate({ to: "/profile" });
          },
        },
        {
          label: t("اضافة عنوان"),
          icon: <span className="text-xs font-bold">+</span>,
          onClick: () => {
            playSound("bumper_end", 0.6);
            void navigate({ to: "/profile" });
          },
        },
      ],
    },
  ];

  return (
    <>
      {/* The header floats over page content, so the bar itself must not eat
          pointer events — only its actual controls do. */}
      <header
        dir="ltr"
        className={`z-50 fixed top-0 inset-x-0 w-full transition-all duration-300 transform-gpu ${
          isMenuOpen ? "bottom-0 pointer-events-auto" : "pointer-events-none"
        }`}
      >
        <div
          className="mx-auto max-w-6xl px-4 pt-6 pb-4 flex items-center gap-3 w-full [&>*]:pointer-events-auto relative"
          dir="ltr"
        >
          {!isHome && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                playSound("bumper_end", 0.6);
                onBack();
              }}
              className="p-2 rounded-full bg-black/20 text-white backdrop-blur-md shadow-sm border border-white/20 active:scale-95 transition-transform shrink-0"
              aria-label="Back"
            >
              <ChevronRight className="w-5 h-5 rtl:rotate-180" />
            </button>
          )}

          {isHome ? (
            <div
              className={`flex-1 relative transition-all duration-300 z-0 ${isMenuOpen ? "opacity-30 blur-sm !pointer-events-none [&_*]:!pointer-events-none" : "opacity-100"}`}
            >
              <form
                role="search"
                onSubmit={(e) => {
                  e.preventDefault();
                  showAllResults();
                }}
              >
                <input
                  ref={searchInputRef}
                  type="search"
                  inputMode="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={isSearchFocused && searchResults.length > 0}
                  aria-controls={
                    isSearchFocused && searchQuery.trim() ? "header-search-results" : undefined
                  }
                  aria-activedescendant={
                    activeIndex >= 0 ? `header-search-option-${activeIndex}` : undefined
                  }
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                  /* The delay lets a click on a result land before the list unmounts. */
                  onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                  onKeyDown={onSearchKeyDown}
                  placeholder={t("بحث ذكي عن الألعاب...")}
                  aria-label={t("بحث ذكي عن الألعاب...")}
                  suppressHydrationWarning
                  className="w-full h-10 rounded-full outline-none px-4 ps-10 text-sm transition-all bg-black/20 border border-white/20 text-white backdrop-blur-md placeholder-white/70 focus:border-white focus:bg-black/40 shadow-sm"
                />
              </form>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white pointer-events-none" />

              {isSearchFocused && searchQuery.trim().length > 0 && (
                <div
                  id="header-search-results"
                  role="listbox"
                  className="absolute top-full mt-2 left-0 right-0 bg-black/60 backdrop-blur-xl border border-white/20 rounded-2xl overflow-hidden shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200 z-50"
                >
                  {searchResults.map((p, index) => (
                    <button
                      key={p.id}
                      id={`header-search-option-${index}`}
                      role="option"
                      aria-selected={index === activeIndex}
                      type="button"
                      onPointerEnter={() => setActiveIndex(index)}
                      onClick={() => openProduct(p)}
                      className={`w-full flex items-center gap-3 p-3 transition-colors border-b border-white/5 last:border-0 text-left ${
                        index === activeIndex ? "bg-white/15" : "hover:bg-white/10"
                      }`}
                    >
                      <NintendoCover
                        product={p as Record<string, unknown>}
                        usage="listing-card"
                        ratio={1}
                        className="w-10 h-10 rounded-lg bg-white/10 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-bold text-sm truncate" dir="ltr">
                          {p.titleEn || p.english_name || p.title}
                        </div>
                        {/* The name they typed, when it is not the name shown above. */}
                        {p.titleAr && p.titleAr !== (p.titleEn || p.title) && (
                          <div className="text-white/60 text-[11px] truncate" dir="rtl">
                            {p.titleAr}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}

                  {searchResults.length === 0 ? (
                    <div className="p-4 text-center text-xs font-bold text-white/70">
                      {t("لا توجد نتائج")}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={showAllResults}
                      className="w-full p-3 text-center text-xs font-bold text-white/80 hover:bg-white/10 transition-colors border-t border-white/10"
                    >
                      {t("عرض كل النتائج")}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1" />
          )}

          {isHome && user?.isAdmin && (
            <button
              onPointerDown={() => {
                playSound("bumper_end", 0.6);
                navigate({ to: "/admin" });
              }}
              className="w-10 h-10 rounded-full flex items-center justify-center bg-black/20 text-white backdrop-blur-md shadow-sm border border-white/20 hover:bg-black/30 transition-colors shrink-0"
              title={t("لوحة الإدارة")}
              suppressHydrationWarning
            >
              <Shield className="w-5 h-5" />
            </button>
          )}

          {showProfile && (
            <FlowerMenu
              className="z-[60] shrink-0"
              menuItems={menuItems}
              startAngle={90}
              endAngle={180}
              togglerSize={48}
              itemSize={40}
              petalGap={24}
              backgroundColor="rgba(0, 0, 0, 0.55)"
              iconColor="white"
              onOpenChange={(isOpen) => {
                setIsMenuOpen(isOpen);
                if (isOpen) playSound("bumper_end", 0.6);
              }}
            >
              <div className="h-12 w-12 rounded-full overflow-hidden border-2 border-white/25 shrink-0 bg-white/10 shadow-md relative group flex items-center justify-center">
                {user?.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.name || "Profile"}
                    className="w-full h-full object-cover transition-transform group-hover:scale-110"
                  />
                ) : (
                  <User className="w-6 h-6 text-white/50" />
                )}

                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-[10px] font-bold text-white uppercase">
                    {hydrated ? lang : ""}
                  </span>
                </div>
              </div>
            </FlowerMenu>
          )}
        </div>
      </header>

      <LanguageCurrencyModal
        isOpen={isLangCurrencyOpen}
        onClose={() => setIsLangCurrencyOpen(false)}
      />
    </>
  );
}
