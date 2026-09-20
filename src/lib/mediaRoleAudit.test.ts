import { describe, expect, it } from "vitest";

import { auditMediaRoles } from "./mediaRoleAudit";

/**
 * The storefront refuses to borrow another role's image, which is correct and
 * also makes a data problem invisible: a product whose square card and box
 * cover are the same file renders without complaint until someone notices the
 * homepage strip is full of tall boxes in square windows. These warnings are
 * where that becomes visible, at save time, to someone who can fix it.
 */

const SQUARE = "https://assets.banan.to/Images/Games/mario-square.webp";
const BOX = "https://assets.banan.to/Images/Games/mario-box.webp";
const DETAIL = "https://assets.banan.to/Images/Games/mario-hero.webp";
const WRAP = "https://assets.banan.to/Images/Games/mario-wrap.webp";
const SHOT = "https://assets.banan.to/Images/Games/mario-shot-1.webp";

const codes = (product: Record<string, unknown>) => auditMediaRoles(product).map((i) => i.code);

const complete = {
  nintendoCardImage: SQUARE,
  cartridgeImage: BOX,
  coverImage: DETAIL,
  coverHiResImage: WRAP,
};

describe("a well-formed product is quiet", () => {
  it("reports nothing when every role has its own image", () => {
    expect(auditMediaRoles(complete)).toEqual([]);
  });

  it("does not complain about a missing 3D texture source", () => {
    // Optional by design: without it the page shows the box cover instead.
    const { coverHiResImage, ...withoutWrap } = complete;
    void coverHiResImage;
    expect(codes(withoutWrap)).toEqual([]);
  });

  it("never returns anything that would block a save", () => {
    const noisy = { cartridgeImage: BOX, nintendoCardImage: BOX, galleryImages: [SHOT, SHOT] };
    expect(auditMediaRoles(noisy).every((issue) => issue.severity === "warning")).toBe(true);
  });

  it("survives junk input", () => {
    expect(auditMediaRoles(null)).toEqual([]);
    expect(auditMediaRoles(undefined)).toEqual([]);
    expect(auditMediaRoles({} as Record<string, unknown>).length).toBeGreaterThan(0);
  });
});

describe("the same file in two roles", () => {
  it("names both roles", () => {
    const issues = auditMediaRoles({ ...complete, nintendoCardImage: BOX });
    const dupe = issues.find((i) => i.code === "duplicate-across-roles");
    expect(dupe).toBeDefined();
    expect(dupe!.roles).toEqual(["front-box", "square-card"]);
    expect(dupe!.message).toContain("غلاف العلبة الأمامي");
    expect(dupe!.message).toContain("صورة البطاقة المربعة");
  });

  it("sees through a resize query string", () => {
    // The same R2 object at two widths is still one image, and this is the most
    // common way the duplicate hides.
    const issues = auditMediaRoles({ ...complete, coverImage: `${BOX}?w=1200` });
    expect(issues.map((i) => i.code)).toContain("duplicate-across-roles");
  });

  it("reports every colliding pair, not just the first", () => {
    const all = auditMediaRoles({
      nintendoCardImage: BOX,
      cartridgeImage: BOX,
      coverImage: BOX,
      coverHiResImage: WRAP,
    });
    expect(all.filter((i) => i.code === "duplicate-across-roles")).toHaveLength(3);
  });
});

describe("missing roles that break a specific surface", () => {
  it("warns about a missing front box cover and says where it shows", () => {
    const { cartridgeImage, ...noBox } = complete;
    void cartridgeImage;
    const issue = auditMediaRoles(noBox).find((i) => i.code === "missing-front-box");
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("المجسم ثلاثي الأبعاد");
  });

  it("warns about a missing square card and says where it shows", () => {
    const { nintendoCardImage, ...noSquare } = complete;
    void nintendoCardImage;
    const issue = auditMediaRoles(noSquare).find((i) => i.code === "missing-square-card");
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("ألعاب نينتندو سويتش");
    expect(issue!.message).toContain("/nintendo_games");
  });
});

describe("repeated banners and gallery frames", () => {
  it("counts distinct banners, not banner slots", () => {
    const issue = auditMediaRoles({ ...complete, bannerImages: [SHOT, SHOT, DETAIL] }).find(
      (i) => i.code === "duplicate-banner",
    );
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("3");
    expect(issue!.message).toContain("2");
  });

  it("accepts distinct banners", () => {
    expect(codes({ ...complete, bannerImages: [SHOT, DETAIL] })).not.toContain("duplicate-banner");
  });

  it("flags a gallery padded with one repeated screenshot", () => {
    expect(codes({ ...complete, galleryImages: [SHOT, SHOT, SHOT] })).toContain("duplicate-gallery");
  });

  it("reads gallery rows shaped as objects", () => {
    expect(
      codes({ ...complete, galleryImages: [{ url: SHOT }, { url: SHOT }] }),
    ).toContain("duplicate-gallery");
  });

  it("flags a cover role reusing a gallery screenshot", () => {
    const issue = auditMediaRoles({ ...complete, cartridgeImage: SHOT, galleryImages: [SHOT] }).find(
      (i) => i.code === "gallery-reuses-cover",
    );
    expect(issue).toBeDefined();
    expect(issue!.roles).toEqual(["front-box"]);
  });
});
