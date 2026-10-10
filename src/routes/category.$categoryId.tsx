import { createFileRoute, useNavigate } from "@tanstack/react-router";
import AppShell from "@/components/AppShell";
import { picturedFirst } from "@/lib/listingOrder";
import { UNRANKED, bestSellerRank } from "@/lib/bestSellers";
import { listingPricing } from "@/lib/productPricing";
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

/*
  «اجعل الالعاب الاكثر مبيعا عالميا تظهر افتراضيا وليس ترتيب عشوائي»

  `best_sellers` is new and is the default. `newest` is kept, because it is a
  real thing a customer might want — it simply was not a sensible DEFAULT for a
  catalogue where 1,530 games were imported in one batch and therefore all share
  a timestamp to the minute, which reads as no order at all.
*/
type SortOption =
  "best_sellers" | "newest" | "price_asc" | "price_desc" | "rating" | "release_date";
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

  const [sortBy, setSortBy] = useState<SortOption>("best_sellers");
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
        : sortBy === "newest" ||
            !["best_sellers", "price_asc", "price_desc", "rating"].includes(sortBy)
          ? new Map(filtered.map((p: any) => [p, freshnessScore(p)]))
          : null;

    /*
      The best-seller rank, computed once per product for the same reason every
      other sort key here is: the comparator runs about 29,270 times on this
      shelf, and `bestSellerRank` folds and scans a title.

      Freshness is the tiebreak, so the thousand-odd games the list does not
      name keep the order they had before — this puts a head on the shelf, it
      does not reshuffle the tail.
    */
    /*
      «السعر: من الأقل» has to sort by the number ON the card.

      It sorted by `product.price`, which since the card started leading with
      the ordinary offline account is not what any of these cards print — a
      product whose offline tier is a row has a `price` no customer sees. A
      cheapest-first shelf that disagrees with its own visible prices is worse
      than no sort at all. Computed once per product, like every other key here.
    */
    const priced =
      sortBy === "price_asc" || sortBy === "price_desc"
        ? new Map(filtered.map((p: any) => [p, listingPricing(p).unitPrice || 0]))
        : null;

    const ranked =
      sortBy === "best_sellers"
        ? new Map(
            filtered.map((p: any) => [
              p,
              [bestSellerRank(p.titleEn || p.english_name || p.title), freshnessScore(p)] as const,
            ]),
          )
        : null;

    filtered.sort((a: any, b: any) => {
      switch (sortBy) {
        case "best_sellers": {
          const [rankA, freshA] = ranked?.get(a) ?? [UNRANKED, 0];
          const [rankB, freshB] = ranked?.get(b) ?? [UNRANKED, 0];
          if (rankA !== rankB) return rankA - rankB;
          if (freshA !== freshB) return freshB - freshA;
          return String(b.id || "").localeCompare(String(a.id || ""));
        }
        case "price_asc":
          return (priced?.get(a) ?? 0) - (priced?.get(b) ?? 0);
        case "price_desc":
          return (priced?.get(b) ?? 0) - (priced?.get(a) ?? 0);
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
    /*
      What counts as a DIFFERENT shelf — and nothing else does.

      `products` is a fresh array every time the catalogue query answers, and
      it answers on every visit: the device's snapshot paints first and the
      network's replaces it, then a focus or the fifteen-second staleness
      refetches again. Resetting on the array would throw a member who is 800
      cards down back to the first sixty a second after they started
      scrolling — «تحمل المنتجات من جديد» exactly, which is the fault this
      window exists to fix.
    */
    resetKey: `${categoryId}|${sortBy}|${platform}|${selectedGenre}`,
  });

  const unit = isNintendoGames ? t("لعبة") : t("منتج");
  const platformOptions: { id: PlatformOption; label: string }[] = [
    { id: "all", label: t("الكل") },
    { id: "switch1", label: "Switch 1" },
    { id: "switch2", label: "Switch 2" },
  ];
  const filtersActive = selectedGenre !== "all" || platform !== "all";
  /* Nothing to sort and nothing to filter: the toolbar would be a bar of nothing. */
  const showToolbar = isLoading || products.length > 0 || filtersActive;
  const resetFilters = () => {
    setSelectedGenre("all");
    setPlatform("all");
    setSortBy("best_sellers");
  };

  return (
    <AppShell currentView="store" onBack={() => navigate({ to: "/" })}>
      <div className="min-h-screen pb-24" dir={direction}>
        {/*
          The shelf's own name, finally. The banner used to fill the width
          edge to edge with an empty block where the title belonged, so the
          page never said what it was. Now it is a card of clay: the games'
          own art behind, darkened at the foot so the name reads over it.
        */}
        <header className="px-3 pt-3 sm:px-4 sm:pt-4">
          <div
            className={`relative mx-auto max-w-7xl overflow-hidden rounded-[28px] border border-[var(--clay-rim)] shadow-lg ${categoryInfo.bgColor}`}
          >
            <div className="absolute inset-0 select-none" aria-hidden="true">
              <CategoryBannerSlideshow banners={productBanners} />
            </div>
            <div
              aria-hidden="true"
              className="absolute inset-0 z-10 bg-gradient-to-t from-black/80 via-black/30 to-transparent"
            />
            <div className="relative z-20 flex min-h-[188px] flex-col justify-end p-5 text-white sm:min-h-[248px] sm:p-8">
              <p className="text-[12px] font-bold text-white/80 sm:text-[13px]">
                <span dir="ltr" className="tabular-nums">
                  {products.length.toLocaleString("en-US")}
                </span>{" "}
                {unit}
              </p>
              <h1 className="mt-0.5 text-[26px] font-black leading-[1.1] tracking-[-0.02em] text-balance sm:text-[38px]">
                {categoryInfo.title}
              </h1>
              <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-white/85 sm:text-[15px]">
                {categoryInfo.description}
              </p>
            </div>
          </div>
        </header>

        {/*
          One toolbar for every width, kept under the top bar while the shelf
          scrolls: the device as a segmented control (a pressed track with the
          chosen segment raised out of it), the order, and the genres.
        */}
        {showToolbar ? (
          <div className="sticky top-[var(--header-h)] z-30 px-3 pt-3 sm:px-4">
            <div className="mx-auto max-w-7xl rounded-[22px] border border-[var(--clay-rim)] bg-[var(--page)]/85 p-2 shadow-md backdrop-blur-xl">
              <div className="flex items-center gap-2">
                {isNintendoGames ? (
                  <div
                    role="group"
                    aria-label={t("الجهاز")}
                    className="flex min-w-0 shrink items-center gap-0.5 rounded-full bg-muted/70 p-1"
                  >
                    {platformOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setPlatform(option.id)}
                        aria-pressed={platform === option.id}
                        className={`min-h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-[12px] font-bold transition-colors ${
                          platform === option.id
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="relative ms-auto flex shrink-0 items-center">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    aria-label={t("الفترة والترتيب")}
                    className="min-h-9 cursor-pointer appearance-none rounded-full border border-[var(--clay-rim)] bg-card pe-8 ps-3.5 text-[12px] font-bold text-foreground shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]/40"
                  >
                    <option value="best_sellers">{t("الأكثر مبيعًا عالميًا")}</option>
                    <option value="newest">{t("الأحدث")}</option>
                    <option value="release_date">{t("تاريخ الإصدار")}</option>
                    <option value="price_asc">{t("السعر: من الأقل")}</option>
                    <option value="price_desc">{t("السعر: من الأعلى")}</option>
                    <option value="rating">{t("التقييم")}</option>
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute end-3 h-3.5 w-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
              </div>

              {availableGenres.length > 0 ? (
                <div
                  role="group"
                  aria-label={t("التصنيف")}
                  className="no-scrollbar -mx-2 mt-2 flex min-w-0 items-center gap-1.5 overflow-x-auto px-2 pb-0.5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
                >
                  <Tag
                    className="h-3.5 w-3.5 shrink-0 text-[var(--brand-red)]"
                    aria-hidden="true"
                  />
                  {[{ id: "all", label: t("الكل") }, ...availableGenres].map((g) => {
                    const isSelected =
                      g.id === "all"
                        ? selectedGenre === "all"
                        : selectedGenre === g.id || selectedGenre === g.label;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() =>
                          setSelectedGenre(isSelected || g.id === "all" ? "all" : g.id)
                        }
                        aria-pressed={isSelected}
                        className={`min-h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[12px] font-bold transition-colors ${
                          isSelected
                            ? "bg-[var(--brand-red)] text-primary-foreground"
                            : "border border-[var(--clay-rim)] bg-card text-muted-foreground shadow-sm hover:text-foreground"
                        }`}
                      >
                        {g.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* The shelf */}
        <div
          className={`mx-auto flex max-w-7xl flex-col gap-6 pt-4 ${isNintendoGames ? "px-3 sm:px-4" : "px-4"}`}
        >
          <div className="min-w-0 flex-1">
            {isLoading ? (
              <div
                className={
                  isNintendoGames
                    ? "grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3.5 lg:grid-cols-5 xl:grid-cols-6"
                    : "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                }
                dir={isNintendoGames ? direction : "ltr"}
              >
                {Array.from({ length: isNintendoGames ? 12 : 8 }, (_, i) => i).map((i) => (
                  <div
                    key={i}
                    className={`${isNintendoGames ? "aspect-[4/5] rounded-[20px]" : "aspect-[3/4] rounded-[22px]"} animate-pulse bg-muted/50`}
                  />
                ))}
              </div>
            ) : products.length > 0 ? (
              <div className="flex flex-col gap-6">
                <div
                  className={
                    isNintendoGames
                      ? "grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3.5 lg:grid-cols-5 xl:grid-cols-6"
                      : "grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 xl:grid-cols-5"
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
                      className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-[var(--brand-red)]"
                      aria-hidden="true"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="mx-auto mt-6 flex max-w-md flex-col items-center rounded-[28px] border border-[var(--clay-rim)] bg-card px-6 py-12 text-center shadow-md">
                <div className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-muted/70">
                  <Gamepad2 className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
                </div>
                {/*
                  Two different empties: a filter that matched nothing can be
                  undone, a section with nothing in it yet cannot — offering
                  «reset the filters» there points at a button that does nothing.
                */}
                <h2 className="mt-4 text-[18px] font-black text-foreground">
                  {filtersActive
                    ? isNintendoGames
                      ? t("لا توجد ألعاب متطابقة")
                      : t("لا توجد منتجات متطابقة")
                    : t("لا توجد منتجات في هذا القسم بعد")}
                </h2>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {filtersActive
                    ? t("جرب تغيير خيارات التصفية أو اختيار تصنيف آخر")
                    : t("تصفّح بقية أقسام المتجر حتى نضيف منتجات هنا.")}
                </p>
                <button
                  type="button"
                  onClick={filtersActive ? resetFilters : () => navigate({ to: "/" })}
                  className="mt-5 min-h-11 rounded-full bg-[var(--brand-red)] px-5 text-[13px] font-bold text-primary-foreground"
                >
                  {filtersActive ? t("إعادة تعيين الفلاتر") : t("العودة إلى المتجر")}
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
