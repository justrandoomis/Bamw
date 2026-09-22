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
  options?: { initial?: number; step?: number; rootMargin?: string; resetKey?: string },
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
    Reset on a NEW SHELF — never merely on a new array.

    This first keyed the reset on the identity of `items`, and that was a bug
    that would have reintroduced the very fault it was written to fix. The
    route rebuilds `products` whenever the catalogue query answers, and the
    catalogue query answers on every visit: `useStoreData` paints from the
    device's snapshot first and then replaces it with the network's, and it
    refetches on window focus and after fifteen seconds. Each of those hands
    the route a different array holding the same shelf. A member 800 cards
    down would have been thrown back to the first sixty — everything below
    them unmounted — a second after they started scrolling. That is «تحمل
    المنتجات من جديد», word for word, which is what the owner reported and
    what this hook exists to stop.

    So the caller says what a different shelf IS: the category, the sort and
    the filters. A refetch does not change that string, and changing a filter
    does. Done during render rather than in an effect, so the first paint
    after a filter change is already the first page.
  */
  const resetKey = options?.resetKey ?? "";
  const previousKey = useRef(resetKey);
  if (previousKey.current !== resetKey) {
    previousKey.current = resetKey;
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
