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

  /*
    How far this shelf was opened, remembered across a visit.

    A grow-only window is not enough on its own. A member who scrolls 800
    cards down, taps a game and presses BACK arrives at a page that renders
    sixty — so there is nothing for the browser to restore the scroll position
    against, and they land at the top of a shelf they had walked half of. That
    is a worse version of the complaint this hook exists to answer, and it
    would only have shown up on a real phone.

    So the depth is remembered per shelf, for the length of the session.
    Returning re-renders what was already rendered, which is a cost the member
    has already paid once and whose images are already in the browser's cache;
    leaving them stranded at the top is not cheaper, it is just cheaper for us.

    sessionStorage and not localStorage: this is where you were a minute ago,
    not a preference. Every access is wrapped, because a private window or
    blocked site data makes the accessor itself throw, and a shelf must render
    either way.
  */
  const storageKey = options?.resetKey ? `bn:shelf-depth:${options.resetKey}` : "";

  /*
    The `typeof` check is INSIDE the try, which is not a style choice.

    `typeof sessionStorage` reads the property, and a browser that blocks site
    data throws from the getter itself rather than leaving it undefined — so a
    guard written outside the try throws during render and takes the whole
    shelf with it. Caught by the test that exists for exactly this case, after
    I wrote it the wrong way round first.
  */
  const remembered = (): number => {
    if (!storageKey) return initial;
    try {
      if (typeof sessionStorage === "undefined") return initial;
      const saved = Number(sessionStorage.getItem(storageKey));
      return Number.isFinite(saved) && saved > initial ? saved : initial;
    } catch {
      return initial;
    }
  };

  const [count, setCount] = useState(remembered);

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
    /*
      A shelf the member has already been down keeps its depth; one they have
      not starts at the top. Changing the sort and changing it back should not
      make them walk the shelf again.
    */
    const restored = remembered();
    if (count !== restored) setCount(restored);
  }

  /*
    Written on every change rather than on unmount: `beforeunload` and unmount
    handlers are not guaranteed to run on a mobile browser, which is exactly
    the browser this matters on.
  */
  useEffect(() => {
    if (!storageKey) return;
    try {
      if (typeof sessionStorage === "undefined") return;
      sessionStorage.setItem(storageKey, String(count));
    } catch {
      /* Private window, blocked site data. The shelf still works. */
    }
  }, [storageKey, count]);

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
