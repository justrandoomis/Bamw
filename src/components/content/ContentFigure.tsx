"use client";

import { useEffect, useRef, useState } from "react";
import type { ContentImage } from "@/lib/content";

/**
 * A picture the shop owner uploaded, in a frame that respects its shape.
 *
 * No fixed aspect ratio and no cropping. These are screenshots of a Nintendo
 * Switch menu — a forced 16:9 or a square crop cuts off the button the step is
 * telling somebody to press, which is the one part that had to survive.
 *
 * Lazy by default, because a guide is a long page of them and the reader is at
 * step one.
 */
export function ContentFigure({
  image,
  onOpen,
  priority = false,
}: {
  image: ContentImage;
  onOpen?: (image: ContentImage) => void;
  priority?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  /*
    A cached image can finish before React attaches `onLoad`, and then the
    event never fires and the picture stays behind its skeleton for ever.
  */
  useEffect(() => {
    if (ref.current?.complete) setLoaded(true);
  }, []);

  const picture = (
    <>
      {!loaded && <div className="bn-skeleton absolute inset-0 rounded-[inherit]" aria-hidden />}
      <img
        ref={ref}
        src={image.url}
        alt={image.alt || ""}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        /*
          `h-auto` with `max-w-full` is the whole rule: the image never exceeds
          its column and never stretches. `block` removes the inline baseline
          gap that otherwise leaves a sliver of background under every figure.
        */
        className={`block h-auto w-full max-w-full rounded-[inherit] transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
    </>
  );

  return (
    <figure className="m-0">
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(image)}
          aria-label={image.alt ? `تكبير الصورة: ${image.alt}` : "تكبير الصورة"}
          className="relative block w-full cursor-zoom-in overflow-hidden rounded-xl border border-border bg-background shadow-sm transition-shadow duration-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {picture}
        </button>
      ) : (
        <div className="relative block w-full overflow-hidden rounded-xl border border-border bg-background">
          {picture}
        </div>
      )}

      {image.caption?.trim() ? (
        <figcaption className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {image.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
