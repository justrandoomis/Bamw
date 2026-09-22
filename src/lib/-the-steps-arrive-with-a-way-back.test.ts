/**
 * The member gets the steps AND a button back to the method they came from.
 *
 * The admin was retyping the same fifteen steps into every order, and they got
 * shorter as the evening got longer. The owner asked for the steps to be sent
 * from the shop's own guide, with an inline button that opens that method.
 *
 * Two properties are worth holding still. The text is rendered from the guide
 * record, so what a member reads is what the shop publishes; and the button is
 * a deep link to THAT method rather than the top of a page with six on it. A
 * third matters more than either: a message that has no anchor — an older one,
 * or something the admin typed themselves — gets no button at all, never a
 * button to nowhere.
 */
import { describe, expect, it } from "vitest";

import type { GuideItem } from "./content";
import { guideMessageBody, guidePath, guideStepsText, readGuideMessage } from "./guideMessage";

const guide = (over: Partial<GuideItem> = {}): GuideItem =>
  ({
    id: "login_method_1",
    slug: "login-method-1",
    title_ar: "طريقة تسجيل الدخول الأولى",
    description_ar: "الطريقة المعتادة للحساب الأوفلاين.",
    category: "accounts",
    sort_order: 1,
    published: true,
    steps: [
      { id: "s1", title_ar: "افتح الجهاز", description_ar: "شغّل السويتش", sort_order: 1 },
      { id: "s2", title_ar: "أضف حساباً", description_ar: "من إعدادات المستخدم", sort_order: 2 },
    ],
    ...over,
  }) as GuideItem;

describe("the steps, as text a chat bubble can carry", () => {
  it("numbers the steps in their own order, not the order they were stored", () => {
    const text = guideStepsText(
      guide({
        steps: [
          { id: "b", title_ar: "ثانياً", description_ar: "ب", sort_order: 2 },
          { id: "a", title_ar: "أولاً", description_ar: "أ", sort_order: 1 },
        ],
      } as Partial<GuideItem>),
    );
    expect(text.indexOf("1. أولاً")).toBeGreaterThan(-1);
    expect(text.indexOf("1. أولاً")).toBeLessThan(text.indexOf("2. ثانياً"));
  });

  it("leads with the method's own title and description", () => {
    const text = guideStepsText(guide());
    expect(text.startsWith("طريقة تسجيل الدخول الأولى")).toBe(true);
    expect(text).toContain("الطريقة المعتادة للحساب الأوفلاين.");
  });

  it("drops a step that is entirely empty rather than sending a bare number", () => {
    const text = guideStepsText(
      guide({
        steps: [
          { id: "a", title_ar: "خطوة", description_ar: "", sort_order: 1 },
          { id: "b", title_ar: "", description_ar: "", sort_order: 2 },
        ],
      } as Partial<GuideItem>),
    );
    expect(text).toContain("1. خطوة");
    expect(text).not.toContain("2.");
  });

  it("still says something for a guide with no steps at all", () => {
    const text = guideStepsText(guide({ steps: [] } as Partial<GuideItem>));
    expect(text).toContain("طريقة تسجيل الدخول الأولى");
  });
});

describe("the button on the message", () => {
  it("deep-links to the method, not to the top of the guides page", () => {
    expect(guidePath("login-method-2")).toBe("/account_guides#login-method-2");
  });

  it("tolerates an anchor someone stored with its hash", () => {
    expect(guidePath("#login-method-2")).toBe("/account_guides#login-method-2");
  });

  it("falls back to the page itself rather than producing a broken fragment", () => {
    expect(guidePath("")).toBe("/account_guides");
    expect(guidePath("   ")).toBe("/account_guides");
  });

  it("takes the anchor from the guide's slug, which is the link contract", () => {
    const body = guideMessageBody(guide());
    expect(body.guideAnchor).toBe("login-method-1");
    expect(body.guideId).toBe("login_method_1");
    expect(body.guideTitle).toBe("طريقة تسجيل الدخول الأولى");
  });
});

describe("reading a stored message back", () => {
  it("gives the steps and a link for a message that carries a guide", () => {
    const read = readGuideMessage(guideMessageBody(guide()));
    expect(read?.href).toBe("/account_guides#login-method-1");
    expect(read?.text).toContain("1. افتح الجهاز");
  });

  it("gives NO button for an older instructions message the admin typed", () => {
    const read = readGuideMessage({ text: "افتح الجهاز ثم أضف الحساب" });
    expect(read?.text).toBe("افتح الجهاز ثم أضف الحساب");
    expect(read?.href).toBe("");
  });

  it("refuses a body that carries neither text nor an anchor", () => {
    expect(readGuideMessage({})).toBeNull();
    expect(readGuideMessage(null)).toBeNull();
    expect(readGuideMessage("not an object")).toBeNull();
    expect(readGuideMessage({ text: 42, guideAnchor: [] })).toBeNull();
  });
});

describe("the browser names a guide, it does not write one", () => {
  it("the admin route resolves the guide server-side from the published set", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const route = readFileSync(resolve(process.cwd(), "src/routes/api/admin.orders.ts"), "utf8");

    // The id is what travels; the text is built from the store's own guides.
    expect(route).toContain('const guideId = String(data.guideId ?? "").trim()');
    expect(route).toContain("applyGuideOverrides(");
    expect(route).toContain("guideMessageBody(guide)");
    // A guide that is not published cannot be sent.
    expect(route).toContain("الشرح غير موجود أو غير منشور");

    // And the control sends an id, never a rendered message.
    const button = readFileSync(
      resolve(process.cwd(), "src/components/admin/inbox/SendGuideButton.tsx"),
      "utf8",
    );
    expect(button).toContain('action: "send_instructions"');
    expect(button).toContain("guideId");
    expect(button).not.toMatch(/guideStepsText|body:\s*\{/);
  });
});
