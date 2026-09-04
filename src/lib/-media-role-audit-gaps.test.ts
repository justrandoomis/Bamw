/**
 * The faults the Nintendo gift card actually has, held as tests.
 *
 * Read from the production record rather than from the screenshot: one file
 * in `listingImage`, `thumbnailImage` and `frontImage` at once — and that file
 * served live from a retailer's CDN — a second retailer's URL in
 * `lifestyleImages`, an empty string counted as a banner, and a selling price
 * with its exchange rate written into the English description.
 *
 * None of it was reported by anything. The role audit knew about four Nintendo
 * roles and nothing else, so the three-way duplicate was invisible to it; and
 * every warning it did produce was discarded by every caller before anyone
 * could read it.
 */
import { describe, expect, it } from "vitest";
import { auditMediaRoles } from "./mediaRoleAudit";
import { customerSafeParagraph } from "./internalMetadata";

const codes = (product: Record<string, unknown>) => auditMediaRoles(product).map((i) => i.code);

const BESTBUY =
  "https://pisces.bbystatic.com/image2/BestBuy_US/images/products/5900/5900200_sd.jpg?format=webp";

describe("the listing trio", () => {
  it("is reported when one file fills all three", () => {
    expect(
      codes({ listingImage: BESTBUY, thumbnailImage: BESTBUY, frontImage: BESTBUY }),
    ).toContain("duplicate-listing-image");
  });

  it("is not reported when each slot has its own picture", () => {
    expect(
      codes({
        listingImage: "/api/files/products/p/a.webp",
        thumbnailImage: "/api/files/products/p/b.webp",
        frontImage: "/api/files/products/p/c.webp",
      }),
    ).not.toContain("duplicate-listing-image");
  });
});

describe("an image the shop does not own", () => {
  it("is reported, naming the host", () => {
    const issues = auditMediaRoles({ listingImage: BESTBUY });
    const foreign = issues.find((i) => i.code === "foreign-image-host");
    expect(foreign?.message).toContain("pisces.bbystatic.com");
  });

  it("is reported inside a list too", () => {
    expect(
      codes({
        lifestyleImages: ["https://c1.neweggimages.com/BizIntell/item/6.png"],
      }),
    ).toContain("foreign-image-host");
  });

  it("says nothing about our own storage", () => {
    expect(codes({ coverImage: "/api/files/products/p/cover.webp" })).not.toContain(
      "foreign-image-host",
    );
    expect(codes({ coverImage: "https://banan.to/api/files/p/cover.webp" })).not.toContain(
      "foreign-image-host",
    );
  });
});

describe("an empty slot in an image list", () => {
  it("is reported, because a counter counts it", () => {
    expect(codes({ bannerImages: [""] })).toContain("empty-image-slot");
  });

  it("is not invented for a list that is simply short", () => {
    expect(codes({ bannerImages: ["/api/files/p/b1.webp"] })).not.toContain("empty-image-slot");
  });
});

describe("a selling price written into customer copy", () => {
  it("is stripped, with the exchange rate that came with it", () => {
    const stored = [
      "Merchant pricing and fulfillment",
      "Selling price: 70,000 IQD, calculated as 50 USD × 1,400 IQD per USD. Fulfillment time: 12–72 hours.",
      "No coupon may apply to this product.",
    ].join("\n");
    const safe = customerSafeParagraph(stored) ?? "";
    expect(safe).not.toContain("70,000");
    expect(safe).not.toContain("1,400");
    /*
      The exchange rate is the shop's margin basis, and it was printed to
      every visitor. The coupon rule beside it is genuine product copy and
      stays.
    */
    expect(safe).toContain("No coupon may apply");
  });

  it("leaves a section heading with no figure in it alone", () => {
    // "سعر البيع وسياسة المتجر" — a heading, not a statement of a number.
    expect(customerSafeParagraph("سعر البيع وسياسة المتجر")).toBe("سعر البيع وسياسة المتجر");
  });
});

describe("the square card", () => {
  it("is no longer manufactured from the box cover", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const text = readFileSync(
      resolve(process.cwd(), "src/lib/productImageVerification.server.ts"),
      "utf8",
    );
    /*
      The pipeline used to copy the cover into `nintendoCardImage` and then run
      the audit that reports exactly that duplicate — producing the fault and
      filing the complaint about it in the same function.
    */
    expect(text).not.toMatch(/cloned\.nintendoCardImage\s*=\s*cloned\.(cartridgeImage|coverImage|mainImage)/);
  });
});
