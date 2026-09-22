import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Render a long shelf a screenful at a time, and never take one back.
 *
 * The games category rendered all 1,714 matching products at once. That is
 * 1,714 cards, 1,714 `<img>` elements and — because each card was wrapped in a
 * `whileInView` motion element — 1,714 IntersectionObservers, all live while
 * the member scrolls. Two of the three complaints about that page come
 * straight from it: the scroll stutters because every frame has that much DOM
 * to lay out and paint, and the cards "load again" on the way back up because
 * a phone cannot hold seventeen hundred decoded images and starts throwing
 * them away, so scrolling back up re-decodes what it evicted.
 *
 * So: start with a screenful, add more as the member approaches the end, and
 * GROW ONLY. A window that shrinks behind you is a window that makes the
 * second complaint worse, not better — scrolling back up would unmount and
 * remount the very cards the member is returning to look at.
 *
 * Resets to the first page when the list itself changes (a new sort, a new
 * filter, a new category), because then the member is looking at a different
 * shelf and expects to be at the top of it.
 */
export interface ProgressiveList<T> {
  /** The prefix of `items` that should be rendered right now. */
  visible: T[];
  /** Attach to an element at the end of the list; seeing it asks for more. */
  sentinelRef: (node: HTMLElement | null) => void;
  /** True once every item is rendered — the sentinel can be dropped. */
  done: boolean;
  /** For a fallback button where IntersectionObserver is not available. */
  showMore: () => void;
}

export function useProgressiveList<T>(
  items: T[],
  options?: { initial?: number; step?: number; rootMargin?: string },
): ProgressiveList<T> {
  const initial = options?.initial ?? 48;
  const step = options?.step ?? 36;
  /*
    Grow well before the sentinel is actually on screen. A member flicking
    down a phone covers a couple of screens between frames; asking for the
    next page only once the end is visible shows them the bottom of the list
    and then a jump. 1200px is roughly two screenfuls of cards.
  */
  const rootMargin = options?.rootMargin ?? "1200px 0px";

  const [count, setCount] = useState(initial);

  /*
    Reset on a NEW list. The route rebuilds `products` through a `useMemo`
    keyed on the filters, so identity changes exactly when the shelf changes.
    Done during render, not in an effect, so the first paint after a filter
    change is already the first page — an effect would paint the old, longer
    window for a frame first.
  */
  const previousItems = useRef(items);
  if (previousItems.current !== items) {
    previousItems.current = items;
    if (count !== initial) setCount(initial);
  }

  const done = count >= items.length;

  const showMore = useCallback(() => {
    setCount((current) => (current >= items.length ? current : current + step));
  }, [items.length, step]);

  const showMoreRef = useRef(showMore);
  showMoreRef.current = showMore;

  /*
    The node is held in state, not just a ref, because the observer has to be
    rebuilt after every growth and an effect cannot depend on a ref.

    Rebuilt, rather than left in place: IntersectionObserver reports a
    CHANGE in intersection, so a sentinel that is still visible after a page
    was added — a short list, a tall monitor, a member who reached the bottom
    while the page was still loading — never fires again, and the shelf would
    stop half-rendered. A fresh observer always delivers one initial record,
    which is exactly the "are you still visible?" question we need answered.
  */
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const sentinelRef = useCallback((node: HTMLElement | null) => setSentinel(node), []);

  useEffect(() => {
    if (!sentinel || done) return;
    if (typeof IntersectionObserver === "undefined") {
      // No observer: show everything rather than stranding the member.
      setCount(items.length);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) showMoreRef.current();
      },
      { rootMargin },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [sentinel, done, count, rootMargin, items.length]);

  const visible = useMemo(() => items.slice(0, count), [items, count]);

  return { visible, sentinelRef, done, showMore };
}
