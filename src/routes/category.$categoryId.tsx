import { createFileRoute, useNavigate } from "@tanstack/react-router";
import AppShell from "@/components/AppShell";
import { picturedFirst } from "@/lib/listingOrder";
import { freshnessScore, releaseTime } from "@/lib/listingSort";
import { useStoreData } from "@/hooks/useStoreData";
import { ProductCard } from "@/components/ProductCard";
import { NintendoGameCard } from "@/components/NintendoGameCard";
import { useState, useMemo } from "react";
import { useI18n } from "@/i18n";
import { dirOf } from "@/lib/prefs";
import { Tag, ChevronDown, Gamepad2 } from "lucide-react";
import { CategoryBannerSlideshow } from "@/components/CategoryBannerSlideshow";
import { categoryBannerPool } from "@/lib/categoryBanners";
import { useProgressiveList } from "@/hooks/useProgressiveList";
import { GAME_GENRES, genreLabel } from "@/lib/genres";
import { getProductCategory, isGameProduct } from "@/lib/productSection";
import { isVisibleToPublic } from "@/lib/purchasable";
import { matchesNintendoPlatformFilter } from "@/lib/nintendoListing";

export const Route = createFileRoute("/category/$categoryId")({
  component: CategoryPage,
});

type SortOption = "newest" | "price_asc" | "price_desc" | "rating" | "release_date";
type PlatformOption = "all" | "switch1" | "switch2";

interface GenreItem {
  id: string;
  label: string;
}

function getProductGenres(p: any): string[] {
  const result = new Set<string>();

  // 1. Array or string of genres
  if (Array.isArray(p.genres)) {
    p.genres.forEach((g: any) => {
      if (typeof g === "string" && g.trim()) result.add(g.trim().toLowerCase());
    });
  } else if (typeof p.genres === "string" && p.genres.trim()) {
    try {
      const parsed = JSON.parse(p.genres);
      if (Array.isArray(parsed)) {
        parsed.forEach((g: any) => {
          if (typeof g === "string" && g.trim()) result.add(g.trim().toLowerCase());
        });
      }
    } catch {
      p.genres.split(",").forEach((g: string) => {
        if (g.trim()) result.add(g.trim().toLowerCase());
      });
    }
  }

  // 2. Single genre or CSV
  if (Array.isArray(p.genre)) {
    p.genre.forEach((g: any) => {
      if (typeof g === "string" && g.trim()) result.add(g.trim().toLowerCase());
    });
  } else if (typeof p.genre === "string" && p.genre.trim()) {
    p.genre.split(",").forEach((g: string) => {
      if (g.trim()) result.add(g.trim().toLowerCase());
    });
  }

  // 3. Metadata genres
  if (Array.isArray(p.metadata?.genres)) {
    p.metadata.genres.forEach((g: any) => {
      if (typeof g === "string" && g.trim()) result.add(g.trim().toLowerCase());
    });
  }

  // 4. Tags
  if (Array.isArray(p.tags)) {
    p.tags.forEach((t: any) => {
      if (typeof t === "string" && t.trim()) result.add(t.trim().toLowerCase());
    });
  }

  return Array.from(result);
}

