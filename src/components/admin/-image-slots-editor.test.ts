/**
 * The admin's half of the image contract.
 *
 * The customer's half is tested where the pages render: an empty slot shows
 * nothing at all. This is the other side — the shop owner must be able to see
 * which screenshot is missing, put one there, replace it, reorder it and take
 * it away again, across fifty-six steps.
 *
 * Also guards the seeding. The guides, clauses and questions ship in this
 * repository and the store overlays them, so an editor handed only the store's
 * copy showed the owner an empty screen while the live site showed eight
 * guides — nothing to edit, and no way to reach the slots at all.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const editor = source("src/components/admin/ImageSlotsEditor.tsx");
const wrapper = source("src/components/admin/services/ContentSettingsWrapper.tsx");
const guides = source("src/components/admin/services/editors/GuidesEditor.tsx");
const policy = source("src/components/admin/services/editors/PolicyEditor.tsx");
const faq = source("src/components/admin/services/editors/FaqEditor.tsx");

describe("the slot editor", () => {
  it.each([
    ["adds a slot", "إضافة خانة صورة"],
    ["uploads into it", "<ImageUploadField"],
    ["deletes it", "حذف الخانة"],
    ["reorders it", 'aria-label="أعلى"'],
    ["carries alt text", "وصف الصورة لقارئ الشاشة"],
    ["carries a caption", "تعليق تحت الصورة"],
    ["carries the note for whoever uploads", "ما الصورة المطلوبة هنا؟"],
  ])("%s", (_name, marker) => {
    expect(editor).toContain(marker);
  });

  it("says an empty slot is invisible to the customer", () => {
    expect(editor).toContain("فارغة، لا تظهر للمستخدم");
  });

  it("presses for alt text once a picture exists", () => {
    /*
      A screenshot of a menu is the entire content of a step for somebody
      using a screen reader. Empty alt makes that step blank for them.
    */
    expect(editor).toContain("slot.url && !slot.alt.trim()");
    expect(editor).toContain("قارئ شاشة");
  });

  it("keeps sort_order contiguous, so a deletion cannot leave a gap", () => {
    expect(editor).toContain("sort_order: index + 1");
  });

  it("uploads to a folder the server accepts", () => {
    // `guides` and `pages` are both on the upload route's allowlist.
    expect(editor).toContain('folder = "guides"');
  });
});

describe("the content editor", () => {
  it("is seeded with what the page shows, not with what the store holds", () => {
    expect(wrapper).toContain("applyGuideOverrides(shippedGuides()");
    expect(wrapper).toContain("mergePolicySections(shippedPolicySections()");
    expect(wrapper).toContain("mergeFaq(shippedFaqItems()");
  });

  it("offers slots on every guide step", () => {
    expect(guides).toContain("<ImageSlotsEditor");
    expect(guides).toContain("updateStep(guide.id, step.id, { images })");
  });

  it("offers the summary line the policy page prints at the top", () => {
    expect(policy).toContain("summary_ar");
    expect(policy).toContain("ملخص القسم");
  });

  it("lets an anchor be set deliberately rather than derived", () => {
    expect(policy).toContain("تغييره يكسر الروابط القديمة");
    // Sanitised to what a URL fragment may hold.
    expect(policy).toContain('replace(/[^a-z0-9-]/gi, "")');
  });

  it("lets an answer point at the page that owns the long version", () => {
    expect(faq).toContain("more_href");
    expect(faq).toContain("رابط الشرح الكامل");
  });
});
