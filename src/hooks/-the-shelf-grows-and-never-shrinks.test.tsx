/**
 * @vitest-environment jsdom
 *
 * The games shelf renders a screenful at a time, and never takes one back.
 *
 * Two of the three complaints about /category/nintendo_games came from
 * mounting all 1,714 cards at once: the scroll stuttered, and "the products
 * load again when I scroll back up" — a phone cannot hold seventeen hundred
 * decoded images, so it evicts them and has to decode them again on the way
 * back. These tests pin the window's contract, and especially the part that
 * makes the second complaint worse if it is got wrong: it GROWS ONLY.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useProgressiveList } from "./useProgressiveList";

/** A hand-driven IntersectionObserver: nothing intersects until a test says so. */
class FakeObserver {
  static live: FakeObserver[] = [];
  callback: IntersectionObserverCallback;
  targets: Element[] = [];
  disconnected = false;

  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
    FakeObserver.live.push(this);
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** The one observer still attached — the hook rebuilds it after each growth. */
  static current(): FakeObserver | undefined {
    return FakeObserver.live.filter((o) => !o.disconnected).at(-1);
  }
  static reset() {
    FakeObserver.live = [];
  }
}

function Shelf({
  items,
  initial = 5,
  step = 3,
  resetKey = "nintendo_games|newest|all|all",
}: {
  items: string[];
  initial?: number;
  step?: number;
  resetKey?: string;
}) {
  const { visible, sentinelRef, done } = useProgressiveList(items, { initial, step, resetKey });
  return (
    <div>
      <p data-testid="count">{visible.length}</p>
      <p data-testid="done">{String(done)}</p>
      <p data-testid="last">{visible.at(-1) ?? ""}</p>
      {done ? null : <div data-testid="sentinel" ref={sentinelRef} />}
    </div>
  );
}

const reach = () =>
  act(() => {
    const observer = FakeObserver.current();
    observer?.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    );
  });

const list = (n: number, tag = "a") => Array.from({ length: n }, (_, i) => `${tag}${i}`);

const count = () => Number(screen.getByTestId("count").textContent);

beforeEach(() => {
  FakeObserver.reset();
  (globalThis as any).IntersectionObserver = FakeObserver;
});

afterEach(() => {
  cleanup();
  FakeObserver.reset();
});

describe("a shelf that grows a screenful at a time", () => {
  it("starts with one screenful, not the whole catalogue", () => {
    render(<Shelf items={list(1714)} />);
    expect(count()).toBe(5);
    expect(screen.getByTestId("done").textContent).toBe("false");
  });

  it("adds a step each time the member reaches the end", () => {
    render(<Shelf items={list(1714)} />);
    reach();
    expect(count()).toBe(8);
    reach();
    expect(count()).toBe(11);
  });

  it("re-observes after growing, so a sentinel still on screen keeps asking", () => {
    /*
      IntersectionObserver reports a CHANGE in intersection. A sentinel that is
      still visible after a page was added — a tall monitor, a short list, a
      member already at the bottom — would never fire again, and the shelf
      would stop half-rendered. The hook rebuilds the observer instead, and a
      fresh observer always delivers one record.
    */
    render(<Shelf items={list(100)} />);
    const before = FakeObserver.current();
    reach();
    const after = FakeObserver.current();
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
    expect(before?.disconnected).toBe(true);
  });

  it("stops exactly at the end and never overshoots", () => {
    render(<Shelf items={list(7)} />);
    expect(count()).toBe(5);
    reach();
    expect(count()).toBe(7);
    expect(screen.getByTestId("done").textContent).toBe("true");
    expect(screen.queryByTestId("sentinel")).toBeNull();
  });

  it("never shrinks — scrolling back up finds every card still mounted", () => {
    const items = list(1714);
    const { rerender } = render(<Shelf items={items} />);
    reach();
    reach();
    reach();
    expect(count()).toBe(14);

    // The same list, re-rendered for any other reason: the window holds.
    rerender(<Shelf items={items} />);
    expect(count()).toBe(14);
  });

  it("survives a refetch that hands it a brand-new array for the same shelf", () => {
    /*
      The regression this hook was written to prevent, and which its first
      version would itself have caused.

      `useStoreData` answers more than once per visit by design: the device's
      snapshot paints first, the network's payload replaces it, and a window
      focus or the fifteen-second staleness refetches again. Every one of
      those hands the route a DIFFERENT array holding the same shelf. Keying
      the reset on array identity threw a member who was 800 cards down back
      to the first page a second after they started scrolling — which is
      «تحمل المنتجات من جديد» word for word, the fault this window exists to
      fix. Caught by an adversarial reviewer's probe, not by me.

      The shelf is the category, the sort and the filters. A refetch changes
      none of them.
    */
    const { rerender } = render(<Shelf items={list(1714)} />);
    reach();
    reach();
    reach();
    expect(count()).toBe(14);

    // Same shelf, new array — a refetch, or the snapshot giving way to the network.
    rerender(<Shelf items={list(1714)} />);
    expect(count()).toBe(14);

    // And again, with a catalogue that genuinely grew by one product.
    rerender(<Shelf items={[...list(1714), "a1714"]} />);
    expect(count()).toBe(14);
  });

  it("starts again at the top when the shelf itself changes", () => {
    const { rerender } = render(
      <Shelf items={list(1714)} resetKey="nintendo_games|newest|all|all" />,
    );
    reach();
    reach();
    expect(count()).toBe(11);

    // A new sort, a new filter, a new category: a different shelf, from the top.
    rerender(<Shelf items={list(1714, "b")} resetKey="nintendo_games|price_asc|all|all" />);
    expect(count()).toBe(5);
    expect(screen.getByTestId("last").textContent).toBe("b4");
  });

  it("shows everything where the browser has no IntersectionObserver", () => {
    delete (globalThis as any).IntersectionObserver;
    render(<Shelf items={list(40)} />);
    expect(count()).toBe(40);
    expect(screen.getByTestId("done").textContent).toBe("true");
  });

  it("is done immediately for a shelf smaller than one screenful", () => {
    render(<Shelf items={list(3)} />);
    expect(count()).toBe(3);
    expect(screen.getByTestId("done").textContent).toBe("true");
  });

  it("holds an empty shelf without asking for more", () => {
    render(<Shelf items={[]} />);
    expect(count()).toBe(0);
    expect(screen.getByTestId("done").textContent).toBe("true");
  });
});
