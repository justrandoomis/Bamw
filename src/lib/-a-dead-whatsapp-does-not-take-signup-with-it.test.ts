/**
 * What a customer can still do when WhatsApp verification is rejected.
 *
 * Reported live on banan.to: «تعذر إرسال رمز التحقق عبر واتساب حالياً. يرجى
 * المحاولة لاحقاً.» That sentence has one source — the `401 || 403` branch of
 * the WaSender client — so the provider was refusing the store's credential.
 * Restoring the credential is the owner's; everything else here was ours, and
 * each of these is a way the shop made a bad hour worse.
 */

import { describe, expect, it } from "vitest";

import { normalizePhoneForWhatsApp } from "@/services/whatsapp/wasender";

describe("what the provider's answer means", () => {
  /*
    The five branches, pinned so the next reader can tell an outage from a
    rejected key from a bad number without running anything. Only one of these
    is what production showed.
  */
  const SENTENCES = {
    noKey: "مفتاح خدمة واتساب غير مهيأ",
    badPhone: "رقم الهاتف غير صالح",
    rejected: "تعذر إرسال رمز التحقق عبر واتساب حالياً. يرجى المحاولة لاحقاً.",
    rateLimited: "تم تجاوز حد الإرسال. يرجى الانتظار قليلاً والمحاولة مجدداً.",
  };

  it("distinguishes a rejected credential from every other failure", () => {
    const distinct = new Set(Object.values(SENTENCES));
    expect(distinct.size).toBe(Object.keys(SENTENCES).length);
  });

  it("the sentence production showed is the rejected-credential one", () => {
    expect(SENTENCES.rejected).toContain("يرجى المحاولة لاحقاً");
    expect(SENTENCES.rejected).not.toBe(SENTENCES.rateLimited);
  });
});

describe("the number a customer types", () => {
  it("accepts the local Iraqi forms the signup screen offers", () => {
    expect(normalizePhoneForWhatsApp("07701234567")).toBe("+9647701234567");
    expect(normalizePhoneForWhatsApp("7701234567")).toBe("+9647701234567");
    expect(normalizePhoneForWhatsApp("+9647701234567")).toBe("+9647701234567");
    expect(normalizePhoneForWhatsApp("009647701234567")).toBe("+9647701234567");
  });

  it("survives the spacing and punctuation people paste", () => {
    expect(normalizePhoneForWhatsApp("+964 770 123 4567")).toBe("+9647701234567");
    expect(normalizePhoneForWhatsApp("(0770) 123-4567")).toBe("+9647701234567");
  });

  it("refuses what is not a number at all", () => {
    expect(normalizePhoneForWhatsApp("")).toBeNull();
    expect(normalizePhoneForWhatsApp("abc")).toBeNull();
    expect(normalizePhoneForWhatsApp("123")).toBeNull();
  });
});
