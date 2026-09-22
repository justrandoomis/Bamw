/**
 * «المحاذاة مكسورة على الشاشات الصغيرة».
 *
 * A source audit rather than a render: these faults are class names, and a
 * class name is exactly what a test can hold still.
 *
 * TWO OF THESE TESTS USED TO SAY THE OPPOSITE, and the reversal is the point.
 * This file once required the logical utilities everywhere — `ms-auto`,
 * `rounded-se-` — reasoning that a member's own messages belong at "the side
 * the reader finishes on", which under `dir="rtl"` is the LEFT. That is a
 * coherent rule. It is not the shop's rule. The owner looked at the result and
 * said «المرسل يجب أن يكون في اليمين والدعم في اليسار» — the sender on the
 * right, the shop on the left — which is the arrangement their members already
 * know from every messaging app they use, and which does not move with the
 * language of the interface.
 *
 * So the side is now physical, decided once in src/lib/chatSides.ts, and these
 * tests hold THAT. The rest of the file is unchanged: a property that already
 * follows `dir` must not be flipped again on top, the header must fit a 360px
 * phone, and a run of messages from one sender is one thought.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const chat = readFileSync(resolve(process.cwd(), "src/components/ChatView.tsx"), "utf8");

/** The lines that decide which side of the conversation a message sits on. */
function linesMatching(pattern: RegExp): string[] {
  return (
    chat
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      /*
      Only lines that actually set classes. A comment naming the mistake is the
      record of why it was fixed, and must not be mistaken for the mistake.
    */
      .filter((entry) => /class(Name)?=|"[a-z0-9-]+ |`[a-z0-9-]+ /.test(entry.line))
      .filter((entry) => pattern.test(entry.line))
      .map((entry) => `${entry.number}: ${entry.line}`)
  );
}

describe("the conversation reads the same way round as the language", () => {
  it("takes every bubble's side from the one shared rule", () => {
    /*
      Not "uses a physical class" — uses THE helper. The defect the owner
      reported as «أحيانًا بعيدة عن الحافة» was three parts of the thread
      each answering this question for themselves and two of them disagreeing,
      so the test that matters is that nothing answers it locally any more.
    */
    expect(chat).toContain('from "@/lib/chatSides"');
    expect(linesMatching(/\b(ms-auto|me-auto)\b/)).toEqual([]);
    expect(linesMatching(/isMine \? "items-end" : "items-start"/)).toEqual([]);
  });

  it("draws a bubble tail on a physical corner, on the side the bubble is pinned to", () => {
    /*
      `rounded-ss-`/`rounded-se-` swap corners with the language while the
      bubble no longer does, which would point every tail away from its own
      speaker. `bubbleTail` returns `rounded-tr-`/`rounded-tl-`.
    */
    expect(chat).toContain("bubbleTail(");
    expect(linesMatching(/\brounded-s[se]-\[4px\]/)).toEqual([]);
  });

  it("does not flip a property that already follows the direction", () => {
    /*
      `justify-start`, `text-start` and `start-3` are resolved against `dir`
      already. A conditional on top of them flips them back, which is how the
      quick-reply chips came to hug the opposite edge from the composer they
      belong to.
    */
    expect(linesMatching(/isRtl \? "(justify|text|right|left|pl|pr)/)).toEqual([]);
  });

  it("keeps the header inside a 360px phone", () => {
    /*
      A flex item's minimum width is its content unless told otherwise, so an
      untruncated order subject in the centre column pushed the actions past
      the edge — and because the message pane's computed overflow-x is `auto`
      whenever overflow-y is, the whole conversation could then be dragged
      sideways.
    */
    expect(chat).toContain(
      'className="flex min-w-0 flex-1 flex-col items-center justify-center px-1.5 text-center"',
    );
    expect(chat).toContain("overflow-y-auto overflow-x-hidden px-4");
  });

  it("groups a run of messages from one sender instead of spacing them all alike", () => {
    expect(chat).toContain("const startsRun = !previous || previous.sender !== msg.sender");
    expect(chat).toContain("const endsRun = !next || next.sender !== msg.sender");
    // The time belongs to the run, and to both sides of the conversation.
    expect(chat).toContain("{endsRun && (");
  });
});
