/**
 * «فقاعه الرسالة تظهر زاحفة الى المنتصف الرسالة من النظام او الادمن»
 *
 * The shop's bubbles sat away from their edge, toward the middle. The row a
 * message lived in was `w-fit`, as wide as its bubble, and the bubble inside
 * it was capped at `max-w-[80%]` — a percentage of a box sized by its own
 * content. The browser sized the row to the text, capped the bubble at 80% of
 * that, and put the bubble at the row's inline start: the RIGHT, in Arabic.
 * Measured on a 375px phone, the shop's «أهلاً بك» sat 42px off the left
 * edge and «وصلت الصورة» 58px; in English the member's own bubble sat 67px
 * off the right one.
 *
 * Now the row spans the thread and pins its one child physically.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { bubbleRow, bubbleSide } from "./chatSides";

const chat = readFileSync(resolve(process.cwd(), "src/components/ChatView.tsx"), "utf8");

describe("a message row", () => {
  it("spans the thread, so a bubble's percentage width is a share of the thread", () => {
    expect(bubbleRow(true)).toContain("w-full");
    expect(bubbleRow(false)).toContain("w-full");
    expect(bubbleRow(true)).not.toContain("w-fit");
    expect(bubbleRow(false)).not.toContain("w-fit");
  });

  it("pins its child to the same physical edge as a bubble", () => {
    // The member on the right, the shop on the left — in either language.
    expect(bubbleRow(true)).toContain("[&>*]:ml-auto");
    expect(bubbleSide(true)).toContain("ml-auto");
    expect(bubbleRow(false)).toContain("[&>*]:mr-auto");
    expect(bubbleSide(false)).toContain("mr-auto");
    for (const row of [bubbleRow(true), bubbleRow(false)]) {
      expect(row).not.toMatch(/\b(ms|me)-|justify-(start|end)|items-(start|end)/);
    }
  });

  it("is what the thread uses for every message", () => {
    expect(chat).toContain("${bubbleRow(isMine)}");
    expect(chat).not.toContain("flex w-fit max-w-full ${startsRun");
  });
});
