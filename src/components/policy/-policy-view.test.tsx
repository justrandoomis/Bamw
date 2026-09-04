// @vitest-environment node
/**
 * A policy nobody reaches protects nobody.
 *
 * The clauses that decide whether somebody keeps their game — do not delete
 * the game account user, no refund once the account has been sent, what the
 * ban warranty covers — sat nine screens down a wall of prose, under a hero
 * that took the whole first screen of a phone. "It was in the terms" is not a
 * defence when the terms were unreadable.
 *
 * Rendered on the server, because these clauses are what a dispute is settled
 * against and they have to be in the first response — for the customer, for a
 * link preview, and for the browser's own find-in-page.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PolicyView } from "./PolicyView";
import { resolvePolicy, shippedPolicySections, mergePolicySections } from "@/lib/sitePolicy";

const policy = resolvePolicy(undefined);
const html = renderToStaticMarkup(<PolicyView policy={policy} />);

describe("the clauses the shop is held to", () => {
  it("states the ban warranty, its claim steps and its exceptions", () => {
    expect(html).toContain("ضماناً مدى الحياة ضد حظر جهاز Nintendo");
    expect(html).toContain("خطوات المطالبة");
    expect(html).toContain("Forgot Password");
    expect(html).toContain("تعديل النظام");
  });

  it("says the shop carries it when the fault is the service's", () => {
    expect(html).toContain("يتحمل المتجر المسؤولية");
  });

  it("states the deletion rule and what it costs", () => {
    expect(html).toContain("يمنع حذف مستخدم حساب اللعبة");
    expect(html).toContain("تنازله عن حقه");
    // And that a deletion the shop itself asked for is not a breach.
    expect(html).toContain("يطلبه الدعم رسمياً");
  });

  it("states the refund rule in both directions", () => {
    expect(html).toContain("لا يمكن تغيير الحساب");
    expect(html).toContain("خطأ من الإدارة");
    expect(html).toContain("سجل تسليم الطلب");
  });

  it("keeps the option separate from the edition, where money is decided", () => {
    expect(html).toContain("Online لا يعني Deluxe");
  });

  it("carries the wallet, coupon, digital and privacy rules", () => {
    expect(html).toContain("غير قابل للسحب نقداً");
    expect(html).toContain("لا على مجموع السلة");
    expect(html).toContain("لا ترسله إلى مواقع فحص مجهولة");
    expect(html).toContain("لا نطلب منك كلمة مرور حسابك الشخصي");
  });

  it("claims nothing about a supplier the shop is not", () => {
    /*
      The authenticity clause takes the substance — original games, real
      warranty — and none of the seller's own identity.
    */
    for (const forbidden of ["Taobao", "淘宝", "الصين"]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
  });
});

describe("the summary", () => {
  it("gives every clause one sentence a customer will actually read", () => {
    expect(html).toContain("الملخص");
    expect(html).toContain("لا تحذف مستخدم حساب اللعبة. الحذف الذاتي يُسقط الحق ولا يُعوَّض.");
  });

  it("links each line to the clause it summarises", () => {
    expect(html).toContain('href="#warranty"');
    expect(html).toContain('href="#no-delete"');
    expect(html).toContain('href="#no-refund"');
  });

  it("never replaces the full text", () => {
    // Both are present: the sentence and the clause it points at.
    expect(html).toContain('id="no-delete"');
  });
});

describe("the anchors an order card links to", () => {
  it("are stable names rather than generated ids", () => {
    for (const anchor of [
      "authenticity",
      "warranty",
      "no-delete",
      "no-refund",
      "usage",
      "order-review",
      "wallet",
      "coupons",
      "digital",
      "privacy",
    ]) {
      expect(html, anchor).toContain(`id="${anchor}"`);
    }
  });

  it("are unique", () => {
    const anchors = policy.sections.map((section) => section.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
  });
});

describe("what the shop has already written", () => {
  it("survives a deploy that ships new clauses", () => {
    const merged = mergePolicySections(shippedPolicySections(), [
      { id: "policy_warranty", body_ar: "نص المتجر", sort_order: 2 } as never,
      { id: "store_only", title_ar: "بند خاص", body_ar: "نص", sort_order: 99 } as never,
    ]);
    expect(merged.find((s) => s.id === "policy_warranty")?.body_ar).toBe("نص المتجر");
    // The shipped title is kept where the admin sent none.
    expect(merged.find((s) => s.id === "policy_warranty")?.title_ar).toBe("ضمان الحظر");
    expect(merged.map((s) => s.id)).toContain("store_only");
    expect(merged.length).toBe(shippedPolicySections().length + 1);
  });

  it("is not lost when the store cannot be read at all", () => {
    expect(resolvePolicy(undefined).sections.length).toBeGreaterThan(5);
  });
});

describe("an empty picture slot on a clause", () => {
  it("renders nothing", () => {
    expect(html).not.toContain("<img");
  });
});
