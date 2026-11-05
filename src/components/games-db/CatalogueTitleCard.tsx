import { memo } from "react";
import { Link } from "@tanstack/react-router";
import { MessageSquarePlus } from "lucide-react";

import { useI18n } from "@/i18n";
import type { GamesDbListItem } from "@/lib/games-db";
import { cdnImage } from "@/lib/img";
import { isUpcoming, productIdFromPath } from "./gamesDbFormat";

/**
 * A Nintendo game on the games shelf that the shop does not sell yet: the
 * same piece of clay as the shop's own card (NintendoGameCard) — square art
 * in its window, the Switch 2 band, the name — with «اطلبها» where the price
 * would be. It opens the game's page, with every fact Nintendo gives and the
 * request button.
 */
function CatalogueTitleCardBase({ item }: { item: GamesDbListItem }) {
  const { t } = useI18n();
  const productId = productIdFromPath(item.shopPath);
  const upcoming = isUpcoming(item.releaseDate);
  const className =
    "group relative flex min-w-0 flex-col rounded-[20px] border border-[var(--clay-rim)] bg-card p-1 shadow-sm hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]/50 sm:rounded-[22px] sm:p-1.5";

  const body = (
    <>
      <div className="relative aspect-square w-full overflow-hidden rounded-[16px] bg-muted/40 sm:rounded-[17px]">
        {item.image ? (
          <img
            src={cdnImage(item.image, { width: 360 })}
            srcSet={[240, 360, 500].map((w) => `${cdnImage(item.image, { width: w })} ${w}w`).join(", ")}
            sizes="(min-width: 1280px) 16vw, (min-width: 1024px) 20vw, (min-width: 640px) 25vw, 33vw"
            alt={item.title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 ease-[var(--clay-ease)] group-hover:scale-[1.04]"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center p-3 text-center text-[11.5px] font-bold text-muted-foreground">
            {item.title}
          </span>
        )}
        {/* A hairline inside the window, so bright artwork keeps its edge. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]"
        />
        {item.platform === "switch2" ? (
          <div
            className="absolute inset-x-0 top-0 z-10 flex min-h-5 items-center justify-center bg-[#e60012] px-1.5 py-0.5 text-center text-[9px] font-black leading-none tracking-[0.01em] text-white shadow-[inset_0_-1px_0_rgb(0_0_0/0.18),inset_0_1px_0_rgb(255_255_255/0.22)] sm:min-h-6 sm:text-[10px]"
            dir="ltr"
          >
            Nintendo Switch 2
          </div>
        ) : null}
        {upcoming ? (
          <span
            dir="rtl"
            className="absolute bottom-1.5 right-1.5 z-10 rounded-full bg-card/90 px-2 py-0.5 text-[10px] font-black text-foreground shadow-sm backdrop-blur"
          >
            {t("قريباً")}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 px-1.5 pb-1.5 pt-2 sm:gap-1.5 sm:px-2 sm:pb-2">
        <h3
          className="line-clamp-2 min-h-[2.3em] text-[11.5px] font-bold leading-[1.15] text-foreground sm:text-[13px]"
          dir="auto"
          title={item.title}
        >
          {item.title}
        </h3>
        <p className="mt-auto flex min-w-0 items-center gap-1 text-[11.5px] font-black leading-tight text-[var(--brand-red)] sm:text-[12.5px]">
          <MessageSquarePlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {productId ? t("في المتجر") : t("اطلبها")}
        </p>
      </div>
    </>
  );

  return productId ? (
    <Link to="/product/$productId" params={{ productId }} aria-label={item.title} className={className}>
      {body}
    </Link>
  ) : (
    <Link
      to="/games-db/$slug"
      params={{ slug: item.slug }}
      aria-label={`${item.title} — ${t("اطلبها")}`}
      className={className}
    >
      {body}
    </Link>
  );
}

/* Memoised for the reason NintendoGameCard is: the shelf grows a page at a time. */
export const CatalogueTitleCard = memo(CatalogueTitleCardBase);

export default CatalogueTitleCard;
