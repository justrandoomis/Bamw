/**
 * «المحاذاة مكسورة على الشاشات الصغيرة».
 *
 * The chat is one 3,800-line component and its alignment was written with
 * physical CSS — `ml-auto`, `rounded-tr`, `left-3`. A physical property does
 * not mirror, so in Arabic the customer's own messages sat on the side their
 * writing starts from and the shop's sat opposite, with every bubble tail
 * pointing away from the bubble it belonged to. The file contradicted itself
 * in the same screen: the typing indicator used flexbox's logical
 * `justify-start` and landed on the other side from the incoming messages it
 * announces.
 *
 * A source audit rather than a render: the fault is a class name, and a class
 * name is exactly what a test can hold still. Tailwind v4 ships the logical
 * utilities (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`,
 * `rounded-ss-`, `rounded-se-`), so there is no reason left to reach for a
 * physical one.
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
  it("places a bubble with a logical margin, never a physical one", () => {
    /*
      `ms-auto` is margin-inline-start, so «mine» is always the side the reader
      finishes on. `ml-auto` is the physical left in both languages, which is
      the bug.
    */
    expect(chat).toContain('isMine ? "ms-auto me-0" : "me-auto ms-0"');
    expect(linesMatching(/\b(ml-auto|mr-auto)\b/)).toEqual([]);
  });

  it("draws a bubble tail on a logical corner, so it points at its own side", () => {
    expect(chat).toContain("rounded-se-[4px]");
    expect(chat).toContain("rounded-ss-[4px]");
    expect(linesMatching(/\brounded-t[lr]-\[4px\]/)).toEqual([]);
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
