"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { filledImages, type ContentImage } from "@/lib/content";
import { ContentFigure } from "./ContentFigure";

/**
 * The pictures of one step, and nothing at all when there are none.
 *
 * The empty state is the requirement. Every step of every guide carries a slot
 * so the shop owner knows where a screenshot belongs, and until one is
 * uploaded a customer must see no placeholder, no broken image and no gap
 * where a figure would be — the element is simply absent, and the step reads
 * as if it never had a picture.
 */
export function ContentGallery({
  images,
  legacy,
  legacyAlt,
  priority = false,
}: {
  images: ContentImage[] | undefined;
  legacy?: string;
  legacyAlt?: string;
  priority?: boolean;
}) {
  const [zoomed, setZoomed] = useState<ContentImage | null>(null);
  const filled = filledImages(images, legacy, legacyAlt);

  if (filled.length === 0) return null;

  return (
    <>
      <div
        className={`mt-3 grid gap-3 ${filled.length > 1 ? "sm:grid-cols-2" : "grid-cols-1"}`}
      >
        {filled.map((image, index) => (
          <ContentFigure
            key={image.id || image.url}
            image={image}
            onOpen={setZoomed}
            priority={priority && index === 0}
          />
        ))}
      </div>

      {/*
        The native <dialog> gives modal semantics for free — focus trapped,
        Escape closes, focus restored to the trigger — none of which is worth
        reimplementing, and all of which a customer on a phone relies on.
      */}
      {zoomed ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={zoomed.alt || "صورة موسّعة"}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setZoomed(null)}
        >
          <button
            type="button"
            onClick={() => setZoomed(null)}
            aria-label="إغلاق"
            className="absolute top-4 left-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={zoomed.url}
            alt={zoomed.alt || ""}
            className="max-h-[90vh] max-w-full rounded-xl object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}
