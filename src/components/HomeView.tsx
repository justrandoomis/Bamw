import { motion, AnimatePresence } from "motion/react";
import { Link } from "@tanstack/react-router";
import React, { useState, useEffect, useMemo, Suspense, lazy } from "react";
import { useStoreData } from "../hooks/useStoreData";
import { tr, useTranslation } from "../i18n";
import { useCurrency } from "../context/CurrencyContext";
import { BananaIcon } from "./Icons";
import { Headset, CreditCard, Wallet, Star, Trophy, Sparkles } from "lucide-react";
import { playSound, preloadSound } from "../utils/audio";
import { filterPurchasable } from "@/lib/purchasable";
import { getProductCategory, isGameProduct } from "@/lib/productSection";
import { productImageUrl } from "@/lib/productImages";
import { listingPrice } from "@/lib/productPricing";
import { CartridgeStrip, ProductStrip, CartridgeSkeleton } from "./ProductStrips";
import { BundleStrip } from "./BundleStrip";
import type { AccountBundle } from "@/lib/types";
import { rankByPreference } from "@/lib/recommend";
import { useAuth } from "@/hooks/useAuth";
import { cdnImage } from "@/lib/img";
import {
  getNintendoMediaUrl,
  NINTENDO_IMAGE_PLACEHOLDER,
  resolveNintendoImageUrl,
} from "@/lib/nintendoImages";
import { preloadGameCovers, preloadImage, preload3DBoxAssets } from "@/lib/imagePreloader";
import { LazySection } from "./LazySection";
import NintendoNews from "./NintendoNews";
import { HomeBananaMarket } from "./HomeBananaMarket";
import { StoreServices } from "./StoreServices";
import { SectionErrorBoundary } from "./SectionErrorBoundary";

preloadSound("hover");
preloadSound("hover_s");

const iconMap: Record<string, any> = {
  Headset,
  CreditCard,
  Wallet,
  Star,
  Trophy,
};

/**
 * Deprecated shim.
 *
 * This module used to own image selection for every Nintendo surface, via a
 * `getNintendoCardImage` chain that ended in a hardcoded table of "known"
 * covers matched by title substring — so any product whose name contained
 * "mario party" advertised a different game's *banner*. Selection now lives in
 * `@/lib/nintendoImages`, which has one documented fallback order per usage and
 * no per-game entries at all.
 *
 * Kept only so callers outside this file keep compiling; prefer
 * `resolveNintendoImage(product, usage)` or `<NintendoCover>` directly.
 *
 * @deprecated Use `resolveNintendoImage` from `@/lib/nintendoImages`.
 */
export function getNintendoCardImage(product: Record<string, any>): string {
  return resolveNintendoImageUrl(product, "listing-card");
}

