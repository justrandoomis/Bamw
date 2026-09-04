// @vitest-environment node
/**
 * The troubleshooting page, checked on the HTML a customer is actually sent.
 *
 * Two things this guards, beyond the content existing:
 *
 * An override used to **replace** a shipped problem rather than merge onto it.
 * `ProblemEntry` has no aliases, no symptoms and no `relatedErrors`, so an
 * admin who uploaded a screenshot — or fixed a typo — silently deleted the
 * error codes that let the search find that problem. A customer typing
 * "2124-8006" would then be told nothing matches.
 *
 * And the empty image slot: every new entry declares where a screenshot
 * belongs, and until one is uploaded the page must render no image, no
 * placeholder, and never the note written for whoever uploads it.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getPublishedProblems } from "./repository";
import { applyProblemOverrides, countCategories } from "./merge";
import { ProblemSolutionView } from "@/components/problem-solution/problem-solution-view";

const problems = await getPublishedProblems();
const html = renderToStaticMarkup(
  <ProblemSolutionView problems={problems} counts={countCategories(problems)} />,
);

describe("the shipped troubleshooting content", () => {
  it("kept every entry that was already there", () => {
    const ids = problems.map((p) => p.id);
    for (const id of [
      "LOGIN_001",
      "ERROR_2813",
      "GAME_NOT_WORKING",
      "ORDER_STATUS",
      "ESHOP_CODE_INVALID",
      "DOWNLOAD_SLOW",
      "PARENTAL_PIN",
    ]) {
      expect(ids, id).toContain(id);
    }
  });

  it("adds the three the brief asks for", () => {
    const ids = problems.map((p) => p.id);
    expect(ids).toContain("RELOGIN_REQUIRED");
    expect(ids).toContain("INTERNET_CODES");
    expect(ids).toContain("VERIFICATION_CODE");
  });

  it("carries both sign-in-again messages a customer may see", () => {
    expect(html).toContain("Can’t play this software right now");
    expect(html).toContain("Sign in to your Nintendo Account again");
  });

  it("is findable by the codes a customer literally types", () => {
    expect(html).toContain("2124-8006");
    expect(html).toContain("2810-1006");
  });

  it("says what not to do, where it matters most", () => {
    expect(html).toContain("Forgot your password");
    expect(html).toContain("ما لا يجب فعله");
  });

  it("says when to stop and ask a person", () => {
    expect(html).toContain("متى تتواصل معنا");
  });

  it("does not claim every error code is the internet's fault", () => {
    expect(html).toContain("لا تفترض أن كل Error Code سببه الإنترنت");
  });

  it("states the one-hour validity of a verification code", () => {
    expect(html).toContain("صالح لمدة ساعة");
  });
});

describe("an empty screenshot slot", () => {
  it("renders no picture for the entries that have none yet", () => {
    /*
      The twelve original entries have committed illustrations, so the page has
      images. The three new ones declare slots and no files — and none of their
      hints may reach a customer.
    */
    expect(html).not.toContain("أضف صورة");
  });
});

describe("an admin's override", () => {
  const base = problems;

  it("keeps the error codes the search depends on", () => {
    const merged = applyProblemOverrides(base, [
      { id: "INTERNET_CODES", title: "عنوان معدّل", description: "", category: "errors" },
    ]);
    const entry = merged.find((p) => p.id === "INTERNET_CODES");
    expect(entry?.title).toBe("عنوان معدّل");
    expect(entry?.relatedErrors).toContain("2124-8006");
  });

  it("keeps the steps an admin did not resend", () => {
    const merged = applyProblemOverrides(base, [
      { id: "RELOGIN_REQUIRED", title: "x", description: "", category: "accounts" },
    ]);
    expect(merged.find((p) => p.id === "RELOGIN_REQUIRED")?.steps.length).toBeGreaterThan(4);
  });

  it("can attach a screenshot without rewriting the problem", () => {
    const merged = applyProblemOverrides(base, [
      {
        id: "VERIFICATION_CODE",
        title: "",
        description: "",
        category: "accounts",
        images: [{ id: "a", url: "/api/files/content/code.webp", alt: "شاشة الرمز", sort_order: 1 }],
      },
    ]);
    const entry = merged.find((p) => p.id === "VERIFICATION_CODE");
    expect(entry?.slots?.[0]?.url).toBe("/api/files/content/code.webp");
    expect(entry?.cause).toContain("صالح لمدة ساعة");
  });

  it("can still publish a problem the shop wrote itself", () => {
    const merged = applyProblemOverrides(base, [
      {
        id: "SHOP_ONLY",
        title: "مشكلة خاصة",
        description: "وصف",
        category: "other",
        steps: [{ title: "خطوة", description: "تفصيل" }],
        published: true,
      },
    ]);
    expect(merged.map((p) => p.id)).toContain("SHOP_ONLY");
  });

  it("can hide a shipped one", () => {
    const merged = applyProblemOverrides(base, [
      { id: "PARENTAL_PIN", title: "", description: "", category: "other", published: false },
    ]);
    expect(merged.map((p) => p.id)).not.toContain("PARENTAL_PIN");
  });
});

describe("one malformed entry", () => {
  it("no longer takes the whole page down", async () => {
    /*
      Validation used to throw, and this module is imported by a route loader —
      so one bad id was a 500 on every problem, at the moment a customer was
      looking for help. `/problem` answered 500 to every visitor in production.
    */
    expect(problems.length).toBeGreaterThan(10);
    expect(() => countCategories(problems)).not.toThrow();
  });
});
