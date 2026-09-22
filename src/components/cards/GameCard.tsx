import React from "react";
import { Link } from "@tanstack/react-router";
import { Star, Sparkles } from "lucide-react";
import NintendoCover from "@/components/NintendoCover";
import { useCurrency } from "@/context/CurrencyContext";
import { listingPricing } from "@/lib/productPricing";
import { getProductSlug } from "@/lib/productRouting";
import { preloadImage } from "@/lib/imagePreloader";
import { getNintendoMedia, type NintendoMediaRole } from "@/lib/nintendoImages";

/**
 * A game tile.
 *
 * The same component can back surfaces that want genuinely different pictures
 * of the same product, so the picture is not the card's decision to make.
 * `imageRole` is passed to the resolver verbatim; if that role has no artwork
 * the card shows the placeholder rather than borrowing another role's image.
 */
export function GameCard({
  product,
  imageRole = "front-box",
  priority = false,
}: {
  product: any;
  imageRole?: NintendoMediaRole;
  priority?: boolean;
}) {
  const { formatIQDPrice } = useCurrency();
  const slug = getProductSlug(product) || String(product.id || "");
  const title = product.titleEn || product.english_name || product.title || "";
  const subtitle = product.developer || product.publisher || product.category || "";
  /*
    The same price the other card shows, and the same one the buy sheet opens
    on. This read `product.price` raw, which is neither: a product priced
    through its tiers has a `price` that no customer is ever charged, and one
    whose only tier is an online account has a `price` the card was hiding.
    `listingPricing` is the one rule all three surfaces read.
  */
  const { unitPrice: price } = listingPricing(product);
  const rating = product.metacriticRating ?? product.rating;
  const isSwitch2 =
    product.platform === "switch2" ||
    product.platform === "both" ||
    String(product.tags || "")
      .toLowerCase()
      .includes("switch 2");

  // Warm the same picture the card is actually showing. Reaching across
  // fields here used to preload a different image from the one rendered, so
  // the hover cost was paid twice and bought nothing.
  const handleHover = () => {
    const resolved = getNintendoMedia(product, imageRole);
    if (!resolved.isPlaceholder && resolved.url) {
      preloadImage(resolved.url, { width: 800 });
    }
  };

  return (
    <Link
      to="/product/$productId"
      params={{ productId: slug }}
      onMouseEnter={handleHover}
      onPointerDown={handleHover}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-card p-3 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-primary/50"
    >
      <div className="relative mb-3 aspect-[3/4] w-full overflow-hidden rounded-xl bg-muted/30">
        <NintendoCover
          product={product}
          usage={imageRole}
          alt={title}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          className="h-full w-full object-cover"
          imgClassName="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />

        {/* Platform tag */}
        <div className="absolute start-2 top-2 z-10 flex flex-wrap gap-1">
          {isSwitch2 ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-red-600/90 px-2 py-0.5 text-[11px] font-bold text-white shadow-sm backdrop-blur-md">
              <Sparkles className="h-3 w-3" />
              Switch 2
            </span>
          ) : (
            <span className="inline-flex items-center rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-bold text-white shadow-sm backdrop-blur-md">
              Switch
            </span>
          )}
        </div>

        {/* Rating tag */}
        {rating ? (
          <div className="absolute bottom-2 end-2 z-10 flex items-center gap-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-bold text-amber-400 shadow-sm backdrop-blur-md">
            <Star className="h-3 w-3 fill-current" />
            <span>{rating}</span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col justify-between gap-2" dir="ltr">
        <div>
          <h4
            className="line-clamp-2 text-sm font-bold leading-snug text-foreground transition-colors group-hover:text-primary sm:text-base"
            title={title}
            dir="auto"
          >
            {title}
          </h4>
          {subtitle ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground" dir="auto">
              {subtitle}
            </p>
          ) : null}
        </div>

        <div className="mt-2 flex items-baseline justify-between border-t border-border/50 pt-2">
          <span className="text-xs text-muted-foreground">السعر</span>
          <span className="text-sm font-extrabold text-foreground sm:text-base">
            {formatIQDPrice(price)}
          </span>
        </div>
      </div>
    </Link>
  );
}
