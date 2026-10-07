/**
 * «في صفحة المحادثة بعض الأجهزة تبدو بشكل كبير جدا والألوان غير مناسبة مع ثيم
 *  الموقع ثيم الفاتح والغامق حيث يظهر خصوصا عندما يجهز طلب … Rtl للرسائل»
 *
 * The chat painted a fixed cream gradient under text whose colour follows the
 * theme, so on a dark pack it was pale text on cream; it put `text-white` on
 * `bg-[var(--ink)]`, and `--ink` is the near-white foreground on a dark pack;
 * and during an order its chrome and its order card left a 640px phone a strip
 * of conversation. These keep each of those from coming back.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const chat = source("src/components/ChatView.tsx");
const card = source("src/components/chat/DigitalOrderCard.tsx");

const classNamesWith = (text: string, needle: string) =>
  text.split("\n").filter((line) => line.includes(needle));

describe("the chat follows the theme, light or dark", () => {
  it("paints the page's own colour, not a fixed cream", () => {
    expect(chat).toContain("bg-[var(--page)] text-[var(--ink)]");
    expect(chat).not.toContain("from-[#FCF9F5] via-[#F8EAE0]");
  });

  it("never puts white text on the ink colour, which is white on a dark pack", () => {
    for (const file of [chat, card]) {
      const clashes = classNamesWith(file, "bg-[var(--ink)]").filter((line) =>
        /(?<!hover:)text-white\b/.test(line),
      );
      expect(clashes).toEqual([]);
    }
  });

  it("draws the send and microphone button in the theme's primary colour", () => {
    expect(chat).toContain(
      "rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90",
    );
  });
});

describe("messages read right to left", () => {
  it("in Arabic, whatever the first word of the message is", () => {
    expect(chat).toContain('dir={isRtl ? "rtl" : "auto"}');
  });
});

describe("an order in preparation leaves room for the conversation", () => {
  it("keeps the quick replies to one row that scrolls sideways", () => {
    expect(chat).toContain("flex flex-nowrap justify-start gap-1.5 overflow-x-auto");
  });

  it("keeps the order card compact, in theme colours", () => {
    expect(card).toContain("w-[min(28rem,calc(100vw-2.5rem))]");
    expect(card).not.toContain("bg-neutral-900");
    expect(card).not.toContain("grid grid-cols-1 gap-2 text-xs sm:grid-cols-2");
  });

  it("opens one invoice, not two stacked", () => {
    const handler = card.slice(
      card.indexOf("const handleOpenInvoice"),
      card.indexOf("setShowInvoiceModal(true);"),
    );
    expect(handler).toContain("onOpenInvoice(orderId);\n      return;");
  });
});
