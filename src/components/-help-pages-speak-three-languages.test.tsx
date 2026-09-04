// @vitest-environment node
/**
 * The four help pages in a language other than Arabic.
 *
 * Their *content* is authored in Arabic and carries optional `_en`/`_ku`
 * fields an admin can fill over time. Their **chrome** — headings, the search
 * placeholder, the jump labels, "what not to do" — belongs to the app rather
 * than to the copy, and was hardcoded: a member who switched to English got an
 * English switcher and an Arabic page.
 *
 * So the chrome goes through the same dictionary as the rest of the app, and
 * every field the content model localises is read with the fallback that keeps
 * a half-translated guide readable: the English it has, the Arabic it does not.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ensureLanguageAssets, useI18n } from "@/i18n";
import { translations } from "@/i18n.data";
import { GuidesView } from "./account-guides/GuidesView";
import { PolicyView } from "./policy/PolicyView";
import { FaqView } from "./faq/FaqView";
import { applyGuideOverrides, shippedGuides } from "@/lib/siteGuides";
import { resolvePolicy } from "@/lib/sitePolicy";
import { mergeFaq, shippedFaqCategories, shippedFaqItems } from "@/lib/siteFaq";
import { stripAdminNotes } from "@/lib/content";

const guides = stripAdminNotes(applyGuideOverrides(shippedGuides(), []));
const policy = stripAdminNotes(resolvePolicy(undefined));
const faqCategories = mergeFaq(shippedFaqCategories(), []);
const faqItems = mergeFaq(shippedFaqItems(), []);

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>,
  );

/** Every chrome string the four pages ask the dictionary for. */
const CHROME = [
  "دليل الحساب والتشغيل",
  "أقسام الدليل",
  "طرق تسجيل الدخول",
  "رمز التحقق",
  "تحميل اللعبة",
  "تشغيل حساب Offline",
  "تشغيل حساب Online",
  "الخيار والإصدار",
  "لا توجد أدلة منشورة حالياً.",
  "سياسة المتجر",
  "الملخص",
  "الإصدار",
  "آخر تحديث",
  "لا توجد بنود منشورة حالياً.",
  "الأسئلة الشائعة",
  "ابحث عن سؤال…",
  "ابحث في الأسئلة الشائعة",
  "لا يوجد سؤال يطابق بحثك.",
  "أسئلة أخرى",
  "الشرح الكامل",
  "ما لا يجب فعله",
  "متى تتواصل معنا",
];

describe("the dictionary", () => {
  it("has an English and a Kurdish entry for every chrome string these pages use", () => {
    for (const key of CHROME) {
      expect(translations[key], key).toBeTruthy();
      expect(translations[key]?.en?.trim(), `${key} → en`).toBeTruthy();
      expect(translations[key]?.ku?.trim(), `${key} → ku`).toBeTruthy();
    }
  });

  it("translates rather than echoing the Arabic back", () => {
    for (const key of CHROME) {
      expect(translations[key]?.en, key).not.toBe(key);
      expect(translations[key]?.ku, key).not.toBe(key);
    }
  });
});

describe("in Arabic", () => {
  beforeAll(() => useI18n.setState({ lang: "ar" }));

  it("reads as it always did", () => {
    expect(render(<GuidesView guides={guides} />)).toContain("دليل الحساب والتشغيل");
    expect(render(<PolicyView policy={policy} />)).toContain("الملخص");
    expect(render(<FaqView categories={faqCategories} items={faqItems} />)).toContain(
      "الأسئلة الشائعة",
    );
  });
});

describe("in English", () => {
  beforeAll(async () => {
    await ensureLanguageAssets("en");
    useI18n.setState({ lang: "en" });
  });

  it("translates the manual's chrome", () => {
    const html = render(<GuidesView guides={guides} />);
    expect(html).toContain("Account &amp; Play Guide");
    expect(html).toContain("Sign-in methods");
    expect(html).toContain("Download the game");
    expect(html).not.toContain("دليل الحساب والتشغيل");
  });

  it("translates the policy's chrome", () => {
    const html = render(<PolicyView policy={policy} />);
    expect(html).toContain("Summary");
    expect(html).not.toContain(">الملخص<");
  });

  it("translates the FAQ's chrome", () => {
    const html = render(<FaqView categories={faqCategories} items={faqItems} />);
    expect(html).toContain("Frequently Asked Questions");
    expect(html).toContain("Search for a question");
    expect(html).toContain("Full explanation");
  });

  it("still shows the Arabic content, because that is what was written", () => {
    /*
      The fallback that matters. An admin fills `_en` over time; until they do,
      an English reader gets the English chrome and the Arabic clause — not a
      blank page, and not a heading over nothing.
    */
    const html = render(<PolicyView policy={policy} />);
    expect(html).toContain("ضمان الحظر");
  });

  it("prefers an English field the moment one exists", () => {
    const translated = {
      ...policy,
      sections: policy.sections.map((section) =>
        section.anchor === "warranty"
          ? { ...section, title_en: "Ban warranty", summary_en: "Lifetime cover, with conditions." }
          : section,
      ),
    };
    const html = render(<PolicyView policy={translated} />);
    expect(html).toContain("Ban warranty");
    expect(html).toContain("Lifetime cover, with conditions.");
  });
});

describe("in Kurdish", () => {
  beforeAll(async () => {
    await ensureLanguageAssets("ku");
    useI18n.setState({ lang: "ku" });
  });

  it("translates the chrome rather than falling back to Arabic", () => {
    const html = render(<GuidesView guides={guides} />);
    expect(html).toContain("ڕێنمایی هەژمار و یاریکردن");
    expect(html).not.toContain("دليل الحساب والتشغيل");
  });

  it("keeps the Arabic content until somebody translates it", () => {
    const html = render(<FaqView categories={faqCategories} items={faqItems} />);
    expect(html).toContain("ما الفرق بين Offline وOnline؟");
  });
});

describe("the FAQ search", () => {
  it("looks in every language the answer has", () => {
    /*
      A member reading in English may still type the Arabic word they know the
      feature by, and the keywords are written in both.
    */
    const view = require("node:fs").readFileSync(
      require("node:path").resolve(process.cwd(), "src/components/faq/FaqView.tsx"),
      "utf8",
    );
    expect(view).toContain("item.question_en");
    expect(view).toContain("item.answer_en");
  });
});
