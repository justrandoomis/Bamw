import { tr } from "@/i18n";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import AppShell from "@/components/AppShell";
import Cartridge, { type CartridgeGame } from "@/components/Cartridge";
import StaggerItem from "@/components/StaggerItem";
import { useBatches } from "@/hooks/useBatches";
import { useStoreData } from "@/hooks/useStoreData";
import { GAME_GENRES } from "@/lib/genres";
import { getNintendoMediaUrl } from "@/lib/nintendoImages";
import { filterPurchasable } from "@/lib/purchasable";
import { picturedFirst, squareCardFirst } from "@/lib/listingOrder";
import { isGameProduct } from "@/lib/productSection";
import { playSound } from "@/utils/audio";
import { preloadGameCovers } from "@/lib/imagePreloader";

export const Route = createFileRoute("/games")({
  head: () => ({
    meta: [
      { title: "كل ألعاب ننتندو سويتش — بنانا ستور" },
      {
        name: "description",
        content:
          "استعرض كل أشرطة ألعاب ننتندو سويتش وسويتش 2 المتوفرة في بنانا ستور، مع الفلترة حسب التصنيف وتقييم ميتاكريتيك.",
      },
      { property: "og:title", content: "كل ألعاب ننتندو سويتش — بنانا ستور" },
      {
        property: "og:description",
        content: "كل الأشرطة على المنصة مع فلترة حسب التصنيف وتقييم ميتاكريتيك.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GamesPage,
});

type RawProduct = { [key: string]: any };

function GamesPage() {
  const navigate = useNavigate();
  const [genre, setGenre] = useState<string>("all");
  const [platform, setPlatform] = useState<string>("all");
  const [clickedId, setClickedId] = useState<string | number | null>(null);

  const { data: store, isPending } = useStoreData();
  const loaded = !isPending;
  /*
    Listed, but last. A game the supplier's sheet published with no artwork is
    a real product at a real price and belongs on this page — behind every game
    that has a cover, so a member scrolling the shelf sees the shop before the
    placeholders. The home page leaves them out entirely; this page does not.
  */
  const products: RawProduct[] = useMemo(
    () => picturedFirst(filterPurchasable<RawProduct>((store?.products ?? []) as RawProduct[])),
    [store?.products],
  );

  useEffect(() => {
    if (products.length > 0) {
      preloadGameCovers(products, 30);
    }
  }, [products]);

  /*
    Square art first on the cartridge platform.

    `products` above is already `picturedFirst`, but that asks a different
    question: a game with a retail box cover and no square art passes it and
    still draws a placeholder here, because the cartridge label window is
    square and `getNintendoMediaUrl(p, "square-card")` refuses to squeeze a
    tall box into it. Partitioning again, outside the first one, gives square
    art, then other pictures, then nothing — «الألعاب التي ليس لها صورة مربعة
    تكون في الأخير».
  */
  const games: (CartridgeGame & { genres: string[] })[] = useMemo(
    () =>
      squareCardFirst(products.filter((p) => isGameProduct(p))).map((p) => ({
        id: p["id"],
        title: p["titleEn"] || p["english_name"] || p["title"],
        subtitle: p["developer"] || p["publisher"] || "Nintendo Switch",
        image: getNintendoMediaUrl(p, "square-card"),
        // The cartridge label window reads `nintendo_card_image` when the
        // record has one, so hand it the whole record rather than a URL.
        source: p,
        rating: p["metacriticRating"] ?? null,
        platform: p["platform"],
        genres: Array.isArray(p["genres"]) ? (p["genres"] as string[]) : [],
      })),

    [products],
  );

  const availableGenres = useMemo(() => {
    const present = new Set(games.flatMap((g) => g.genres));
    return GAME_GENRES.filter((g) => present.has(g.id));
  }, [games]);

  const all = useMemo(() => {
    let result = games;
    if (genre !== "all") {
      result = result.filter((g) => g.genres.includes(genre));
    }
    if (platform !== "all") {
      result = result.filter((g) => {
        const p = g.platform as string | undefined;
        if (platform === "switch1") return !p || p === "switch1" || p === "both" || p === "switch";
        if (platform === "switch2") return p === "switch2" || p === "both";
        return true;
      });
    }
    return result;
  }, [games, genre, platform]);

  const gridRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(3);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setColumns(Math.max(1, Math.floor((w + 12) / (115 + 14))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded, all.length]);

  // Load in batches of full rows, revealed with the staggered animation.
  const { visible, hasMore, sentinelRef, delayFor } = useBatches(all, columns * 3);

  const rows = useMemo(() => {
    const out: (typeof visible)[] = [];
    for (let i = 0; i < visible.length; i += columns) out.push(visible.slice(i, i + columns));
    return out;
  }, [visible, columns]);

  const openGame = (game: CartridgeGame) => {
    setClickedId(game.id);
    setTimeout(() => {
      void navigate({ to: "/product/$productId", params: { productId: String(game.id) } });
    }, 400);
  };

  return (
    <AppShell currentView="store">
      <div className="min-h-screen bg-[var(--page)] px-4 pt-6 pb-24">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 mb-4 sm:flex sm:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-black text-foreground">{tr("كل الأشرطة")}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{all.length} لعبة على المنصة</p>
          </div>
          <div className="shrink-0 flex items-center gap-2 text-xs font-bold text-muted-foreground bg-muted/70 px-3 py-1 rounded-full border border-border/50">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>{tr("منصة الأشرطة")}</span>
          </div>
        </header>

        {/* Platform filter */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 w-full max-w-full">
          {[
            { id: "all", label: "كل الأجهزة" },
            { id: "switch1", label: "Nintendo Switch 1" },
            { id: "switch2", label: "Nintendo Switch 2" },
          ].map((p) => (
            <button
              key={p.id}
              onPointerDown={() => playSound("bumper_end", 0.5)}
              onClick={() => setPlatform(p.id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold border transition-colors ${
                platform === p.id
                  ? "bg-red-500 text-white border-red-600"
                  : "bg-card text-muted-foreground border-border"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Genre filter */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-4 w-full max-w-full">
          {[{ id: "all", label: "كل التصنيفات" }, ...availableGenres].map((g) => (
            <button
              key={g.id}
              onPointerDown={() => playSound("bumper_end", 0.5)}
              onClick={() => setGenre(g.id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold border transition-colors ${
                genre === g.id
                  ? "bg-foreground text-background border-border"
                  : "bg-card text-muted-foreground border-border"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        {!loaded ? (
          <div className="flex justify-center py-20">
            <div className="w-10 h-10 border-4 border-border border-t-red-500 rounded-full animate-spin"></div>
          </div>
        ) : all.length === 0 ? (
          <p className="py-20 text-center text-sm text-muted-foreground">
            {tr("لا توجد ألعاب في هذا التصنيف حالياً.")}
          </p>
        ) : (
          <div ref={gridRef} className="mt-2">
            {rows.map((row, rowIndex) => (
              <div key={rowIndex} className="relative mb-10">
                <div
                  className="relative z-10 grid items-end justify-center gap-x-3 overflow-hidden pt-2 sm:gap-x-4"
                  style={{ gridTemplateColumns: `repeat(${columns}, 115px)` }}
                  dir="ltr"
                >
                  {row.map((game, colIndex) => (
                    <StaggerItem key={game.id} delay={delayFor(rowIndex * columns + colIndex)}>
                      <Cartridge
                        game={game}
                        animate={false}
                        clicked={clickedId === game.id}
                        onSelect={openGame}
                      />
                    </StaggerItem>
                  ))}
                  {/* keep the last row aligned with the ones above it */}
                  {Array.from({ length: Math.max(0, columns - row.length) }).map((_, i) => (
                    <div key={`pad-${i}`} className="w-[115px]" aria-hidden />
                  ))}
                </div>

                {/* Shelf */}
                <div className="absolute bottom-[-18px] left-[-16px] right-[-16px] flex flex-col z-0">
                  <div className="h-[6px] w-full bg-gradient-to-b from-[var(--gray-1)] to-[var(--gray-2)]"></div>
                  <div className="h-[12px] w-full bg-gradient-to-b from-[var(--gray-3)] to-[var(--gray-4)] shadow-[0_15px_25px_rgba(0,0,0,0.15)]"></div>
                </div>
              </div>
            ))}
            {hasMore && (
              <div ref={sentinelRef} className="flex justify-center py-8">
                <div className="w-8 h-8 border-[3px] border-border border-t-red-500 rounded-full animate-spin" />
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
