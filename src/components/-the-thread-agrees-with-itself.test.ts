/**
 * Every part of a thread takes its side from the same rule.
 *
 * The owner reported two things about the chat, and the second one —
 * «أحيانًا بعيدة عن الحافة», sometimes far from the edge — was not a stray
 * margin. It was the bubbles, the typing indicator and the loading skeletons
 * each deciding for themselves which side they were on, two of them using
 * direction-aware utilities and one not, so in Arabic they landed on opposite
 * edges and a bubble could sit a screen-width away from the indicator that
 * belonged to it.
 *
 * These are source assertions, because that is the shape of the defect: not
 * "does this component render correctly" but "does any component in the thread
 * still answer this question by itself".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The source with its comments removed.
 *
 * The comments explain the fix and therefore quote the classes it removed, so
 * a test that reads the raw file fails on its own explanation. Code only.
 */
function code(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const CHAT_VIEW = code("./ChatView.tsx");
const ORDER_CHAT = code("./OrderChat.tsx");

/** The raw source, for the things that live in code and not in a comment. */
const CHAT_VIEW_RAW = readFileSync(new URL("./ChatView.tsx", import.meta.url), "utf8");
const ORDER_CHAT_RAW = readFileSync(new URL("./OrderChat.tsx", import.meta.url), "utf8");

describe("the chat screens take their sides from one place", () => {
  it("both import the shared rule", () => {
    expect(CHAT_VIEW_RAW).toContain('from "@/lib/chatSides"');
    expect(ORDER_CHAT_RAW).toContain('from "@/lib/chatSides"');
  });

  it("no longer aligns a bubble with ms-auto or me-auto", () => {
    // The exact pair the earlier pass introduced, and the reason it read backwards.
    expect(CHAT_VIEW).not.toMatch(/\bms-auto\b/);
    expect(CHAT_VIEW).not.toMatch(/\bme-auto\b/);
  });

  it("no longer aligns a bubble row with justify-start or justify-end", () => {
    expect(ORDER_CHAT).not.toMatch(/flex \$\{mine \? "justify-end" : "justify-start"\}/);
  });

  it("gives the guides a link from the order-prep conversation", () => {
    // The owner asked for a small, soft icon into /account_guides from here.
    expect(CHAT_VIEW_RAW).toContain('href="/account_guides"');
    expect(ORDER_CHAT_RAW).toContain('href="/account_guides"');
  });
});
