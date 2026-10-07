/**
 * «وقم بتحسين ui ux للمحادثه اكثر»
 *
 * What changed in the member's chat, and what each change keeps from coming
 * back:
 *
 * - the order's progress is one strip of four steps in the theme's colours,
 *   not a banner whose colour changed with every stage — a blue the cream
 *   theme has nowhere else among them;
 * - the header says whether the admin is there, instead of a third
 *   «دورك الآن», and says it from data the server and the browser agree on;
 * - the paperclip opens the picker, where a lightning bolt opened three
 *   buttons that all opened the same picker;
 * - send sits at the end of the line, and the placeholder fits the field;
 * - a new day is labelled, a picture opens whole, and the replies that do not
 *   fit fade out instead of being cut.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { deliveryStep } from "@/lib/chatDelivery";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const chat = source("src/components/ChatView.tsx");
const tracker = source("src/components/chat/DeliveryTracker.tsx");

describe("the order's progress", () => {
  it("puts every delivery stage on one of four steps", () => {
    expect(deliveryStep(undefined)).toEqual({ index: 0, done: false });
    expect(deliveryStep("in_queue")).toEqual({ index: 0, done: false });
    expect(deliveryStep("preparing_now")).toEqual({ index: 0, done: false });
    expect(deliveryStep("awaiting_login_proof")).toEqual({ index: 1, done: false });
    expect(deliveryStep("proof_received")).toEqual({ index: 2, done: false });
    expect(deliveryStep("awaiting_otp")).toEqual({ index: 2, done: false });
    expect(deliveryStep("otp_sent")).toEqual({ index: 3, done: false });
    expect(deliveryStep("completed")).toEqual({ index: 3, done: true });
  });

  it("is drawn by the tracker, in the theme's colours", () => {
    expect(chat).toContain("<DeliveryTracker");
    expect(chat).not.toContain("border-blue-500/30 bg-blue-500/10 text-blue-950");
    expect(tracker).toContain("bg-primary");
    expect(tracker).not.toMatch(/bg-(blue|amber|emerald)-/);
  });

  it("offers the proof button only where a proof is due", () => {
    expect(tracker).toContain('stage === "awaiting_login_proof" ? (');
    expect(tracker).toContain('stage === "proof_received" ? (');
  });
});

describe("the header", () => {
  it("says whether the admin is there, from the live queue alone", () => {
    expect(chat).toContain('tr("المشرف متاح")');
    // The page's own guess differs between server and browser at first paint.
    expect(chat).not.toContain("liveQueueMetrics?.adminStatus ?? adminStatus");
    expect(chat).not.toContain('tr("دورك الآن ⚡")');
  });
});

describe("the composer", () => {
  it("attaches with one button that opens the picker", () => {
    expect(chat).toContain('aria-label={tr("إرفاق صورة")}');
    expect(chat).not.toContain("showAttachments");
  });

  it("sends from the end of the line, outside the field", () => {
    const field = chat.indexOf("placeholder-[var(--muted-ink)]");
    const send = chat.indexOf('tr("تسجيل رسالة صوتية")', field);
    expect(field).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(field);
    expect(chat).not.toContain('absolute ${"start-1"} z-20');
  });

  it("asks in words that fit a 360px field", () => {
    expect(chat).toContain('tr("اكتب للمشرف...")');
    expect(chat).not.toContain('tr("اكتب رسالتك للمشرف بخصوص الطلب...")');
  });

  it("fades the replies that run past the edge", () => {
    expect(chat).toContain("rtl:[mask-image:linear-gradient(to_right,transparent,black_28px)]");
  });
});

describe("the thread", () => {
  it("labels the first message of each day", () => {
    expect(chat).toContain("dayLabel(msg.createdAt, lang)");
    expect(chat).toContain('return tr("اليوم");');
    expect(chat).toContain('return tr("أمس");');
  });

  it("opens a picture at the size of the screen", () => {
    expect(chat).toContain("<ImageViewer");
    expect(chat).toContain('setViewerSrc(String(msg.payload?.["imageUrl"]');
  });

  it("keeps to a readable column on a wide screen", () => {
    expect(chat).toContain('<div className="mx-auto flex w-full max-w-3xl flex-col">');
  });
});