export default function HomeView({
  onGameClick,
}: {
  onGameClick: (game: any, withTransition?: boolean) => void;
}) {
  const [clickedCartridgeId, setClickedCartridgeId] = useState<number | string | null>(null);
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [failedBanners, setFailedBanners] = useState<Record<string | number, boolean>>({});
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  /*
    `useTranslation()`, not `useI18n().t`.

    The store's `t` is the legacy translator whose keys *are* Arabic source
    strings — `if (lang === "ar") return key`. Handed a dotted path it returns
    the path, which is why "common.viewAll" and an untranslated
    "Latest Nintendo releases" were rendering to shoppers. The workaround
    further down (`t(k) === k ? "…" : t(k)`) was the symptom.
  */
  const { t } = useTranslation();
  const { formatGenericPrice } = useCurrency();

  const { data: store, isPending, isError, refetch, isFetching } = useStoreData();
  const hasProducts = Array.isArray(store?.products) && store.products.length > 0;

  const banners: any[] = Array.isArray(store?.banners) ? store.banners : [];
  const { user } = useAuth();
  // Suggestions follow the genres the member picked at signup / in preferences.
  const adminProducts: any[] = useMemo(
    () => rankByPreference(filterPurchasable<any>(Array.isArray(store?.products) ? store.products : []), user?.preferredGenres),
    [store?.products, user?.preferredGenres],
  );
  const adminCategories: any[] = Array.isArray(store?.categories) ? store.categories : [];

  const activeBanners = useMemo(
    () => banners.filter((b) => b && b.isActive !== false),
    [banners],
  );

  useEffect(() => {
    // Preload top game covers & 3D box assets on home load
    if (adminProducts.length > 0) {
      preloadGameCovers(adminProducts, 35);
    }
    preload3DBoxAssets();
    // Preload active banners
    activeBanners.slice(0, 3).forEach((b) => {
      if (b?.imageUrl) preloadImage(b.imageUrl, { width: 1200 });
    });
  }, [adminProducts, activeBanners]);

  useEffect(() => {
    if (activeBanners.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentBannerIndex((prev) => (prev + 1) % activeBanners.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [activeBanners.length]);

  const playHoverSound1 = () => playSound("hover_s", 0.8);
  const playHoverSound2 = () => playSound("hover", 0.8);

  const handleCartridgeClick = (game: any, isSwitch2: boolean) => {
    if (isSwitch2) {
      playSound("hover", 0.8);
    } else {
      playSound("hover_s", 0.8);
    }

    setClickedCartridgeId(game.id);

    // Navigate immediately without artificial delay
    onGameClick(game, true);
  };

  const defaultHeroFallback = (
    <div className="w-full h-full flex flex-col justify-center items-center text-center p-6 bg-gradient-to-br from-[#E60012] via-[#C40010] to-[#80000A] text-white select-none">
      <div className="flex items-center gap-2 mb-2">
        <span className="bg-white/20 text-white text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider">
          Banana Store
        </span>
      </div>
      <h2 className="text-white text-2xl sm:text-4xl font-black mb-2 drop-shadow-md">
        Nintendo Switch Games & Accounts
      </h2>
      <p className="text-white/90 text-sm sm:text-lg max-w-lg font-medium drop-shadow-sm">
        ألعاب وحسابات نينتندو سويتش مع تسليم فوري ودعم مباشر
      </p>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative z-10 flex flex-col"
    >
      {/*
        A catalogue that could not be read says so.

        `isError` was destructured and never rendered: when /api/data failed and
        no usable snapshot was left, `isPending` went false, `hasProducts` stayed
        false, and every product section drew its heading over nothing. That is
        the blank page — headings present, rows missing, no way to tell whether
        the store was empty or the request had failed. The shell, the banners and
        the services above still render; only the catalogue reports itself.
      */}
      {isClient && isError && !hasProducts ? (
        <div className="mx-auto my-6 w-full max-w-2xl px-4">
          <div className="rounded-2xl border border-[var(--brand-red,#e11d48)]/30 bg-[var(--bad-bg,#fee)] p-4 text-center">
            <p className="text-sm font-bold text-[var(--brand-red-dark,#c00)]">
              {tr("تعذر تحميل قائمة المنتجات")}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--brand-red,#e11d48)] px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {isFetching ? tr("جارٍ إعادة المحاولة...") : tr("إعادة المحاولة")}
            </button>
          </div>
        </div>
      ) : null}

      {/* Hero Banner Section */}
      <SectionErrorBoundary sectionName="HeroBanner" fallback={defaultHeroFallback}>
        <div className="w-full aspect-[16/9] sm:aspect-[21/9] min-h-[220px] max-h-[360px] sm:max-h-[440px] md:max-h-[500px] relative z-0 overflow-hidden flex bg-gradient-to-br from-[#1b1c20] to-[#2d1215]">
          {!isClient || (isPending && !hasProducts) ? (
            <div className="w-full h-full bg-[var(--surface)] animate-pulse animate-skeleton-shimmer" />
          ) : activeBanners.length > 0 ? (
            <div
              className="w-full h-full relative"
              style={{ backgroundColor: activeBanners[currentBannerIndex]?.bgColor || "transparent" }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {(() => {
                  const banner = activeBanners[currentBannerIndex];
                  if (!banner) return defaultHeroFallback;
                  const isImgFailed = failedBanners[banner.id];

                  return (
                    <motion.div
                      key={banner.id}
                      className="absolute inset-0 cursor-pointer"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.4, ease: "easeInOut" }}
                      onClick={() => {
                        if (banner.targetUrl) {
                          try {
                            const opened = window.open(
                              banner.targetUrl,
                              "_blank",
                              "noopener,noreferrer",
                            );
                            if (!opened) {
                              window.location.href = banner.targetUrl;
                            }
                          } catch (err) {
                            console.warn("Frame blocked window.open:", err);
                          }
                        } else {
                          onGameClick({ title: "Banner", id: banner.id }, false);
                        }
                      }}
                    >
                      {banner.imageUrl && !isImgFailed ? (
                        <img
                          src={cdnImage(banner.imageUrl, { width: 1400 })}
                          alt="Hero"
                          className="w-full h-full object-cover"
                          decoding="async"
                          loading="eager"
                          fetchPriority={currentBannerIndex === 0 ? "high" : "auto"}
                          onError={() => {
                            setFailedBanners((prev) => ({ ...prev, [banner.id]: true }));
                          }}
                          style={{
                            transform: `translate(${banner.posX || 0}px, ${banner.posY || 0}px) scale(${banner.scale || 1})`,
                          }}
                        />
                      ) : banner.title || banner.subtitle ? (
                        <div className="w-full h-full flex flex-col justify-center items-center text-center p-6 bg-gradient-to-br from-[#E60012] to-[#80000A] text-white">
                          {banner.title && (
                            <h2 className="text-white text-2xl sm:text-3xl font-black mb-2">{banner.title}</h2>
                          )}
                          {banner.subtitle && (
                            <p className="text-white/80 text-base sm:text-lg">{banner.subtitle}</p>
                          )}
                        </div>
                      ) : (
                        defaultHeroFallback
                      )}
                    </motion.div>
                  );
                })()}
              </AnimatePresence>

              {activeBanners.length > 1 && (
                <div className="absolute bottom-8 sm:bottom-12 left-1/2 -translate-x-1/2 flex gap-1.5 flex-row-reverse z-10">
                  {activeBanners.map((_, idx) => (
                    <button
                      key={idx}
                      className={`h-1.5 rounded-full transition-all ${currentBannerIndex === idx ? "w-5 bg-white shadow" : "w-1.5 bg-white/40"}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCurrentBannerIndex(idx);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            defaultHeroFallback
          )}
        </div>
      </SectionErrorBoundary>

      {/* Main Content Area */}
      <div
        className={`bg-[var(--page)] rounded-t-[24px] pt-0 -mt-6 pb-12 px-0 space-y-8 relative shadow-[0_-10px_20px_rgba(0,0,0,0.1)] z-10 flex-1 max-w-full overflow-hidden`}
      >
        {/* Store Services and Guides - Moved outside categories loop to ensure it always renders */}
        <SectionErrorBoundary sectionName="StoreServices">
          <Suspense
            fallback={
              <div className="h-20 animate-pulse animate-skeleton-shimmer bg-muted/10 rounded-2xl mx-4" />
            }
          >
            <StoreServices />
          </Suspense>
        </SectionErrorBoundary>

        {/* Section 1: Cartridge Shelf (Nintendo Switch Games) */}
        <SectionErrorBoundary sectionName="CartridgeShelf">
          <section className="relative mt-2 pb-2 w-full max-w-full">
            <div className="mb-3 px-4 sm:px-8 flex items-center justify-between">
              <h3 className="truncate text-xl font-bold text-foreground">
                {t("home.nintendoSwitchGames")}
              </h3>
              <Link
                to="/category/$categoryId"
                params={{ categoryId: "nintendo_games" }}
                className="text-orange-500 hover:text-orange-600 px-2 py-1 text-sm font-bold transition-colors"
              >
                {t("common.viewAll")}
              </Link>
            </div>

            <div className="relative mb-6 mt-2 min-h-[200px] w-full max-w-full">
              <LazySection placeholder={<CartridgeSkeleton />}>
                <CartridgeStrip
                  games={adminProducts
                    .filter((p) => isGameProduct(p))
                    .map((p) => ({
                      id: p.id,
                      slug: p.slug,
                      title: p.titleEn || p.english_name || p.title || "Game",
                      price: p.price ?? 0,
                      // "ألعاب نينتندو سويتش" is the square-card surface: the
                      // cartridge label window is wider than it is tall and is
                      // cut for square art. A vertical box cover here is the
                      // bug this section was reported for.
                      image: getNintendoMediaUrl(p, "square-card"),
                      source: p,
                      subtitle: p.developer || p.publisher || "Nintendo Switch",
                      rating: p.metacriticRating ?? null,
                      platform: p.platform,
                    }))}
                  clickedId={clickedCartridgeId}
                  onSelect={(game: any) => {
                    if (clickedCartridgeId != null) return;
                    setClickedCartridgeId(game.id);
                    setTimeout(() => {
                      onGameClick(game, true);
                    }, 400);
                    setTimeout(() => setClickedCartridgeId(null), 6000);
                  }}
                />
              </LazySection>

              <div className="absolute bottom-[-18px] left-0 right-0 flex flex-col z-0">
                <div className="h-[6px] w-full bg-gradient-to-b from-[var(--gray-1)] to-[var(--gray-2)]"></div>
                <div className="h-[12px] w-full bg-gradient-to-b from-[var(--gray-3)] to-[var(--gray-4)] shadow-[0_15px_25px_rgba(0,0,0,0.15)]"></div>
              </div>
            </div>
          </section>
        </SectionErrorBoundary>

        {/* Section 2: Account Bundles (Horizontal Strip) */}
        <SectionErrorBoundary sectionName="BundleStrip">
          <LazySection>
            <BundleStrip
              bundles={(store?.bundles ?? []) as AccountBundle[]}
              products={store?.products ?? []}
            />
          </LazySection>
        </SectionErrorBoundary>

        {/* Section 3: Latest Nintendo Games Added by Release Date */}
        <SectionErrorBoundary sectionName="LatestReleases">
          <LazySection>
            <section className="mt-2 w-full max-w-full">
              <div className="flex items-center justify-between gap-2 mb-4 px-4 sm:px-8">
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold text-foreground">
                    {t("home.latestNintendoGames")}
                  </h3>
                  <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
                    New
                  </span>
                </div>
              </div>

              <div dir="ltr" className="w-full max-w-full">
                <ProductStrip
                  products={adminProducts
                    .filter((p) => isGameProduct(p))
                    .sort((a, b) => {
                      const getVal = (p: any) => {
                        try {
                          const created = new Date(p.createdAt || p.created_at || p.updatedAt || p.updated_at || 0).getTime() || 0;
                          let rel = 0;
                          const d =
                            p.releaseDate ||
                            p.release_date ||
                            p.metadata?.releaseDate ||
                            p.metadata?.release_date ||
                            p.releaseYear ||
                            p.release_year;
                          if (d) {
                            const dStr = String(d).trim();
                            const ymdMatch = dStr.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
                            if (ymdMatch && ymdMatch[1] && ymdMatch[2] && ymdMatch[3]) {
                              rel = new Date(
                                `${ymdMatch[1]}-${ymdMatch[2].padStart(2, "0")}-${ymdMatch[3].padStart(2, "0")}`,
                              ).getTime() || 0;
                            } else {
                              const dmMatch = dStr.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
                              if (dmMatch && dmMatch[1] && dmMatch[2] && dmMatch[3]) {
                                rel = new Date(
                                  `${dmMatch[3]}-${dmMatch[2].padStart(2, "0")}-${dmMatch[1].padStart(2, "0")}`,
                                ).getTime() || 0;
                              } else {
                                const parsed = new Date(dStr).getTime();
                                if (!isNaN(parsed) && parsed > 0) rel = parsed;
                                else {
                                  const yearMatch = dStr.match(/\b(20\d{2}|19\d{2})\b/);
                                  if (yearMatch) rel = new Date(`${yearMatch[0]}-01-01`).getTime() || 0;
                                }
                              }
                            }
                          }
                          return Math.max(created, rel);
                        } catch {
                          return 0;
                        }
                      };

                      const valA = getVal(a);
                      const valB = getVal(b);

                      if (valA !== valB) return valB - valA;
                      return String(b.id || "").localeCompare(String(a.id || ""));
                    })
                    .slice(0, 16)
                    .map((p) => {
                      const getYear = (val: any) => {
                        const dateStr = String(val || "");
                        const match = dateStr.match(/\b(20\d{2}|19\d{2})\b/);
                        return match ? match[0] : null;
                      };
                      const year = getYear(
                        p.releaseDate ||
                          p.release_date ||
                          p.metadata?.releaseDate ||
                          p.metadata?.release_date ||
                          p.releaseYear ||
                          p.release_year,
                      );

                      return {
                        id: p.id,
                        title: p.titleEn || p.english_name || p.title || "Game",
                        price: p.price ?? 0,
                        // Latest Nintendo releases shows the vertical retail
                        // box, never the square card art.
                        image: getNintendoMediaUrl(p, "front-box"),
                        source: p,
                        subtitle: year
                          ? `${year} · ${p.developer || p.publisher || ""}`
                          : p.releaseDate || p.release_date || p.developer || p.publisher || "Nintendo Switch",
                        rating: p.metacriticRating ?? null,
                        platform: p.platform,
                      };
                    })}
                  onSelect={(product: any) => onGameClick(product)}
                  formatPrice={formatGenericPrice}
                  onPress={() => playSound("bumper_end", 0.6)}
                  ratingIcon={<BananaIcon className="w-3 h-3 sm:w-4 sm:h-4" solid />}
                  imageRole="front-box"
                  loading={isPending && adminProducts.length === 0}
                />
              </div>
            </section>
          </LazySection>
        </SectionErrorBoundary>

        {/* Dynamic / Custom Categories */}
        {isClient && adminCategories
          .filter((category) => {
            if (!category) return false;
            const catId = String(category.id || category.key || "").toLowerCase();
            const catTitle = String(category.title || category.name || "").toLowerCase();
            if (
              catId === "nintendo-switch-games" ||
              catId === "cat_nintendo" ||
              catId === "nintendo_games" ||
              catId === "cat_1" ||
              catId === "hardware" ||
              catId === "cat_hardware" ||
              catId === "accessories" ||
              catId === "cat_accessories" ||
              catId === "amiibo" ||
              catId === "cat_amiibo" ||
              catId === "gift-cards" ||
              catId === "cat_gift_cards" ||
              catId === "used" ||
              catId === "cat_used" ||
              catId === "bundles" ||
              catTitle.includes("nintendo switch") ||
              catTitle.includes("هاردوير") ||
              catTitle.includes("إكسسوار") ||
              catTitle.includes("amiibo") ||
              catTitle.includes("تعبئة") ||
              catTitle.includes("مستخدم")
            ) {
              return false;
            }
            return true;
          })
          .map((category) => {
            const mapGame = (p: any) => ({
              id: p.id,
              slug: p.slug,
              title: p.titleEn || p.english_name || p.title || "Item",
              price: p.price ?? 0,
              image: resolveNintendoImageUrl(p, "listing-card"),
              source: p,
              subtitle: p.developer || p.publisher || category.title || category.name || "",
              rating: p.metacriticRating ?? null,
              platform: p.platform,
            });

            const categoryProducts = adminProducts
              .filter((p) => p.category === category.id || p.categoryId === category.id)
              .map(mapGame);

            if (categoryProducts.length === 0) return null;

            return (
              <SectionErrorBoundary key={category.id} sectionName={`Category_${category.id}`}>
                <LazySection>
                  <section className="mt-6 w-full max-w-full">
                    <div className="flex items-center justify-between gap-2 mb-4 px-4 sm:px-8">
                      <h3 className="text-xl font-bold text-foreground">
                        {t(category.title || category.name || "Category")}
                      </h3>
                      <Link
                        to="/category/$categoryId"
                        params={{ categoryId: category.id }}
                        className="text-orange-500 hover:text-orange-600 px-2 py-1 text-sm font-bold transition-colors"
                      >
                        {t("common.viewAll")}
                      </Link>
                    </div>
                    <ProductStrip
                      products={categoryProducts}
                      onSelect={(product: any) => onGameClick(product)}
                      formatPrice={formatGenericPrice}
                      onPress={() => playSound("bumper_end", 0.6)}
                      ratingIcon={<BananaIcon className="w-3 h-3 sm:w-4 sm:h-4" solid />}
                      loading={isPending && adminProducts.length === 0}
                    />
                  </section>
                </LazySection>
              </SectionErrorBoundary>
            );
          })}

        {/* Section 5: Hardware & Accessories */}
        <SectionErrorBoundary sectionName="HardwareAccessories">
          <LazySection>
            <section className="mt-8 w-full max-w-full">
              <div className="flex items-center justify-between gap-2 mb-4 px-4 sm:px-8">
                <h3 className="text-xl font-bold text-foreground">أجهزة الهاردوير وملحقاتها</h3>
                <Link
                  to="/category/$categoryId"
                  params={{ categoryId: "hardware" }}
                  className="text-[#EA8918] text-sm font-bold hover:underline"
                >
                  عرض الكل
                </Link>
              </div>
              <ProductStrip
                products={adminProducts
                  .filter((p) => {
                    const resolved = getProductCategory(p);
                    return resolved === "hardware" || resolved === "accessory";
                  })
                  .slice(0, 12)
                  .map((p) => ({
                    id: p.id,
                    slug: p.slug,
                    title: p.titleEn || p.english_name || p.title || "Hardware",
                    subtitle: p.developer || p.publisher || "Hardware & Accessories",
                    price: p.price ?? 0,
                    image: resolveNintendoImageUrl(p, "listing-card"),
                    source: p,
                    rating: p.metacriticRating,
                  }))}
                onSelect={(product: any) => onGameClick(product)}
                formatPrice={formatGenericPrice}
                onPress={() => playSound("bumper_end", 0.6)}
                ratingIcon={<BananaIcon className="w-3 h-3 sm:w-4 sm:h-4" solid />}
                loading={isPending && adminProducts.length === 0}
              />
            </section>
          </LazySection>
        </SectionErrorBoundary>

        {/* Section 6: Amiibo */}
        <SectionErrorBoundary sectionName="Amiibo">
          <LazySection>
            <section className="mt-8 w-full max-w-full">
              <div className="flex items-center justify-between gap-2 mb-4 px-4 sm:px-8">
                <h3 className="text-xl font-bold text-foreground">مجسمات amiibo</h3>
                <Link
                  to="/category/$categoryId"
                  params={{ categoryId: "amiibo" }}
                  className="text-[#EA8918] text-sm font-bold hover:underline"
                >
                  عرض الكل
                </Link>
              </div>
              <ProductStrip
                products={adminProducts
                  .filter((p) => getProductCategory(p) === "amiibo")
                  .slice(0, 12)
                  .map((p) => ({
                    id: p.id,
                    slug: p.slug,
                    title: p.titleEn || p.english_name || p.title || "Amiibo",
                    subtitle: p.developer || "Amiibo",
                    price: p.price ?? 0,
                    image: resolveNintendoImageUrl(p, "listing-card"),
                    source: p,
                    rating: p.metacriticRating,
                  }))}
                onSelect={(product: any) => onGameClick(product)}
                formatPrice={formatGenericPrice}
                onPress={() => playSound("bumper_end", 0.6)}
                ratingIcon={<BananaIcon className="w-3 h-3 sm:w-4 sm:h-4" solid />}
                loading={isPending && adminProducts.length === 0}
              />
            </section>
          </LazySection>
        </SectionErrorBoundary>

        {/* Section 7: Gift Cards */}
        <SectionErrorBoundary sectionName="GiftCards">
          <LazySection>
            <section className="mt-8 w-full max-w-full">
              <div className="flex items-center justify-between gap-2 mb-4 px-4 sm:px-8">
                <h3 className="text-xl font-bold text-foreground">
                  كروت التعبئة Nintendo Gift Cards
                </h3>
                <Link
                  to="/category/$categoryId"
                  params={{ categoryId: "gift-cards" }}
                  className="text-[#EA8918] text-sm font-bold hover:underline"
                >
                  عرض الكل
                </Link>
              </div>
              <ProductStrip
                products={adminProducts
                  .filter((p) => getProductCategory(p) === "gift_card")
                  .slice(0, 12)
                  .map((p) => ({
                    id: p.id,
                    slug: p.slug,
                    title: p.titleEn || p.english_name || p.title || "Gift Card",
                    subtitle: p.developer || "Gift Card",
                    // The price the details page opens on and the picture its
                    // hero leads with — a strip that prints the base price and
                    // the box-art chain contradicted the very page it links to.
                    price: listingPrice(p),
                    image: productImageUrl(p, "listing"),
                    source: p,
                    rating: p.metacriticRating,
                  }))}
                onSelect={(product: any) => onGameClick(product)}
                formatPrice={formatGenericPrice}
                onPress={() => playSound("bumper_end", 0.6)}
                ratingIcon={<BananaIcon className="w-3 h-3 sm:w-4 sm:h-4" solid />}
                loading={isPending && adminProducts.length === 0}
              />
            </section>
          </LazySection>
        </SectionErrorBoundary>

        {/* Section 8: Used Parts & Games */}
        <SectionErrorBoundary sectionName="Used">
          <LazySection>
            <section className="mt-8 w-full max-w-full">
              <div className="flex items-center justify-between gap-2 mb-4 px-4 sm:px-8">
                <h3 className="text-xl font-bold text-foreground">القطع والألعاب المستخدمة</h3>
                <Link
                  to="/category/$categoryId"
                  params={{ categoryId: "used" }}
                  className="text-[#EA8918] text-sm font-bold hover:underline"
                >
                  عرض الكل
                </Link>
              </div>
              <ProductStrip
                products={adminProducts
                  .filter((p) => getProductCategory(p) === "used")
                  .slice(0, 12)
                  .map((p) => ({
                    id: p.id,
                    slug: p.slug,
                    title: p.titleEn || p.english_name || p.title || "Used",
                    subtitle: p.developer || "Used",
                    price: p.price ?? 0,
                    image: resolveNintendoImageUrl(p, "listing-card"),
                    source: p,
                    rating: p.metacriticRating,
                  }))}
                onSelect={(product: any) => onGameClick(product)}
                formatPrice={formatGenericPrice}
                onPress={() => playSound("bumper_end", 0.6)}
                ratingIcon={<BananaIcon className="w-3 h-3 sm:w-4 sm:h-4" solid />}
                loading={isPending && adminProducts.length === 0}
              />
            </section>
          </LazySection>
        </SectionErrorBoundary>

        {/* Section 9: Banana Market */}
        <SectionErrorBoundary sectionName="BananaMarket">
          <LazySection>
            <Suspense
              fallback={
                <div className="h-40 animate-pulse animate-skeleton-shimmer bg-muted/10 rounded-3xl mx-4" />
              }
            >
              <HomeBananaMarket />
            </Suspense>
          </LazySection>
        </SectionErrorBoundary>

        {/* Section 10: News */}
        <SectionErrorBoundary sectionName="NintendoNews">
          <LazySection>
            <section className="mt-8 mb-12 w-full max-w-full">
              <div className="flex items-center gap-2 mb-4 px-4 sm:px-8">
                <h3 className="text-xl font-bold text-foreground">{tr("أحدث أخبار نينتندو")}</h3>
              </div>
              <Suspense
                fallback={
                  <div className="h-40 animate-pulse animate-skeleton-shimmer bg-muted/10 rounded-3xl mx-4" />
                }
              >
                <NintendoNews />
              </Suspense>
            </section>
          </LazySection>
        </SectionErrorBoundary>
      </div>
    </motion.div>
  );
}