function CategoryPage() {
  const { categoryId } = Route.useParams();
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const direction = dirOf(lang);

  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [platform, setPlatform] = useState<PlatformOption>("all");
  const [selectedGenre, setSelectedGenre] = useState<string>("all");

  /*
    The slim catalogue, through the app's own hook.

    This page called `useQuery({ queryKey: ["store"], queryFn: api.store })`,
    and `api.store` is `/api/data` with no `?slim=1` — the FULL catalogue: every
    product with its description in three languages, its story chapters,
    guides, FAQs, reviews and galleries. Measured against a reconstruction of
    production's 1,714 products that is a 6.78 MB payload the server spends
    64–94 ms building and 28–31 ms serialising on every cold isolate, against a
    78-field slim projection the rest of the app already uses.

    It was worse than one page fetching too much. `useStoreData` uses the SAME
    query key with a different `queryFn`, and TanStack Query keeps one Query
    per key whose options every observer overwrites on render — so this page's
    heavy fetcher became the installed fetcher for every later refetch,
    including the focus refetch that only the slim hook enables. The document
    head preloads `/api/data?slim=1`; on this page that preload could never be
    used, because it is a different URL and therefore a different cache entry
    in both the service worker and the edge. The visitor downloaded the
    catalogue twice and waited on the larger one.

    One observer, one fetcher, one payload — and the preload finally lands.
  */
  const { data: store, isLoading } = useStoreData();

  const categoryInfo = useMemo(() => getCategoryInfo(categoryId, t), [categoryId, t]);

  const isNintendoGames =
    categoryId === "nintendo-switch-games" ||
    categoryId === "cat_nintendo" ||
    categoryId === "nintendo_games" ||
    categoryId === "cat_1";

  // Extract all available genres for this category
  const availableGenres = useMemo<GenreItem[]>(() => {
    if (!store?.products) return [];

    const targetCat = categoryId.toLowerCase();
    const categoryProducts = store.products.filter((p: any) => {
      if (!isVisibleToPublic(p)) return false;
      const resolved = getProductCategory(p);
      if (targetCat === "all") return true;
      if (
        targetCat === "nintendo_games" ||
        targetCat === "cat_nintendo" ||
        targetCat === "nintendo-switch-games"
      ) {
        return resolved === "game";
      }
      if (targetCat === "hardware" || targetCat === "cat_hardware") return resolved === "hardware";
      if (targetCat === "amiibo" || targetCat === "cat_amiibo") return resolved === "amiibo";
      if (targetCat === "accessories" || targetCat === "cat_accessories")
        return resolved === "accessory";
      if (
        targetCat === "gift-cards" ||
        targetCat === "gift_cards" ||
        targetCat === "cat_gift_cards"
      ) {
        return resolved === "gift_card";
      }
      if (targetCat === "used" || targetCat === "cat_used") return resolved === "used";
      const pCat = String(p.category || p.categoryId || "").toLowerCase();
      return pCat === targetCat || resolved === targetCat;
    });

    const genreKeys = new Set<string>();
    categoryProducts.forEach((p: any) => {
      const gList = getProductGenres(p);
      gList.forEach((g) => {
        if (g && g !== "account" && g !== "undefined" && g !== "null") {
          genreKeys.add(g);
        }
      });
    });

    // Map known GAME_GENRES
    const matchedKnown: GenreItem[] = [];
    const matchedKnownIds = new Set<string>();

    GAME_GENRES.forEach((gg) => {
      const isPresent = Array.from(genreKeys).some(
        (k) =>
          k === gg.id ||
          k === gg.label ||
          k.includes(gg.id) ||
          k.includes(gg.label) ||
          gg.label.includes(k),
      );
      if (isPresent) {
        matchedKnown.push(gg);
        matchedKnownIds.add(gg.id);
        matchedKnownIds.add(gg.label.toLowerCase());
      }
    });

    // Add any remaining custom genres
    const customGenres: GenreItem[] = [];
    genreKeys.forEach((k) => {
      if (!matchedKnownIds.has(k)) {
        const customLabel = genreLabel(k);
        customGenres.push({ id: k, label: customLabel });
      }
    });

    // If no specific genres were extracted, supply all standard game genres for Nintendo
    if (matchedKnown.length === 0 && customGenres.length === 0 && isNintendoGames) {
      return GAME_GENRES;
    }

    return [...matchedKnown, ...customGenres];
  }, [store?.products, categoryId, isNintendoGames]);

  const products = useMemo(() => {
    if (!store?.products) return [];

    const filtered = store.products.filter((p: any) => {
      // Basic visibility & active check
      if (!isVisibleToPublic(p)) return false;

      // Category check
      const targetCat = categoryId.toLowerCase();
      const resolved = getProductCategory(p);

      let isCatMatch = false;
      if (targetCat === "all") {
        isCatMatch = true;
      } else if (
        targetCat === "nintendo_games" ||
        targetCat === "cat_nintendo" ||
        targetCat === "nintendo-switch-games"
      ) {
        isCatMatch = resolved === "game";
      } else if (targetCat === "hardware" || targetCat === "cat_hardware") {
        isCatMatch = resolved === "hardware";
      } else if (targetCat === "amiibo" || targetCat === "cat_amiibo") {
        isCatMatch = resolved === "amiibo";
      } else if (targetCat === "accessories" || targetCat === "cat_accessories") {
        isCatMatch = resolved === "accessory";
      } else if (
        targetCat === "gift-cards" ||
        targetCat === "gift_cards" ||
        targetCat === "cat_gift_cards"
      ) {
        isCatMatch = resolved === "gift_card";
      } else if (targetCat === "used" || targetCat === "cat_used") {
        isCatMatch = resolved === "used";
      } else {
        const pCat = String(p.category || p.categoryId || "").toLowerCase();
        isCatMatch = pCat === targetCat || resolved === targetCat;
      }

      if (!isCatMatch) return false;

      // Platform filter
      if (!matchesNintendoPlatformFilter(p, platform)) return false;

      // Genre filter
      if (selectedGenre !== "all") {
        const pGenres = getProductGenres(p);
        const selLower = selectedGenre.toLowerCase();
        const selLabel = genreLabel(selectedGenre).toLowerCase();

        const matchGenre = pGenres.some((g) => {
          const gLower = g.toLowerCase();
          return (
            gLower === selLower ||
            gLower === selLabel ||
            gLower.includes(selLower) ||
            selLower.includes(gLower) ||
            gLower.includes(selLabel) ||
            selLabel.includes(gLower)
          );
        });

        if (!matchGenre) return false;
      }

      return true;
    });

    /*
      Sort keys computed ONCE per product, not inside the comparator.

      Both date sorts built their key in a closure the comparator called on
      BOTH operands, so a sort of 1,714 games ran that closure about 29,270
      times — each call constructing up to two `Date`s and running up to two
      regexes over a string. Measured on this catalogue: 35.2 ms against 2.9 ms
      for the identical ordering with the key computed once per product.

      This is the ordinary decorate–sort–undecorate, and it is exactly
      equivalent: the same key function, the same tie-break on id, just not
      recomputed n log n times.
    */
    const keyed =
      sortBy === "release_date"
        ? new Map(filtered.map((p: any) => [p, releaseTime(p)]))
        : sortBy === "newest" || !["price_asc", "price_desc", "rating"].includes(sortBy)
          ? new Map(filtered.map((p: any) => [p, freshnessScore(p)]))
          : null;

    filtered.sort((a: any, b: any) => {
      switch (sortBy) {
        case "price_asc":
          return (Number(a.price) || 0) - (Number(b.price) || 0);
        case "price_desc":
          return (Number(b.price) || 0) - (Number(a.price) || 0);
        case "rating":
          return (Number(b.metacriticRating) || 0) - (Number(a.metacriticRating) || 0);
        default: {
          const valA = keyed?.get(a) ?? 0;
          const valB = keyed?.get(b) ?? 0;
          if (valA !== valB) return valB - valA;
          return String(b.id || "").localeCompare(String(a.id || ""));
        }
      }
    });

    /*
      Whatever the member chose to sort by, a listing with no artwork comes
      after the ones that have it. A stable partition, so «الأرخص» is still
      cheapest-first inside each group rather than being scrambled by a second
      sort on a boolean.
    */
    return picturedFirst(filtered);
  }, [store?.products, categoryId, sortBy, platform, selectedGenre]);

  /*
    The pictures behind the header, bounded to a poolful.

    This built a Set of EVERY screenshot, gallery image, hero and wallpaper URL
    across every product in the category — on the games shelf that is thousands
    of strings — and then an effect preloaded all of them at once with
    `new Image()`, each `onload` writing to a `loadedBannerIndices` map that no
    part of the render ever read. Thousands of requests and thousands of full
    page re-renders, for a value nobody used, on a page that also had 1,714
    product cards mounted.

    `categoryBannerPool` keeps the same eligibility rules and samples them down
    to two dozen, and the slideshow below fetches only the picture it is about
    to show.
  */
  const productBanners = useMemo(
    () => categoryBannerPool(store?.products, categoryId),
    [store?.products, categoryId],
  );

  /*
    A screenful at a time, growing as the member scrolls, never shrinking.
    See useProgressiveList: mounting all 1,714 cards at once is where both the
    scroll stutter and the "the products load again when I scroll back up"
    came from.
  */
  const {
    visible: visibleProducts,
    sentinelRef,
    done: allShown,
  } = useProgressiveList(products, {
    initial: isNintendoGames ? 60 : 24,
    step: isNintendoGames ? 45 : 20,
  });

  return (
    <AppShell currentView="store" onBack={() => navigate({ to: "/" })}>
      <div className="min-h-screen bg-[var(--page)] pb-24" dir={direction}>
        {/* Header Section / Banner Slideshow */}
        <div
          className={`relative pt-20 pb-10 px-6 overflow-hidden min-h-[260px] sm:min-h-[300px] flex items-center justify-center ${categoryInfo.bgColor}`}
        >
          {/* Background Game Slideshow */}
          <div className="absolute inset-0 z-0 select-none overflow-hidden">
            <CategoryBannerSlideshow banners={productBanners} />
          </div>

          <div className="relative z-10 max-w-7xl mx-auto flex flex-col items-center text-center">
            {/* Header Content */}
          </div>
        </div>

        {/* Sticky Toolbar Section on Mobile Only */}
        <div className="md:hidden sticky top-0 z-40 bg-[var(--page)]/95 backdrop-blur-xl border-b border-border shadow-sm transition-all">
          <div className="max-w-7xl mx-auto px-4 py-2.5 flex flex-col gap-2">
            {/* Top Toolbar Row: Sort, Period, Platform, and Filter Count */}
            <div className="flex items-center justify-between gap-3">
              {/*
                `min-w-0` is the whole fix for this row. A flex item defaults to
                `min-width: auto`, so this scroller refused to shrink below its
                content and instead squeezed the pill group inside it until the
                labels spilled out past their own rounded border — the clipped
                "Switch 1 / Switch 2" chips. With `min-w-0` the scroller takes
                the width that is available and scrolls its own content, which
                is what `overflow-x-auto` was there to do.
              */}
              <div className="flex min-w-0 items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
                {/* Sort / Period Selector */}
                <div className="relative flex shrink-0 items-center">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    aria-label={t("الفترة والترتيب")}
                    className="bg-card text-foreground border border-border rounded-full ps-3 pe-8 py-1.5 text-xs sm:text-sm font-bold focus:outline-none focus:ring-2 focus:ring-red-500/20 appearance-none cursor-pointer shadow-sm hover:border-foreground/30 transition-colors"
                  >
                    <option value="newest">{t("الأحدث")}</option>
                    <option value="release_date">{t("تاريخ الإصدار")}</option>
                    <option value="price_asc">{t("السعر: من الأقل")}</option>
                    <option value="price_desc">{t("السعر: من الأعلى")}</option>
                    <option value="rating">{t("التقييم")}</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute end-2.5 h-3.5 w-3.5 text-muted-foreground" />
                </div>

                {/* Platform selector pills */}
                <div className="flex shrink-0 items-center gap-1 bg-card/80 p-0.5 rounded-full border border-border">
                  {[
                    { id: "all", label: t("الكل") },
                    { id: "switch1", label: "Switch 1" },
                    { id: "switch2", label: "Switch 2" },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPlatform(p.id as PlatformOption)}
                      className={`shrink-0 whitespace-nowrap px-3 py-1 rounded-full text-xs font-bold transition-all ${
                        platform === p.id
                          ? "bg-foreground text-background shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Product Counter Badge */}
              <div className="text-xs font-bold text-muted-foreground bg-muted/60 px-3 py-1 rounded-full shrink-0">
                {products.length} {t("لعبة")}
              </div>
            </div>

            {/* Bottom Toolbar Row: Game Genres (التصنيف حسب genres اللعبة) */}
            <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
              <span className="text-[11px] font-black text-muted-foreground uppercase ps-1 pe-2 shrink-0 flex items-center gap-1">
                <Tag className="w-3 h-3 text-red-500" />
                {t("التصنيف")}:
              </span>

              <button
                onClick={() => setSelectedGenre("all")}
                className={`shrink-0 px-3.5 py-1 rounded-full text-xs font-bold border transition-all ${
                  selectedGenre === "all"
                    ? "bg-red-500 text-white border-red-600 shadow-sm shadow-red-500/25"
                    : "bg-card text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground"
                }`}
              >
                {t("الكل")}
              </button>

              {availableGenres.map((g) => {
                const isSelected = selectedGenre === g.id || selectedGenre === g.label;
                return (
                  <button
                    key={g.id}
                    onClick={() => setSelectedGenre(isSelected ? "all" : g.id)}
                    className={`shrink-0 px-3.5 py-1 rounded-full text-xs font-bold border transition-all ${
                      isSelected
                        ? "bg-red-500 text-white border-red-600 shadow-sm shadow-red-500/25"
                        : "bg-card text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground"
                    }`}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Product Grid and Sidebar Filter */}
        <div
          className={`mx-auto flex max-w-7xl flex-col gap-8 py-6 md:flex-row md:items-start ${isNintendoGames ? "px-3 sm:px-4" : "px-4"}`}
        >
          {/* Desktop Sidebar Filter */}
          <div className="hidden md:block w-64 shrink-0 space-y-6 sticky top-24 z-10 self-start max-h-[calc(100vh-7rem)] overflow-y-auto no-scrollbar pb-2">
            <div className="bg-card/40 p-4 rounded-2xl border border-border/80">
              <h3 className="text-sm font-black text-muted-foreground uppercase mb-3 px-1 tracking-wider flex items-center gap-2">
                <Tag className="w-4 h-4 text-red-500" />
                {t("تصنيفات الألعاب")}
              </h3>
              <div className="flex flex-col gap-1 max-h-[480px] overflow-y-auto no-scrollbar pe-1">
                <button
                  onClick={() => setSelectedGenre("all")}
                  className={`w-full text-start px-3.5 py-2 rounded-xl text-sm font-bold transition-all ${
                    selectedGenre === "all"
                      ? "bg-red-500 text-white shadow-md shadow-red-500/20"
                      : "text-foreground hover:bg-card hover:translate-x-[-2px]"
                  }`}
                >
                  {t("كل التصنيفات")}
                </button>
                {availableGenres.map((g) => {
                  const isSelected = selectedGenre === g.id || selectedGenre === g.label;
                  return (
                    <button
                      key={g.id}
                      onClick={() => setSelectedGenre(isSelected ? "all" : g.id)}
                      className={`w-full text-start px-3.5 py-2 rounded-xl text-sm font-bold transition-all ${
                        isSelected
                          ? "bg-red-500 text-white shadow-md shadow-red-500/20"
                          : "text-foreground hover:bg-card hover:translate-x-[-2px]"
                      }`}
                    >
                      {g.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-card/40 p-4 rounded-2xl border border-border/80">
              <h3 className="text-sm font-black text-muted-foreground uppercase mb-3 px-1 tracking-wider flex items-center gap-2">
                <Gamepad2 className="w-4 h-4 text-red-500" />
                {t("الجهاز")}
              </h3>
              <div className="flex flex-col gap-1">
                {[
                  { id: "all", label: t("كل الأجهزة") },
                  { id: "switch1", label: "Nintendo Switch 1" },
                  { id: "switch2", label: "Nintendo Switch 2" },
                ].map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPlatform(p.id as PlatformOption)}
                    className={`w-full text-start px-3.5 py-2 rounded-xl text-sm font-bold transition-all ${
                      platform === p.id
                        ? "bg-foreground text-background shadow-md"
                        : "text-foreground hover:bg-card hover:translate-x-[-2px]"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Product Cards Grid */}
          <div className="min-w-0 flex-1">
            {isLoading ? (
              <div
                className={
                  isNintendoGames
                    ? "grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5"
                    : "grid grid-cols-2 gap-6 sm:grid-cols-2 lg:grid-cols-4"
                }
                dir={isNintendoGames ? direction : "ltr"}
              >
                {Array.from({ length: isNintendoGames ? 10 : 8 }, (_, i) => i).map((i) => (
                  <div
                    key={i}
                    className={`${isNintendoGames ? "aspect-[4/5] rounded-[14px]" : "aspect-[3/4] rounded-2xl"} animate-pulse animate-skeleton-shimmer bg-muted/20`}
                  />
                ))}
              </div>
            ) : products.length > 0 ? (
              <div className="flex flex-col gap-6">
                <div
                  className={
                    isNintendoGames
                      ? "grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5"
                      : "grid grid-cols-2 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4"
                  }
                  dir={isNintendoGames ? direction : "ltr"}
                >
                  {/*
                    A plain div with a CSS reveal, not a `motion.div` with
                    `whileInView`. That wrapper installed an
                    IntersectionObserver PER CARD — 1,714 of them on this shelf,
                    all live while the member scrolls — to do what one CSS
                    animation on mount does for nothing. With the window above
                    growing a screenful at a time, a card mounts just before it
                    is reached, so the reveal still happens where it used to.
                  */}
                  {visibleProducts.map((p: any, index: number) => (
                    <div key={p.id} className="min-w-0 animate-fade-up">
                      {isNintendoGames ? (
                        <NintendoGameCard product={p} priority={index < 6} />
                      ) : (
                        <ProductCard product={p} imageRole="front-box" />
                      )}
                    </div>
                  ))}
                </div>

                {allShown ? null : (
                  <div ref={sentinelRef} className="flex justify-center py-6">
                    <span className="sr-only">{t("جاري تحميل المزيد")}</span>
                    <div
                      className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-red-500"
                      aria-hidden="true"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-24 bg-card rounded-3xl border border-dashed border-border px-6">
                <div className="text-5xl mb-4">🎮</div>
                <h3 className="text-xl font-bold text-foreground mb-1">
                  {t("لا توجد ألعاب متطابقة")}
                </h3>
                <p className="text-muted-foreground text-sm mb-4">
                  {t("جرب تغيير خيارات التصفية أو اختيار تصنيف آخر")}
                </p>
                <button
                  onClick={() => {
                    setSelectedGenre("all");
                    setPlatform("all");
                    setSortBy("newest");
                  }}
                  className="px-4 py-2 bg-red-500 text-white rounded-full text-xs font-bold hover:bg-red-600 transition-colors"
                >
                  {t("إعادة تعيين الفلاتر")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function getCategoryInfo(id: string, t: (k: string) => string) {
  const base = {
    title: t(id) || id,
    description: t("تصفح أحدث المنتجات"),
    bgColor: "bg-gradient-to-br from-gray-800 to-black",
    icon: "🎮",
  };

  switch (id) {
    case "nintendo-switch-games":
    case "cat_nintendo":
    case "nintendo_games":
      return {
        ...base,
        title: t("ألعاب نينتندو سويتش"),
        description: t("مجموعة واسعة من الألعاب الرقمية والفيزيائية"),
        bgColor: "bg-gradient-to-br from-[#E60012] to-[#8B0000]",
        icon: "🎰",
      };
    case "hardware":
      return {
        ...base,
        title: t("أجهزة الهاردوير وملحقاتها"),
        description: t("أحدث أجهزة نينتندو وملحقاتها الأصلية"),
        bgColor: "bg-gradient-to-br from-[#2D3436] to-[#000000]",
        icon: "🎮",
      };
    case "amiibo":
      return {
        ...base,
        title: t("مجسمات amiibo"),
        description: t("شخصياتك المفضلة بلمسة سحرية"),
        bgColor: "bg-gradient-to-br from-[#00B894] to-[#006266]",
        icon: "👾",
      };
    case "accessories":
      return {
        ...base,
        title: t("الإكسسوارات"),
        description: t("حقائب، حافظات، وكل ما يحتاجه جهازك"),
        bgColor: "bg-gradient-to-br from-[#FAB1A0] to-[#E17055]",
        icon: "🎧",
      };
    case "gift-cards":
      return {
        ...base,
        title: t("كروت التعبئة"),
        description: t("بطاقات هدايا لمختلف المتاجر العالمية"),
        bgColor: "bg-gradient-to-br from-[#0984E3] to-[#4834D4]",
        icon: "💳",
      };
    case "used":
      return {
        ...base,
        title: t("القطع والألعاب المستخدمة"),
        description: t("ألعاب وقطع بحالة ممتازة وبأسعار توفيرية"),
        bgColor: "bg-gradient-to-br from-[#6C5CE7] to-[#2D3436]",
        icon: "♻️",
      };
    default:
      return base;
  }
}
