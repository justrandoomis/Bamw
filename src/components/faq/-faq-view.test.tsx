// @vitest-environment node
/**
 * Short answers that point at whoever owns the long one.
 *
 * The FAQ had no content at all: it read `content.faq` from the store, the
 * store was empty, and the page rendered an empty state under a hero taking
 * the whole first screen. This checks both halves of the fix — the questions
 * exist, and each links to the guide or clause that owns its subject rather
 * than restating it, because two copies of a rule means the one nobody
 * remembers to update is the one a customer reads.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FaqView } from "./FaqView";
import { faqMoreHref, mergeFaq, shippedFaqCategories, shippedFaqItems } from "@/lib/siteFaq";

const categories = mergeFaq(shippedFaqCategories(), []);
const items = mergeFaq(shippedFaqItems(), []);
const html = renderToStaticMarkup(<FaqView categories={categories} items={items} />);

describe("the questions", () => {
  it("covers the ones the brief lists", () => {
    for (const question of [
      "ما الفرق بين Offline وOnline؟",
      "هل تسجيل الحساب مختلف بين الخيارين؟",
      "هل ألعب من حسابي الشخصي؟",
      "لماذا يحتاج خيار Offline إلى الإنترنت عند الفتح؟",
      "متى أشغّل وضع الطيران؟",
      "ماذا أفعل إذا لم تعمل اللعبة؟",
      "ماذا أفعل إذا طُلب مني تسجيل الدخول مجدداً؟",
      "ماذا أفعل عند رسالة كلمة مرور خاطئة؟",
      "كيف أرسل Access Code من ٨ أحرف؟",
      "ماذا أفعل إذا لم يصل رمز التحقق؟",
      "هل أضغط Resend بنفسي؟",
      "ما هو Online License ومتى أحتاجه؟",
      "كيف أحمّل اللعبة من Virtual Game Cards؟",
      "هل أحذف مستخدم حساب اللعبة؟",
      "هل أغيّر البريد أو كلمة المرور؟",
      "هل أسترجع الحساب بعد استلامه؟",
      "هل الألعاب أصلية؟",
      "ماذا يشمل ضمان الحظر؟",
      "ما الفرق بين Standard وDeluxe وComplete وUltimate؟",
      "هل يتضمن طلبي DLC؟",
      "ماذا أفعل عند ظهور Error Code؟",
      "كيف أتواصل مع الدعم البشري؟",
    ]) {
      expect(html, question).toContain(question);
    }
  });

  it("answers all of them in the first response, not after a click", () => {
    /*
      `<details>` keeps its content in the document when closed, so the
      browser's own find-in-page reaches it. A div toggled by React state does
      not, and being findable is this page's entire job.
    */
    expect(html).toContain("<details");
    expect(html).toContain("الرمز يصل إلى بريد يملكه المتجر");
  });

  it("sends each answer to the page that owns the full explanation", () => {
    expect(html).toContain('href="/account_guides#offline-play"');
    expect(html).toContain('href="/account_guides#login-method-2"');
    expect(html).toContain('href="/policy#no-delete"');
    expect(html).toContain('href="/policy#warranty"');
    expect(html).toContain('href="/problem#RELOGIN_REQUIRED"');
  });

  it("keeps every answer short enough to read on a phone", () => {
    /*
      The property that matters, rather than banning a particular phrase: an
      answer that grows into the guide is the second copy of a rule, and the
      copy nobody remembers to update is the one a customer reads. Naming one
      Nintendo menu in passing is a summary; four paragraphs is a duplicate.
    */
    for (const item of items) {
      expect(item.answer_ar.length, item.question_ar).toBeLessThanOrEqual(340);
    }
  });

  it("leaves the step-by-step to the guide", () => {
    // No numbered sequence here — the sixteen sign-in steps live in one place.
    expect(html).not.toContain("<ol");
  });
});

describe("a link in an answer", () => {
  it("can only ever be same-origin", () => {
    /*
      These are editable from the admin screen, and an FAQ answer is not a
      place from which anybody should be able to send a customer off-site.
    */
    expect(faqMoreHref({ more_href: "https://example.com" } as never)).toBeUndefined();
    expect(faqMoreHref({ more_href: "//example.com" } as never)).toBeUndefined();
    expect(faqMoreHref({ more_href: "/policy#warranty" } as never)).toBe("/policy#warranty");
    expect(faqMoreHref({} as never)).toBeUndefined();
  });
});

describe("the shop's own edits", () => {
  it("override a shipped answer without deleting the rest", () => {
    const merged = mergeFaq(shippedFaqItems(), [
      { id: "faq_01", answer_ar: "جواب المتجر" } as never,
    ]);
    expect(merged).toHaveLength(shippedFaqItems().length);
    expect(merged.find((item) => item.id === "faq_01")?.answer_ar).toBe("جواب المتجر");
    // And the shipped question text is kept where the admin sent none.
    expect(merged.find((item) => item.id === "faq_01")?.question_ar).toContain("Offline");
  });

  it("can add a question and hide one", () => {
    const merged = mergeFaq(shippedFaqItems(), [
      { id: "own", question_ar: "سؤالنا", answer_ar: "جوابنا", sort_order: 99 } as never,
      { id: "faq_02", published: false } as never,
    ]);
    expect(merged.map((item) => item.id)).toContain("own");
    expect(merged.map((item) => item.id)).not.toContain("faq_02");
  });
});

describe("a question whose category was deleted", () => {
  it("still appears rather than vanishing", () => {
    const orphaned = renderToStaticMarkup(
      <FaqView categories={[]} items={items.slice(0, 3)} />,
    );
    expect(orphaned).toContain("أسئلة أخرى");
    expect(orphaned).toContain("ما الفرق بين Offline وOnline؟");
  });
});
