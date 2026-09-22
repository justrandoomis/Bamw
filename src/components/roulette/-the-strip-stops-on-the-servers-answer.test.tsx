/**
 * @vitest-environment jsdom
 *
 * The strip stops on the card the server named, and on no other one.
 *
 * «يجب أن تكون النتيجة النهائية بصرياً مطابقة 100% لنتيجة السيرفر» is the whole
 * of what this file checks, and the only interesting way to get it wrong is the
 * one the owner also named: «لا تسمح لاختلاف عرض الشاشة أن يجعل المؤشر يقف على
 * بطاقة أخرى». A strip that assumes a card is 100px wide lands perfectly on the
 * phone it was written on and half a card out on every other one — and half a
 * card out is a different game under the pointer.
 *
 * jsdom has no layout: every rectangle it reports is zero, so a component that
 * measures its own geometry measures nothing here. `getBoundingClientRect` is
 * therefore mocked to give the strip a real card width, a real gap and a real
 * container width — and the same run is then played at three container widths,
 * because a landing computed from a constant passes at one width and fails at
 * the other two.
 *
 * The frames are ours too. `requestAnimationFrame` is replaced with a queue we
 * step by hand, so a run is driven to its last frame deterministically instead
 * of being waited on.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RouletteCard } from "./RouletteStrip";

vi.mock("@/i18n", () => ({ tr: (key: string) => key }));
vi.mock("@/lib/img", () => ({ cdnImage: (src: string | null) => src ?? "" }));

const { RouletteStrip } = await import("./RouletteStrip");

/** The layout the strip is told it has. Nothing in the component knows these. */
const CARD_WIDTH = 96;
const GAP = 10;
const STEP = CARD_WIDTH + GAP;

let containerWidth = 390;

const POOL: RouletteCard[] = [
  { id: "mario-kart", title: "Mario Kart 8 Deluxe", image: "https://cdn.test/mk8.webp" },
  { id: "odyssey", title: "Super Mario Odyssey", image: "https://cdn.test/odyssey.webp" },
  { id: "zelda-totk", title: "Tears of the Kingdom", image: "https://cdn.test/totk.webp" },
  { id: "smash", title: "Super Smash Bros. Ultimate", image: "https://cdn.test/smash.webp" },
  { id: "splatoon", title: "Splatoon 3", image: "https://cdn.test/splatoon.webp" },
  { id: "metroid", title: "Metroid Dread", image: "https://cdn.test/metroid.webp" },
  { id: "kirby", title: "Kirby and the Forgotten Land", image: "https://cdn.test/kirby.webp" },
  { id: "pikmin", title: "Pikmin 4", image: "https://cdn.test/pikmin.webp" },
];

const WINNER = POOL[5];
const SOMEONE_ELSE = POOL[1];

const boxOf = (left: number, width: number): DOMRect => ({
  x: left,
  y: 0,
  left,
  top: 0,
  right: left + width,
  bottom: 132,
  width,
  height: 132,
  toJSON: () => ({}),
});

const realRect = Element.prototype.getBoundingClientRect;
const realRequestFrame = window.requestAnimationFrame;
const realCancelFrame = window.cancelAnimationFrame;
const realMatchMedia = window.matchMedia;

let clock = 0;
let nextHandle = 0;
let pending = new Map<number, FrameRequestCallback>();

/**
 * The browser's answer to «كم عرض البطاقة فعلياً».
 *
 * Keyed off the strip's own data attributes, so the card rectangles are laid
 * out at their real step and the container reports whatever width the test is
 * currently pretending the phone has.
 */
function mockLayout() {
  Element.prototype.getBoundingClientRect = function measured(this: Element): DOMRect {
    if (this.hasAttribute("data-roulette-viewport")) return boxOf(0, containerWidth);
    if (this.hasAttribute("data-roulette-card")) {
      return boxOf(Number(this.getAttribute("data-card-index") ?? 0) * STEP, CARD_WIDTH);
    }
    return boxOf(0, 0);
  };
}

