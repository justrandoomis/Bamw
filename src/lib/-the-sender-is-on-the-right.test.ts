/**
 * The sender on the right, the shop on the left — in Arabic too.
 *
 * «المرسل يجب أن يكون في اليمين والدعم في اليسار». The thread had been changed
 * the other way on the reasoning that a member's own messages belong at "the
 * end of the line the reader finishes on", which in a right-to-left thread is
 * the LEFT. That is a defensible rule and it is not the one the owner asked
 * for, so this test states the rule that is: the side is PHYSICAL and does not
 * move with the language.
 *
 * It is a class-name test on purpose. Every logical utility here —  `ms-`,
 * `me-`, `justify-start`, `justify-end`, `items-start`, `items-end`,
 * `rounded-ss`, `rounded-se` — silently swaps sides under `dir="rtl"`, which
 * is why the thread ended up with three different answers to the same
 * question and bubbles that did not line up with the indicator below them.
 */
import { describe, expect, it } from "vitest";

import { bubbleSide, bubbleTail } from "./chatSides";

describe("which side a bubble sits on", () => {
  it("pins the member's own message to the physical right", () => {
    expect(bubbleSide(true)).toContain("ml-auto");
    expect(bubbleSide(true)).toContain("mr-0");
  });

  it("pins the shop's message to the physical left", () => {
    expect(bubbleSide(false)).toContain("mr-auto");
    expect(bubbleSide(false)).toContain("ml-0");
  });

  it("uses no class that changes side with the reading direction", () => {
    const logical = [
      /\bms-/,
      /\bme-/,
      /\bjustify-start\b/,
      /\bjustify-end\b/,
      /\bitems-start\b/,
      /\bitems-end\b/,
      /\brounded-ss/,
      /\brounded-se/,
      /\brounded-es/,
      /\brounded-ee/,
      /\bstart-/,
      /\bend-/,
      /\btext-start\b/,
      /\btext-end\b/,
    ];
    for (const produced of [
      bubbleSide(true),
      bubbleSide(false),
      bubbleTail(true),
      bubbleTail(false),
    ]) {
      for (const pattern of logical) {
        expect(produced, `${produced} must not use ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("points the tail at the side the bubble is pinned to", () => {
    expect(bubbleTail(true)).toBe("rounded-tr-[4px]");
    expect(bubbleTail(false)).toBe("rounded-tl-[4px]");
  });

  it("gives the two speakers opposite sides, never the same one", () => {
    expect(bubbleSide(true)).not.toBe(bubbleSide(false));
    expect(bubbleTail(true)).not.toBe(bubbleTail(false));
  });
});
