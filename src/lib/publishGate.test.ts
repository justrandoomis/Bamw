import { describe, expect, it } from "vitest";

import { checkPublishable, isPublishing } from "./publishGate";

/**
 * The floor below which a product cannot reach a customer.
 *
 * 59 of the catalogue's products were created hidden on purpose. Hidden was the
 * only thing standing between a half-researched record and a storefront page
 * with a blank cover and no description, and nothing enforced it — `isHidden`
 * came straight off the request body. These pin what the gate refuses and, just
 * as importantly, what it deliberately lets through.
 */

const complete = {
  title: "Super Mario Odyssey",
  price: 25000,
  cost: 18000,
  coverImage: "/api/files/products/prd_1/cover-abc.webp",
  description: "انطلق مع ماريو في رحلة حول العالم لإنقاذ الأميرة بيتش، بمساعدة قبعته الحية كابي.",
};

describe("the publication floor", () => {
  it("passes a product that can answer what it is and what it costs", () => {
    expect(checkPublishable(complete)).toEqual({ ok: true, missing: [] });
  });

  it("refuses a product with no name", () => {
    expect(checkPublishable({ ...complete, title: "", titleEn: "" }).missing).toContain(
      "اسم المنتج",
    );
  });

  it("refuses a product priced at or below its cost", () => {
    // The exact fault the pricing repair existed to remove: publishing one
    // sells it at no margin.
    expect(checkPublishable({ ...complete, price: 18000 }).missing).toContain(
      "سعر بيع أعلى من التكلفة",
    );
    expect(checkPublishable({ ...complete, price: 1500, cost: 1500 }).ok).toBe(false);
  });

  it("accepts a price above cost, and a product with no cost recorded", () => {
    expect(checkPublishable({ ...complete, price: 18001 }).ok).toBe(true);
    expect(checkPublishable({ ...complete, cost: 0 }).ok).toBe(true);
  });

  it("refuses a product with no usable image", () => {
    const bare = { ...complete, coverImage: "" };
    expect(checkPublishable(bare).missing).toContain("صورة واحدة على الأقل");
    // Any of the media roles satisfies it, not the cover specifically.
    expect(checkPublishable({ ...bare, cartridgeImage: "/api/files/x/y.webp" }).ok).toBe(true);
  });

  it("does not mistake a placeholder for an image", () => {
    for (const value of ["undefined", "null", "-", "[Circular]", "n/a", "not a url"]) {
      expect(checkPublishable({ ...complete, coverImage: value }).ok, value).toBe(false);
    }
  });

  it("refuses a description too short to tell a customer anything", () => {
    expect(checkPublishable({ ...complete, description: "لعبة ممتازة" }).missing).toContain(
      "وصف لا يقل عن ٤٠ حرفاً",
    );
  });

  it("does not count markup as description length", () => {
    const markupOnly = { ...complete, description: "<p><span></span></p><div>  </div>" };
    expect(checkPublishable(markupOnly).ok).toBe(false);
  });

  it("names everything missing at once rather than one thing at a time", () => {
    expect(checkPublishable({}).missing.length).toBeGreaterThanOrEqual(4);
  });

  it("refuses a product that is not there", () => {
    expect(checkPublishable(undefined).ok).toBe(false);
  });
});

describe("when the floor applies", () => {
  it("applies to the move from hidden to visible", () => {
    expect(isPublishing({ isHidden: true }, { isHidden: false })).toBe(true);
  });

  it("does not re-gate a product that was already visible", () => {
    // Otherwise a legacy record becomes uneditable until someone fills in
    // fields the edit had nothing to do with.
    expect(isPublishing({ isHidden: false }, { isHidden: false })).toBe(false);
  });

  it("does not gate a save that leaves the product hidden", () => {
    expect(isPublishing({ isHidden: true }, { isHidden: true })).toBe(false);
  });

  it("does not gate creation", () => {
    expect(isPublishing(undefined, { isHidden: false })).toBe(false);
  });

  it("treats a missing flag as visible, the way the endpoint does", () => {
    // `isHidden: payload.isHidden === true` — anything that is not exactly true
    // is visible, so an absent flag on the stored record means it was visible.
    expect(isPublishing({}, { isHidden: false })).toBe(false);
  });

  it("gates the legacy hidden spellings too, now that unhide releases them", () => {
    // Many of the deliberately-hidden records carry `is_hidden` or
    // `status: "مخفي"` rather than `isHidden`. Reading only `isHidden` would
    // let exactly those products go visible without touching the floor.
    expect(isPublishing({ is_hidden: true }, { isHidden: false })).toBe(true);
    expect(isPublishing({ status: "مخفي" }, { isHidden: false })).toBe(true);
    expect(isPublishing({ visibility: "draft" }, { isHidden: false })).toBe(true);
  });

  it("does not treat undeleting as publishing — that is not the toggle's axis", () => {
    expect(isPublishing({ isDeleted: true }, { isHidden: false })).toBe(false);
  });
});