function mockFrames() {
  clock = 0;
  nextHandle = 0;
  pending = new Map();
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    nextHandle += 1;
    pending.set(nextHandle, callback);
    return nextHandle;
  };
  window.cancelAnimationFrame = (handle: number) => {
    pending.delete(handle);
  };
}

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Step the strip forward the way a browser would, in frames of `each` ms. */
function runFrames(milliseconds: number, each = 16) {
  act(() => {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += each) {
      clock += each;
      const due = [...pending.values()];
      pending.clear();
      due.forEach((callback) => callback(clock));
    }
  });
}

function offsetOf(container: HTMLElement): number {
  const track = container.querySelector<HTMLElement>("[data-roulette-track]");
  const matched = /translate3d\((-?[\d.]+)px/.exec(track?.style.transform ?? "");
  return matched ? Number(matched[1]) : Number.NaN;
}

/**
 * Which card the centre pointer is actually on, worked out from the mocked
 * layout and the track's translate — the same two things a browser would use,
 * and deliberately not from anything the component says about itself.
 */
function underThePointer(container: HTMLElement): { id: string; miss: number } {
  const offset = offsetOf(container);
  const tiles = Array.from(container.querySelectorAll<HTMLElement>("[data-roulette-card]"));
  return tiles.reduce(
    (closest, tile, index) => {
      const centre = offset + index * STEP + CARD_WIDTH / 2;
      const miss = Math.abs(centre - containerWidth / 2);
      return miss < closest.miss ? { id: tile.getAttribute("data-card-id") ?? "", miss } : closest;
    },
    { id: "", miss: Number.POSITIVE_INFINITY },
  );
}

beforeEach(() => {
  containerWidth = 390;
  mockLayout();
  mockFrames();
  mockReducedMotion(false);
});

afterEach(() => {
  cleanup();
  Element.prototype.getBoundingClientRect = realRect;
  window.requestAnimationFrame = realRequestFrame;
  window.cancelAnimationFrame = realCancelFrame;
  window.matchMedia = realMatchMedia;
});

describe("a run that the server has already decided", () => {
  /*
    Three widths, one expectation. 320 is the smallest Android the shop sees,
    390 the iPhone the owner tests on, 768 a tablet — and the winning index the
    strip plans differs at each, so a landing that is measured passes all three
    and a landing that is assumed cannot pass more than one.
  */
  for (const width of [320, 390, 768]) {
    it(`leaves the server's game under the pointer on a ${width}px screen`, () => {
      containerWidth = width;
      const onSettled = vi.fn();

      const view = render(<RouletteStrip cards={POOL} outcome={null} onSettled={onSettled} />);
      // Drift first: a run has to land from wherever the idle loop had got to.
      runFrames(400);

      view.rerender(
        <RouletteStrip
          cards={POOL}
          outcome={{ runId: "run-1", card: WINNER }}
          onSettled={onSettled}
        />,
      );
      runFrames(6000);

      const landed = underThePointer(view.container);
      expect(landed.id).toBe(WINNER.id);
      // Not "nearest card" — the winner's centre is ON the pointer.
      expect(landed.miss).toBeLessThan(0.5);
    });
  }

  it("keeps the popup shut until the strip has stopped, then opens it once", () => {
    const onSettled = vi.fn();
    const view = render(<RouletteStrip cards={POOL} outcome={null} onSettled={onSettled} />);

    view.rerender(
      <RouletteStrip
        cards={POOL}
        outcome={{ runId: "run-2", card: WINNER }}
        onSettled={onSettled}
      />,
    );

    runFrames(1000);
    expect(onSettled).not.toHaveBeenCalled();

    runFrames(6000);
    expect(onSettled).toHaveBeenCalledTimes(1);

    // Frames keep coming from the page; the run is over and stays over.
    runFrames(4000);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("ignores an answer carrying a runId it has already played", () => {
    const onSettled = vi.fn();
    const view = render(<RouletteStrip cards={POOL} outcome={null} onSettled={onSettled} />);

    view.rerender(
      <RouletteStrip
        cards={POOL}
        outcome={{ runId: "run-3", card: WINNER }}
        onSettled={onSettled}
      />,
    );
    runFrames(6000);
    const landedAt = offsetOf(view.container);

    /*
      A re-render with a new object, the same run id and a different card —
      which is what a refetch, a cache write or a parent re-render looks like
      from in here. It is the same answer, so nothing may move.
    */
    view.rerender(
      <RouletteStrip
        cards={POOL}
        outcome={{ runId: "run-3", card: SOMEONE_ELSE }}
        onSettled={onSettled}
      />,
    );
    runFrames(6000);

    expect(offsetOf(view.container)).toBe(landedAt);
    expect(underThePointer(view.container).id).toBe(WINNER.id);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("stops on a card that is not a prize when the spin lost", () => {
    const onSettled = vi.fn();
    const view = render(<RouletteStrip cards={POOL} outcome={null} onSettled={onSettled} />);

    // «حظ أوفر»: the run happens, the strip stops, nothing is presented as won.
    view.rerender(
      <RouletteStrip cards={POOL} outcome={{ runId: "run-4", card: null }} onSettled={onSettled} />,
    );
    runFrames(6000);

    const landed = underThePointer(view.container);
    expect(POOL.map((card) => card.id)).toContain(landed.id);
    expect(landed.miss).toBeLessThan(0.5);
    expect(view.container.querySelector(".ring-2")).toBeNull();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});

describe("a strip nobody has spun yet", () => {
  it("drifts on its own and never reaches the end of the ribbon", () => {
    const view = render(<RouletteStrip cards={POOL} outcome={null} />);
    const first = offsetOf(view.container);

    runFrames(1000);
    expect(offsetOf(view.container)).toBeLessThan(first);

    /*
      Well past one full repetition at the idle speed. «وكأنه لا نهائي»: the
      offset wraps by the width of one sequence instead of running off the end
      of a track that would then be empty on the right.
    */
    runFrames(40_000, 64);
    expect(offsetOf(view.container)).toBeGreaterThan(-POOL.length * STEP);
    expect(offsetOf(view.container)).toBeLessThanOrEqual(0);
  });

  it("goes back to drifting once the caller clears the outcome", () => {
    const view = render(<RouletteStrip cards={POOL} outcome={null} />);
    view.rerender(<RouletteStrip cards={POOL} outcome={{ runId: "run-6", card: WINNER }} />);
    runFrames(6000);
    expect(offsetOf(view.container)).toBeLessThan(-POOL.length * STEP);

    // The popup closed. The ribbon is a ribbon again, not a strip parked
    // thousands of pixels into a track that is only two screens wide.
    view.rerender(<RouletteStrip cards={POOL} outcome={null} />);
    const resumedAt = offsetOf(view.container);
    expect(resumedAt).toBeGreaterThan(-POOL.length * STEP);

    runFrames(1000);
    expect(offsetOf(view.container)).toBeLessThan(resumedAt);
  });

  it("gives a game with no artwork its own title on a plain tile, and no picture at all", () => {
    const nameless: RouletteCard = { id: "unlisted", title: "لعبة بلا صورة", image: null };
    const view = render(<RouletteStrip cards={[POOL[0], nameless]} outcome={null} />);

    const tile = view.container.querySelector<HTMLElement>('[data-card-id="unlisted"]');
    expect(tile).not.toBeNull();
    expect(tile?.querySelector("img")).toBeNull();
    expect(tile?.textContent).toContain(nameless.title);
  });
});

describe("a reader who asked for less motion", () => {
  it("is shown the same winner, standing still, and still gets the popup", async () => {
    mockReducedMotion(true);
    const onSettled = vi.fn();

    const view = render(<RouletteStrip cards={POOL} outcome={null} onSettled={onSettled} />);
    view.rerender(
      <RouletteStrip
        cards={POOL}
        outcome={{ runId: "run-5", card: WINNER }}
        onSettled={onSettled}
      />,
    );

    // No frames are stepped at all: there is no travel to step through.
    expect(pending.size).toBe(0);
    const landed = underThePointer(view.container);
    expect(landed.id).toBe(WINNER.id);
    expect(landed.miss).toBeLessThan(0.5);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});
