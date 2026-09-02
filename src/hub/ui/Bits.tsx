import { useEffect, useRef, useState, type ReactNode } from "react";
import { Star } from "lucide-react";
import { cn } from "@/hub/utils/cn";
import { useCountUp } from "@/hub/hooks/useCountUp";
import { cdnImage, buildSrcSet } from "@/lib/img";

/* -------------------------------------------------------------------------- */
/* Reveal                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Content wrapper used by the game hub.
 *
 * Game-detail content must never start hidden. Safari on iPad can miss
 * IntersectionObserver callbacks after an anchor jump or restored scroll
 * position, leaving the element transparent while it still consumes layout
 * height. Rendering as shown makes the information and its geometry
 * deterministic on every browser.
 *
 * Carries `min-w-0` because it is almost always a grid or flex item: without it
 * a single `truncate` (i.e. `white-space: nowrap`) anywhere in the subtree
 * raises the item's minimum contribution and widens the whole track, which
 * shows up as page-level horizontal overflow on narrow screens.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div
      data-reveal="shown"
      style={delay ? ({ "--reveal-delay": `${delay}ms` } as React.CSSProperties) : undefined}
      className={cn("min-w-0", className)}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Compact fact tile                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The "Game at a Glance" tile. Deliberately small and border-free: tiles sit on
 * a shared inset field and are separated by a grid gap, not by outlines.
 */
export function Stat({
  icon: Icon,
  label,
  children,
  accent,
}: {
  icon?: React.ComponentType<{ className?: string }> | undefined;
  label: string;
  children: ReactNode;
  accent?: boolean | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 p-3.5">
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider muted">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        <span className="truncate">{label}</span>
      </span>
      {/*
        `dir="auto"` per value, not per page: a tile may hold "18.7 GB" (LTR),
        "Nintendo Switch" (LTR) or "34–40 ساعة" (RTL). Letting the browser pick
        from the first strong character gets all three right, where a fixed
        direction reverses one of them.
      */}
      <span
        dir="auto"
        className={cn(
          "text-sm font-bold leading-snug",
          accent ? "text-nin-soft" : "text-[rgb(var(--text))]",
        )}
      >
        {children}
      </span>
    </div>
  );
}

/** Field that hosts a row of `Stat`s with hairline separators between them. */
export function StatField({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid overflow-hidden rounded-2xl bg-black/20 [&>*]:border-white/[0.055]",
        "[&>*]:border-t [&>*]:border-s",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chips & pills                                                              */
/* -------------------------------------------------------------------------- */

export function Chip({
  children,
  tone = "default",
  className,
  icon: Icon,
}: {
  children: ReactNode;
  tone?: "default" | "accent" | "good" | "warn" | "muted";
  className?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <span
      className={cn(
        "chip",
        tone === "accent" && "border-nin/30 bg-nin/15 text-nin-soft",
        tone === "good" && "border-good/25 bg-good/10 text-good",
        tone === "warn" && "border-warn/25 bg-warn/10 text-warn",
        tone === "muted" && "muted",
        className,
      )}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Segmented control                                                          */
/* -------------------------------------------------------------------------- */

export interface SegmentOption<T extends string> {
  id: T;
  label: string;
  count?: number;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
  ariaLabel,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-full bg-black/25 p-1",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.id)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full font-bold transition-all duration-200",
              size === "sm" ? "px-3 py-1.5 text-[11px]" : "px-4 py-2 text-xs",
              selected ? "bg-white/[0.13] text-white" : "muted hover:text-white",
            )}
          >
            {option.label}
            {option.count != null && (
              <span className={cn("ms-1.5 text-[10px]", selected ? "text-white/60" : "opacity-60")}>
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Score                                                                      */
/* -------------------------------------------------------------------------- */

export function ScoreBar({
  label,
  value,
  max = 10,
  delay = 0,
}: {
  label: string;
  value: number;
  max?: number;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const pct = Math.max(0, Math.min(1, value / max));

  return (
    <div ref={ref} className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold muted">{label}</span>
        <span className="font-mono font-bold tabular-nums">{value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-nin to-nin-soft transition-[width] duration-[900ms] ease-out"
          style={{ width: shown ? `${pct * 100}%` : "0%", transitionDelay: `${delay}ms` }}
        />
      </div>
    </div>
  );
}

export function RatingStars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`${value} / 5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Star
          key={i}
          className={cn(
            "h-3.5 w-3.5",
            i < Math.round(value) ? "fill-warn text-warn" : "text-white/20",
          )}
        />
      ))}
    </span>
  );
}

/** Number that counts up when scrolled into view. */
export function CountUp({
  value,
  decimals = 0,
  suffix,
  className,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  className?: string;
}) {
  const { ref, value: current } = useCountUp(value);
  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {current.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Media                                                                      */
/* -------------------------------------------------------------------------- */

/** Lazy image that fades in with AVIF/WebP picture support and never leaves a raw broken-image icon behind. */
export function SmartImage({
  src,
  alt,
  className,
  wrapperClassName,
  eager,
  sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 800px",
}: {
  src?: string | undefined;
  alt: string;
  className?: string;
  wrapperClassName?: string;
  eager?: boolean;
  sizes?: string;
}) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  if (!src || state === "failed") {
    /*
      The placeholder takes the wrapper's classes only. `className` styles the
      inner <img> — usually "h-full w-full object-cover" — and merging it here
      let tailwind-merge's w-full defeat the wrapper's fixed width, so a card
      whose artwork failed to load grew to the full row and pushed the page
      into horizontal overflow (the empty left band on RTL phones).
    */
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-gradient-to-br from-ink-800 to-ink-850",
          wrapperClassName,
        )}
        aria-label={alt}
        role="img"
      />
    );
  }

  const avifSrcSet = buildSrcSet(src, "avif", [320, 640, 960, 1280]);
  const webpSrcSet = buildSrcSet(src, "webp", [320, 640, 960, 1280]);

  return (
    <span className={cn("relative block overflow-hidden bg-ink-850", wrapperClassName)}>
      <picture className="contents">
        {avifSrcSet && <source type="image/avif" srcSet={avifSrcSet} sizes={sizes} />}
        {webpSrcSet && <source type="image/webp" srcSet={webpSrcSet} sizes={sizes} />}
        <img
          src={cdnImage(src)}
          alt={alt}
          sizes={sizes}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setState("ready")}
          onError={() => setState("failed")}
          className={cn(
            "transition-opacity duration-500",
            state === "ready" ? "opacity-100" : "opacity-0",
            className,
          )}
        />
      </picture>
    </span>
  );
}
