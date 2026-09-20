import React, { useState } from "react";
import Cartridge, { type CartridgeGame } from "./Cartridge";
import StaggerItem from "./StaggerItem";
import { useBatches } from "@/hooks/useBatches";
import NintendoCover from "./NintendoCover";
import type { NintendoMediaRole } from "@/lib/nintendoImages";
import NintendoGameCard from "./NintendoGameCard";

/**
 * How many cards in a strip are treated as above the fold.
 *
 * Three is what fits across the narrowest supported phone (320px) before the
 * strip scrolls. Every card used to be lazy with low fetch priority, which put
 * the homepage's LCP candidate at the back of the queue.
 */
const PRIORITY_CARDS = 3;

/**
 * Horizontal cartridge shelf. Renders in batches: reaching the end of the strip
 * reveals the next batch with the staggered fade-in.
 */
export function CartridgeStrip({
  games,
  clickedId,
  onSelect,
}: {
  games: (CartridgeGame & { [k: string]: any })[];
  clickedId: string | number | null;
  onSelect: (game: any) => void;
}) {
  const { visible, hasMore, sentinelRef, delayFor } = useBatches(games, 8);

  return (
    <div
      className="flex gap-3.5 overflow-x-auto pt-2 px-4 sm:px-8 no-scrollbar snap-x relative z-10 items-end w-full max-w-full"
      dir="ltr"
    >
      {visible.map((game, i) => (
        <StaggerItem key={game.id} className="shrink-0" delay={delayFor(i)}>
          <Cartridge
            game={game}
            index={i}
            animate={false}
            clicked={clickedId === game.id}
            onSelect={() => onSelect(game)}
            /* The first row is on screen at first paint; the rest is a
               horizontal scroll away and can wait. */
            priority={i < PRIORITY_CARDS}
          />
        </StaggerItem>
      ))}
      {hasMore && (
        <div
          ref={sentinelRef}
          className="shrink-0 w-[115px] h-[196px] flex items-center justify-center"
        >
          <div className="w-6 h-6 border-2 border-border border-t-red-500 rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}

export function CartridgeSkeleton() {
  return (
    <div
      className="flex gap-3.5 overflow-x-auto pt-2 px-4 sm:px-8 no-scrollbar items-end w-full max-w-full"
      dir="ltr"
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="shrink-0 w-[115px] h-[196px] bg-muted/20 rounded-2xl animate-pulse animate-skeleton-shimmer"
        />
      ))}
    </div>
  );
}

/**
 * The square Nintendo game shelf used directly below the store services.
 * Products are supplied in their final business order by HomeView; batching
 * only limits initial DOM and image work and never repeats or omits a game.
 */
export function NintendoGameStrip({
  products,
  formatPrice,
  direction,
}: {
  products: Record<string, any>[];
  formatPrice: (value: number | string) => string;
  direction: "ltr" | "rtl";
}) {
  const { visible, hasMore, sentinelRef, delayFor } = useBatches(products, 12, 250);

  return (
    <div
      className="flex w-full max-w-full touch-pan-x snap-x snap-mandatory gap-2.5 overflow-x-auto overscroll-x-contain scroll-smooth px-4 pb-3 pt-1 no-scrollbar sm:gap-3 sm:px-8"
      dir={direction}
      aria-label="Nintendo Switch games"
    >
      {visible.map((product, index) => (
        <StaggerItem
          key={String(product.id ?? product.slug ?? index)}
          className="shrink-0 snap-start"
          delay={delayFor(index)}
        >
          <NintendoGameCard
            product={product}
            priority={index < PRIORITY_CARDS}
            formatPrice={formatPrice}
            className="w-[136px] sm:w-[158px]"
          />
        </StaggerItem>
      ))}

      {hasMore ? (
        <div
          ref={sentinelRef}
          className="flex min-h-[190px] w-16 shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-red-500" />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Horizontal card strip used by the non-cartridge sections.
 *
 * The strip is reused by sections that want different pictures — "Latest
 * Nintendo releases" wants the vertical retail box — so the section names the
 * role and the strip passes it through unchanged.
 */

export function ProductStrip({
  products,
  onSelect,
  formatPrice,
  onPress,
  ratingIcon,
  imageRole = "front-box",
  loading = false,
}: {
  products: any[];
  onSelect: (product: any) => void;
  formatPrice: (value: any) => string;
  onPress: () => void;
  ratingIcon: React.ReactNode;
  /** Which picture this section wants. See src/lib/nintendoImages.ts. */
  imageRole?: NintendoMediaRole;
  loading?: boolean;
}) {
  const [clickedId, setClickedId] = useState<string | number | null>(null);
  const { visible, hasMore, sentinelRef, delayFor } = useBatches(products, 8);

  if (loading && products.length === 0) {
    return (
      <div
        className="flex gap-3 overflow-x-auto no-scrollbar pb-4 px-4 sm:px-8 w-full max-w-full"
        dir="ltr"
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="w-[140px] sm:w-[160px] h-[200px] shrink-0 bg-muted/20 rounded-2xl animate-pulse animate-skeleton-shimmer"
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex gap-3 overflow-x-auto no-scrollbar pb-4 snap-x px-4 sm:px-8 w-full max-w-full"
      dir="ltr"
    >
      {visible.map((product, i) => (
        <StaggerItem key={product.id || i} className="shrink-0" delay={delayFor(i)}>
          <div
            className={`w-[140px] sm:w-[160px] bg-card rounded-2xl p-2 shadow-sm border border-border snap-start cursor-pointer hover:shadow-md transition-all group relative ${clickedId === product.id ? "scale-[0.98] opacity-90" : ""}`}
            onPointerDown={onPress}
            onClick={() => {
              if (clickedId != null) return;
              setClickedId(product.id);
              setTimeout(() => onSelect(product), 50);
            }}
          >
            <div className="overflow-hidden rounded-xl mb-3 relative">
              {/*
                One frame ratio for the whole row, so a strip of covers is a
                strip of equal rectangles however mixed the sources are. The
                artwork is fitted whole rather than cropped to fill, and any
                empty margin around it has already been trimmed away — so
                `contain` here cannot reintroduce the letterbox it used to.
              */}
              <NintendoCover
                product={product.source ?? product}
                usage={imageRole}
                alt={product.title}
                loading={i < PRIORITY_CARDS ? "eager" : "lazy"}
                fetchPriority={i < PRIORITY_CARDS ? "high" : "auto"}
                className="w-full rounded-xl"
                imgClassName="group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors"></div>
              {clickedId === product.id && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                </div>
              )}
            </div>
            <h4 className="font-bold text-sm sm:text-base text-foreground truncate" dir="ltr">
              {product.titleEn || product.english_name || product.title}
            </h4>
            <p className="text-xs sm:text-sm text-muted-foreground truncate" dir="ltr">
              {product.subtitle}
            </p>
            <div className="flex justify-between items-center mt-3">
              <div className="flex items-center text-amber-500 text-xs sm:text-sm font-bold gap-1 flex-row-reverse">
                {product.rating} {ratingIcon}
              </div>
              <div className="text-foreground text-xs sm:text-sm font-bold" dir="ltr">
                {formatPrice(product.price)}
              </div>
            </div>
          </div>
        </StaggerItem>
      ))}
      {hasMore && (
        <div ref={sentinelRef} className="shrink-0 w-[140px] flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-border border-t-red-500 rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
