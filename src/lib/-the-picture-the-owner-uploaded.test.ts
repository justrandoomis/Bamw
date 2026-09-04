/**
 * The picture an owner uploads is the picture the page shows.
 *
 * The gift-card editor has one artwork field. It reads
 * `coverImage || cardArtwork || mainImage` and writes **`coverImage`** — and
 * `coverImage` was the one role missing from `GALLERY_FIELD_ORDER`, the list
 * the product page's gallery is built from.
 *
 * So replacing a card's artwork wrote to a key no gallery read. The upload
 * succeeded, the record changed, the page kept showing whatever `mainImage`
 * held from the original import, and "I cannot change the main picture" was
 * literally true.
 *
 * `coverImage` is documented in `nintendoImages.ts` as "the product detail
 * page's primary cover", so it leads the gallery now.
 */
import { describe, expect, it } from "vitest";

import { GALLERY_FIELD_ORDER, productGalleryImages } from "./productImages";

const CARD = {
  id: "prd_4c4c65ffbb01489c",
  title: "Nintendo eShop Gift Card $5 — USA",
  // What the original import left behind.
  mainImage: "https://cdn.example/old-toad-card.png",
  // What the owner just uploaded through the gift-card editor.
  coverImage: "https://cdn.example/new-toad-card.png",
};

describe("a gift card whose artwork was just replaced", () => {
  it("shows the new picture first", () => {
    expect(productGalleryImages(CARD)[0]).toBe("https://cdn.example/new-toad-card.png");
  });

  it("keeps the old one in the gallery rather than dropping it", () => {
    // Replacing the lead is not the same as deleting an image the record still
    // holds; the owner removes that separately if they want it gone.
    expect(productGalleryImages(CARD)).toContain("https://cdn.example/old-toad-card.png");
  });
});

describe("a product with no cover of its own", () => {
  it("leads with mainImage, exactly as before", () => {
    const noCover = { mainImage: "https://cdn.example/main.png" };
    expect(productGalleryImages(noCover)[0]).toBe("https://cdn.example/main.png");
  });

  it("is unaffected when the two fields agree", () => {
    const same = {
      mainImage: "https://cdn.example/same.png",
      coverImage: "https://cdn.example/same.png",
    };
    // One entry, not a duplicate: the list de-duplicates by URL.
    expect(productGalleryImages(same)).toEqual(["https://cdn.example/same.png"]);
  });
});

describe("the gallery order", () => {
  it("names the detail page's primary cover", () => {
    /*
      The role existed in the FIELDS map the whole time — `cover:
      ["coverImage", "cover_image"]` — and simply was not in this list, which
      is why nothing anywhere pointed at the gap.
    */
    expect(GALLERY_FIELD_ORDER).toContain("cover");
    expect(GALLERY_FIELD_ORDER[0]).toBe("cover");
  });

  it("still contains every role it did before", () => {
    for (const role of [
      "main",
      "front",
      "back",
      "left",
      "right",
      "closeUp",
      "packagingFront",
      "packagingBack",
      "listing",
    ]) {
      expect(GALLERY_FIELD_ORDER, role).toContain(role);
    }
  });
});
