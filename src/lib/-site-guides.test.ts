/**
 * A deploy must not look like it deleted the manual.
 *
 * `mergeContent` reads `guides` from the store whenever the key is an array
 * and falls back to the shipped defaults only when it is absent — which is
 * fine while the defaults are empty, and fatal once they are not. The first
 * time an admin saves one guide, the store holds a one-element array, and
 * every shipped guide is gone.
 *
 * The shipped file is the baseline and the store is an overlay, matched by id:
 * the pattern the troubleshooting entries already use.
 */
import { describe, expect, it } from "vitest";
import { applyGuideOverrides, guideAnchor, guideSteps, shippedGuides } from "./siteGuides";
import { filledImages } from "./content";

const guides = shippedGuides();

describe("the shipped guides", () => {
  it("cover every step of the journey the brief describes", () => {
    const ids = guides.map((guide) => guide.id);
    for (const id of [
      "login_method_1",
      "login_method_2",
      "resend_verification",
      "online_license",
      "download_game",
      "offline_play",
      "online_play",
      "option_vs_edition",
    ]) {
      expect(ids, id).toContain(id);
    }
  });

  it("keeps both sign-in methods complete", () => {
    const first = guides.find((g) => g.id === "login_method_1");
    const second = guides.find((g) => g.id === "login_method_2");
    expect(first?.steps).toHaveLength(16);
    expect(second?.steps).toHaveLength(8);
  });

  it("names the Nintendo menu items in English, so a customer can match them", () => {
    const first = guides.find((g) => g.id === "login_method_1");
    const text = JSON.stringify(first);
    for (const label of [
      "Nintendo eShop",
      "Create New User",
      "Link a Nintendo Account",
      "Other Sign-In Methods",
      "Verification code",
    ]) {
      expect(text, label).toContain(label);
    }
  });

  it("gives every step somewhere to put a picture", () => {
    for (const guide of guides) {
      for (const step of guide.steps ?? []) {
        expect((step.images ?? []).length, `${guide.id}/${step.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("labels each empty slot with what belongs in it", () => {
    for (const guide of guides) {
      for (const step of guide.steps ?? []) {
        for (const image of step.images ?? []) {
          expect(image.hint, `${guide.id}/${step.id}`).toBeTruthy();
        }
      }
    }
  });

  it("ships no picture, so nothing points at a file that does not exist", () => {
    /*
      The shop owner uploads these from the admin screen. A seeded URL would
      either 404 or hotlink somebody else's server, and both are worse than
      the nothing a customer currently sees.
    */
    for (const guide of guides) {
      for (const step of guide.steps ?? []) {
        for (const image of step.images ?? []) expect(image.url).toBe("");
      }
    }
  });

  it("warns about the things that lose an account", () => {
    const text = JSON.stringify(guides);
    expect(text).toContain("Forgot your password");
    expect(text).toContain("لا تحذف مستخدم حساب اللعبة");
    expect(text).toContain("الرمز صالح لمدة ساعة");
  });

  it("separates the account option from the game edition", () => {
    const guide = guides.find((g) => g.id === "option_vs_edition");
    const text = JSON.stringify(guide);
    expect(text).toContain("Offline Account");
    expect(text).toContain("Deluxe");
    expect(text).toContain("لا يعني Online أن الإصدار Deluxe");
  });
});

describe("an admin's edits", () => {
  it("override a shipped guide without removing the rest", () => {
    const merged = applyGuideOverrides(guides, [
      { ...guides[0]!, title_ar: "عنوان جديد" } as never,
    ]);
    expect(merged).toHaveLength(guides.length);
    expect(merged.find((g) => g.id === guides[0]!.id)?.title_ar).toBe("عنوان جديد");
  });

  it("keep the steps an admin did not resend", () => {
    const merged = applyGuideOverrides(guides, [{ id: "login_method_1", title_ar: "x" } as never]);
    expect(merged.find((g) => g.id === "login_method_1")?.steps).toHaveLength(16);
  });

  it("can add a guide of their own", () => {
    const merged = applyGuideOverrides(guides, [
      { id: "custom", slug: "custom", title_ar: "دليل", sort_order: 99, published: true } as never,
    ]);
    expect(merged.map((g) => g.id)).toContain("custom");
  });

  it("can hide one, and hiding it hides it everywhere", () => {
    const merged = applyGuideOverrides(guides, [
      { id: "offline_play", published: false } as never,
    ]);
    expect(merged.map((g) => g.id)).not.toContain("offline_play");
  });

  it("cannot be undone by the next release", () => {
    // The overlay is applied after the shipped file, every time it is read.
    const once = applyGuideOverrides(guides, [{ id: "online_license", title_ar: "ثابت" } as never]);
    const twice = applyGuideOverrides(once, [{ id: "online_license", title_ar: "ثابت" } as never]);
    expect(twice.find((g) => g.id === "online_license")?.title_ar).toBe("ثابت");
  });
});

describe("what a customer is shown", () => {
  it("sees no image element at all while a slot is empty", () => {
    const guide = guides.find((g) => g.id === "download_game")!;
    for (const step of guideSteps(guide)) expect(step.pictures).toHaveLength(0);
  });

  it("sees the picture once it is uploaded", () => {
    const filled = filledImages([
      { id: "a", url: "/api/files/content/x.webp", alt: "شاشة", sort_order: 1 },
      { id: "b", url: "", hint: "لم تُرفع بعد", alt: "", sort_order: 2 },
    ]);
    expect(filled).toHaveLength(1);
    expect(filled[0]!.url).toBe("/api/files/content/x.webp");
  });

  it("keeps a picture uploaded before slots existed", () => {
    expect(filledImages(undefined, "/api/files/content/old.webp", "قديمة")).toEqual([
      { id: "legacy", url: "/api/files/content/old.webp", alt: "قديمة", sort_order: 0 },
    ]);
  });

  it("orders the pictures the admin ordered them in", () => {
    const filled = filledImages([
      { id: "b", url: "/b.webp", alt: "", sort_order: 2 },
      { id: "a", url: "/a.webp", alt: "", sort_order: 1 },
    ]);
    expect(filled.map((i) => i.url)).toEqual(["/a.webp", "/b.webp"]);
  });
});

describe("the anchor a link points at", () => {
  it("comes from the record, not from a title an admin may rewrite", () => {
    expect(guideAnchor(guides.find((g) => g.id === "login_method_1")!)).toBe("login-method-1");
  });

  it("is unique across the manual", () => {
    const anchors = guides.map(guideAnchor);
    expect(new Set(anchors).size).toBe(anchors.length);
  });
});
