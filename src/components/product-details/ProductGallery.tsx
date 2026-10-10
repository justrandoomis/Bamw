import { ChevronLeft, ChevronRight, ImageOff, Maximize2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useTranslation } from "@/i18n";
import { playSound } from "@/utils/audio";

/**
 * Image viewer for the details hero.
 *
 * The arrows are laid out with logical properties and the icons swap with
 * direction, so "next" points right in English/Turkish and left in Arabic
 * rather than merely mirroring the button positions.
 */
export function ProductGallery({ images, alt }: { images: string[]; alt: string }) {
  const { t, dir } = useTranslation();
  const [active, setActive] = useState(0);
  const [broken, setBroken] = useState<Set<number>>(new Set());
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const usable = images.filter((_, index) => !broken.has(index));
  const current = images[active];

  if (images.length === 0 || usable.length === 0) {
    return (
      <div className="rounded-[30px] border border-[var(--clay-rim)] bg-card p-1.5 shadow-xl">
        <div className="flex aspect-square w-full items-center justify-center rounded-[24px] bg-muted/50 text-muted-foreground">
          <ImageOff className="h-10 w-10 opacity-30" aria-hidden="true" />
        </div>
      </div>
    );
  }

  const step = (delta: number) => {
    playSound("album", 0.5);
    setActive((i) => (i + delta + images.length) % images.length);
  };
  const isRtl = dir === "rtl";
  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;

  return (
    <div className="w-full min-w-0 space-y-3">
      {/* The picture in a frame of clay, its controls small clay buttons over it. */}
      <div className="rounded-[30px] border border-[var(--clay-rim)] bg-card p-1.5 shadow-xl">
        <div className="relative aspect-square w-full overflow-hidden rounded-[24px] bg-muted/40">
          {current ? (
            <img
              src={current}
              alt={alt}
              loading="eager"
              className="h-full w-full object-contain"
              onError={() => setBroken((prev) => new Set(prev).add(active))}
            />
          ) : null}

          {images.length > 1 && (
            <>
              <button
                type="button"
                data-sfx-hover="hover_s"
                onClick={() => step(-1)}
                aria-label={t("common.previous")}
                className="absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--clay-rim)] bg-card/85 text-foreground shadow-sm backdrop-blur"
                style={{ insetInlineStart: "0.5rem" }}
              >
                <PrevIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                data-sfx-hover="hover_s"
                onClick={() => step(1)}
                aria-label={t("common.next")}
                className="absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--clay-rim)] bg-card/85 text-foreground shadow-sm backdrop-blur"
                style={{ insetInlineEnd: "0.5rem" }}
              >
                <NextIcon className="h-4 w-4" />
              </button>
              <div
                className="absolute bottom-2.5 rounded-full border border-[var(--clay-rim)] bg-card/85 px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-foreground backdrop-blur"
                style={{ insetInlineEnd: "0.5rem" }}
                dir="ltr"
              >
                {active + 1} / {images.length}
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            aria-label="عرض الصورة بملء الشاشة"
            className="absolute top-2.5 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--clay-rim)] bg-card/85 text-foreground shadow-sm backdrop-blur"
            style={{ insetInlineEnd: "0.5rem" }}
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto px-1 pb-1 pt-1">
          {images.map((src, index) =>
            broken.has(index) ? null : (
              <button
                key={`${src}-${index}`}
                type="button"
                data-sfx-hover="hover_s"
                onClick={() => {
                  playSound("album", 0.5);
                  setActive(index);
                }}
                aria-label={`${alt} ${index + 1}`}
                className={`h-16 w-16 shrink-0 overflow-hidden rounded-[14px] border border-[var(--clay-rim)] bg-card shadow-sm transition-opacity ${
                  index === active
                    ? "ring-2 ring-[var(--brand-red)]/60"
                    : "opacity-70 hover:opacity-100"
                }`}
              >
                {/*
                  `contain`, matching the main frame. A thumbnail strip of
                  packshots cropped to squares cuts the top off a tall box and
                  the sides off a wide one, so the strip stops matching the
                  picture it selects.
                */}
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  className="h-full w-full bg-muted/40 object-contain"
                  onError={() => setBroken((prev) => new Set(prev).add(index))}
                />
              </button>
            ),
          )}
        </div>
      )}

      {fullscreen && current ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${alt} — عرض بملء الشاشة`}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-4"
          onClick={() => setFullscreen(false)}
        >
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            className="absolute top-4 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
            style={{ insetInlineEnd: "1rem" }}
            aria-label="إغلاق العرض"
          >
            <X className="h-5 w-5" />
          </button>
          {images.length > 1 ? (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  step(-1);
                }}
                className="absolute top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
                style={{ insetInlineStart: "1rem" }}
                aria-label={t("common.previous")}
              >
                <PrevIcon className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  step(1);
                }}
                className="absolute top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
                style={{ insetInlineEnd: "1rem" }}
                aria-label={t("common.next")}
              >
                <NextIcon className="h-6 w-6" />
              </button>
            </>
          ) : null}
          <img
            src={current}
            alt={alt}
            onClick={(event) => event.stopPropagation()}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      ) : null}
    </div>
  );
}
