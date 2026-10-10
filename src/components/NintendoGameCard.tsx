import { memo } from "react";
import { Link } from "@tanstack/react-router";

import NintendoCover from "@/components/NintendoCover";
import { useCurrency } from "@/context/CurrencyContext";
import { isNintendoSwitch2Product } from "@/lib/nintendoListing";
import { listingPricing } from "@/lib/productPricing";
import { getProductSlug } from "@/lib/productRouting";

export interface NintendoGameCardProps {
  product: Record<string, any>;
  priority?: boolean;
  /** Home keeps its existing generic formatter; catalogue cards default to IQD. */
  formatPrice?: (value: number | string) => string;
  className?: string;
}

/**
 * Compact Nintendo listing card shared by the home strip and game catalogue.
 * It intentionally contains only the requested essentials: square artwork,
 * title, and price, plus the Switch 2 band when the product belongs to it.
 */
function NintendoGameCardBase({
  product,
  priority = false,
  formatPrice,
  className = "",
}: NintendoGameCardProps) {
  const { formatIQDPrice } = useCurrency();
  const slug = getProductSlug(product) || String(product.id || "");
  const title = product.titleEn || product.english_name || product.title || "";
  const { unitPrice, originalUnitPrice } = listingPricing(product);
  const switch2 = isNintendoSwitch2Product(product);
  const priceText = formatPrice ? formatPrice(unitPrice) : formatIQDPrice(unitPrice);
  const originalPriceText =
    originalUnitPrice > unitPrice
      ? formatPrice
        ? formatPrice(originalUnitPrice)
        : formatIQDPrice(originalUnitPrice)
      : "";

  /*
    A piece of clay with the artwork pressed into it: the card is raised off
    the shelf, the square art sits inside it on its own rounded window, and a
    press squashes the whole piece (the shared rule for filled links). Hover
    lifts the card one step instead of sliding it.
  */
  return (
    <Link
      to="/product/$productId"
      params={{ productId: slug }}
      aria-label={`${title} — ${priceText}`}
      className={`group relative flex min-w-0 flex-col rounded-[20px] border border-[var(--clay-rim)] bg-card p-1 shadow-sm hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]/50 sm:rounded-[22px] sm:p-1.5 ${className}`}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-[16px] bg-muted/40 sm:rounded-[17px]">
        <NintendoCover
          product={product}
          usage="square-card"
          ratio={null}
          fit="cover"
          alt={title}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          className="h-full w-full"
          imgClassName="transition-transform duration-500 ease-[var(--clay-ease)] group-hover:scale-[1.04]"
        />
        {/* A hairline inside the window, so bright artwork keeps its edge. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]"
        />

        {switch2 ? (
          <div
            className="absolute inset-x-0 top-0 z-10 flex min-h-5 items-center justify-center bg-[#e60012] px-1.5 py-0.5 text-center text-[9px] font-black leading-none tracking-[0.01em] text-white shadow-[inset_0_-1px_0_rgb(0_0_0/0.18),inset_0_1px_0_rgb(255_255_255/0.22)] sm:min-h-6 sm:text-[10px]"
            dir="ltr"
          >
            Nintendo Switch 2
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 px-1.5 pb-1.5 pt-2 sm:gap-1.5 sm:px-2 sm:pb-2">
        <h3
          className="line-clamp-2 min-h-[2.3em] text-[11.5px] font-bold leading-[1.15] text-foreground sm:text-[13px]"
          dir="auto"
          title={title}
        >
          {title}
        </h3>
        <p
          className="mt-auto flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 break-words text-[12px] font-black leading-tight tabular-nums text-foreground sm:text-[13.5px]"
          dir="ltr"
          title={priceText}
        >
          {originalPriceText ? (
            <span className="text-[9.5px] font-semibold text-muted-foreground line-through sm:text-[10.5px]">
              {originalPriceText}
            </span>
          ) : null}
          <span>{priceText}</span>
        </p>
      </div>
    </Link>
  );
}

/*
  Memoised because the shelf that renders it renders up to 1,714 of them and
  grows that list a screenful at a time as the member scrolls. Every growth
  re-renders the page; without this, each one re-rendered every card already on
  screen. The props are a product object straight out of the store query, a
  boolean and two optional values — all stable between growths — so the shallow
  compare bails out on everything except the cards that are actually new.
*/
export const NintendoGameCard = memo(NintendoGameCardBase);

export default NintendoGameCard;
