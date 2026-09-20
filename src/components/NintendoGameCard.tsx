import { Link } from "@tanstack/react-router";

import NintendoCover from "@/components/NintendoCover";
import { useCurrency } from "@/context/CurrencyContext";
import { isNintendoSwitch2Product } from "@/lib/nintendoListing";
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
export function NintendoGameCard({
  product,
  priority = false,
  formatPrice,
  className = "",
}: NintendoGameCardProps) {
  const { formatIQDPrice } = useCurrency();
  const slug = getProductSlug(product) || String(product.id || "");
  const title = product.titleEn || product.english_name || product.title || "";
  const price = Number(product.price) || 0;
  const switch2 = isNintendoSwitch2Product(product);
  const priceText = formatPrice ? formatPrice(product.price ?? 0) : formatIQDPrice(price);

  return (
    <Link
      to="/product/$productId"
      params={{ productId: slug }}
      aria-label={`${title} — ${priceText}`}
      className={`group relative flex min-w-0 flex-col overflow-hidden rounded-[14px] border border-border/70 bg-card shadow-[0_2px_10px_rgba(0,0,0,0.06)] transition duration-200 hover:-translate-y-0.5 hover:border-red-500/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 ${className}`}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted/25">
        <NintendoCover
          product={product}
          usage="square-card"
          ratio={null}
          fit="cover"
          alt={title}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          className="h-full w-full"
          imgClassName="transition-transform duration-300 group-hover:scale-[1.025]"
        />

        {switch2 ? (
          <div
            className="absolute inset-x-0 top-0 z-10 flex min-h-5 items-center justify-center bg-gradient-to-r from-[#d90916] via-[#ed1b24] to-[#d90916] px-1.5 py-0.5 text-center text-[9px] font-black leading-none tracking-[0.01em] text-white shadow-[0_1px_4px_rgba(0,0,0,0.18)] sm:min-h-6 sm:text-[10px]"
            dir="ltr"
          >
            Nintendo Switch 2
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-2 py-2 sm:gap-2 sm:px-2.5 sm:py-2.5">
        <h3
          className="line-clamp-2 min-h-[2.25em] text-[11px] font-bold leading-[1.15] text-foreground sm:text-xs"
          dir="auto"
          title={title}
        >
          {title}
        </h3>
        <p
          className="mt-auto break-words text-[11px] font-extrabold leading-tight text-foreground sm:text-xs"
          dir="ltr"
          title={priceText}
        >
          {priceText}
        </p>
      </div>
    </Link>
  );
}

export default NintendoGameCard;
