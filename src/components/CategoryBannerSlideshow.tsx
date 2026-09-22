import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cdnImage } from "@/lib/img";

/**
 * The rotating artwork behind a category header.
 *
 * It is its own component for one reason: it ticks. Living inside the category
 * page, its `currentBannerIndex` was page state, so every flip re-rendered the
 * whole route — including the grid of 1,714 product cards — four times every
 * ten seconds, whether or not the member was scrolling at the time. Moving the
 * state down here means a flip re-renders one image.
 *
 * Two more faults went with it:
 *
 * - Every banner URL in the category was preloaded at once, thousands of
 *   `new Image()` requests fired in one pass, and each `onload` wrote to a
 *   `loadedBannerIndices` map that NOTHING in the render ever read. So the
 *   page paid a full re-render per image for a value it did not use. The map
 *   is gone; the pool is bounded upstream, and only the next picture is
 *   fetched ahead.
 * - The image carried `decoding="sync"`, which tells the browser to decode a
 *   full-width photograph on the main thread before it will paint anything
 *   else. That is the stutter the owner saw "when the banner flips".
 */
export interface CategoryBannerSlideshowProps {
  banners: string[];
  /** ms between flips. */
  interval?: number;
}

export function CategoryBannerSlideshow({
  banners,
  interval = 2500,
}: CategoryBannerSlideshowProps) {
  const [index, setIndex] = useState(0);

  /*
    Reactive, and read in RENDER as well as in the effect below.

    The first version of this asked `matchMedia` once inside the effect and
    then enforced the answer imperatively — `start(); if (matches) stop();`.
    That is not a rule, it is a correction, and the very next thing to call
    `start()` undid it: `onVisibility` restarted the timer on any tab switch,
    and a member who had asked for less motion got a full-bleed photograph
    sliding across their screen every two and a half seconds for the rest of
    the session. Four separate reviewers found it, which is four more than
    would have found it in production.

    The preference now gates the timer from INSIDE `start()`, where nothing
    can step over it, and gates the slide itself as well — the timer was only
    ever half of the motion.
  */
  const reduceMotion = useReducedMotion();

  // A new pool (new category) starts again at its first picture.
  const poolRef = useRef(banners);
  if (poolRef.current !== banners) {
    poolRef.current = banners;
    if (index !== 0) setIndex(0);
  }

  /*
    Fetch ONLY the picture that comes next, and only when it is next. The
    browser caches it, so by the time the flip happens it is already decoded
    and the swap costs nothing.
  */
  useEffect(() => {
    if (banners.length <= 1) return;
    const next = banners[(index + 1) % banners.length];
    if (!next) return;
    const img = new Image();
    img.decoding = "async";
    img.src = cdnImage(next);
  }, [banners, index]);

  useEffect(() => {
    if (banners.length <= 1) return;

    /*
      Someone who asked for less motion gets the first picture, held still —
      and the effect does not even install a timer to be re-armed later.
    */
    if (reduceMotion) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };

    /*
      Every guard lives HERE, in the one function that starts the timer, so
      that no caller can start one the guards would have refused. The
      visibility handler below is exactly such a caller, and it is how the
      reduced-motion preference came to be defeated by a tab switch.

      A hidden tab still runs its timers, and the browser throttles them into
      bursts — so returning used to replay every flip it had "missed" at once.
    */
    const start = () => {
      if (timer !== null) return;
      if (reduceMotion) return;
      if (typeof document !== "undefined" && document.hidden) return;
      timer = setInterval(() => {
        setIndex((prev) => (prev + 1) % banners.length);
      }, interval);
    };

    const onVisibility = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [banners, interval, reduceMotion]);

  if (banners.length === 0) {
    return (
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/20 to-transparent" />
      </div>
    );
  }

  const current = banners[index] || banners[0] || "";

  return (
    <div className="relative w-full h-full">
      <AnimatePresence initial={false}>
        <motion.img
          key={index}
          src={cdnImage(current)}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
          /*
            The preference gates the SLIDE as well as the timer. Freezing the
            interval and still translating a full-bleed photograph across the
            screen for the one flip that does happen is half a fix — and it is
            the half the member actually sees.
          */
          initial={reduceMotion ? { opacity: 0 } : { x: "-100%" }}
          animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { x: "100%" }}
          transition={reduceMotion ? { duration: 0.2 } : { duration: 0.8, ease: "easeInOut" }}
          loading="eager"
          decoding="async"
          draggable={false}
        />
      </AnimatePresence>
      {/* Clean dark tint for text contrast only, without bottom blur gradient */}
      <div className="absolute inset-0 bg-black/40 z-10 pointer-events-none" />
    </div>
  );
}

export default CategoryBannerSlideshow;
