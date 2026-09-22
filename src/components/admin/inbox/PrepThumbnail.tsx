import { ExternalLink, ImageOff } from "lucide-react";

import { cdnImage } from "@/lib/img";

/**
 * The picture of the game the admin is preparing.
 *
 * The prep tool named games and nothing else, and «الألعاب وعناصر التسليم» is
 * a row of identical grey chips — which is precisely where a mistake is made,
 * because two lines of the same order can read the same. The owner asked for a
 * small soft thumbnail here, and for it to be the SAME square picture the
 * storefront shows, so that the thing on the admin's screen and the thing the
 * member bought are visibly one object.
 *
 * The picture comes from the ORDER's own snapshot, not from the catalogue as
 * it stands today. An order records what was sold; re-arting a product must
 * not change what an old order shows, for the same reason re-pricing one must
 * not change its margin.
 */
export interface PrepThumbnailProps {
  /** The artwork the order recorded, if it recorded one. */
  image?: string | null;
  /** Alt text — the game's title, so a missing picture still says what it is. */
  title?: string | null;
  /** Opens the product page in a new tab. Omitted inside a <button>. */
  productId?: string | null;
  size?: "sm" | "md";
  className?: string;
}

export function PrepThumbnail({
  image,
  title,
  productId,
  size = "sm",
  className = "",
}: PrepThumbnailProps) {
  const box = size === "md" ? "h-12 w-12" : "h-9 w-9";
  const label = title ?? "";

  const picture =
    typeof image === "string" && image.trim().length > 4 ? (
      <img
        src={cdnImage(image)}
        alt={label}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="h-full w-full object-cover"
      />
    ) : (
      /*
        Not an empty square. An admin who cannot see a picture needs to know
        whether the game has none or the tool failed to show it, and a
        placeholder that says «لا صورة» answers that without being read as a
        loading state.
      */
      <span
        className="flex h-full w-full items-center justify-center bg-muted/50 text-muted-foreground"
        title="لا توجد صورة محفوظة لهذا العنصر"
      >
        <ImageOff className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );

  const frame = `${box} shrink-0 overflow-hidden rounded-lg border border-border/70 bg-muted/25 ${className}`;

  /*
    A link ONLY when the caller says it is safe to nest one. The delivery chips
    are themselves buttons, and an anchor inside a button is invalid HTML that
    browsers resolve by dropping one of the two — so there the thumbnail is
    part of the chip and the chip's own click is what responds.
  */
  if (!productId) {
    return (
      <span className={frame} aria-hidden={label ? undefined : "true"}>
        {picture}
      </span>
    );
  }

  return (
    <a
      href={`/product/${encodeURIComponent(productId)}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`${label} — فتح صفحة المنتج`}
      aria-label={`${label} — فتح صفحة المنتج`}
      className={`group relative ${frame} transition-colors hover:border-primary/60`}
    >
      {picture}
      <span className="absolute inset-0 hidden items-center justify-center bg-black/45 text-white group-hover:flex group-focus-visible:flex">
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    </a>
  );
}

export default PrepThumbnail;
