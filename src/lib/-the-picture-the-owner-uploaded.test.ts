/**
 * The picture an owner uploads is the picture the page shows.
 *
 * The gift-card editor has one artwork control. It reads
 * `coverImage || cardArtwork || mainImage` and wrote **`coverImage` only** —
 * and the product page's gallery, built by `productGalleryImages`, leads with
 * `mainImage` and never looks at `coverImage` at all.
 *
 * So replacing a card's artwork changed the record and left the page showing
 * whatever `mainImage` held from the original import. The upload worked, the
 * screen did not, and nothing in the admin could reach the stale field.
 * "I cannot change the main picture" was literally true.
 *
 * ## Why the fix is on the writer, not the reader
 *
 * Teaching the gallery to lead with `coverImage` looks tidier and is worse: a
 * catalogue audit found some thirty games carrying a `coverImage` and no
 * `mainImage` at all, so that change would have moved the lead image on every
 * one of them — a visible change to products nobody reported a problem with.
 *
 * One control that reads two keys should write both. That touches gift cards
 * and nothing else.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { GALLERY_FIELD_ORDER, productGalleryImages } from "./productImages";

/* Block comments stripped: this file explains the keys it asserts on. */
const editor = readFileSync(
  resolve(process.cwd(), "src/components/AdminProductEditor.tsx"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

describe("the gift-card artwork control", () => {
  const control = editor.slice(
    editor.indexOf('imageType="giftcard-main"'),
    editor.indexOf('imageType="giftcard-banner"'),
  );

  it("exists in the editor", () => {
    expect(control.length).toBeGreaterThan(0);
  });

  it("writes every key it reads", () => {
    /*
      The read chain is `coverImage || cardArtwork || mainImage`. A control that
      reads three keys and writes one leaves the other two to contradict it.
    */
    expect(control).toContain('handleChange("coverImage", url)');
    expect(control).toContain('handleChange("mainImage", url)');
  });

  it("writes the key the product gallery actually leads with", () => {
    const leadRole = GALLERY_FIELD_ORDER[0];
    expect(leadRole).toBe("main");
    expect(control).toContain('handleChange("mainImage", url)');
  });
});

describe("a card whose artwork was replaced through that control", () => {
  // What the record looks like after the fix: both keys carry the new upload.
  const afterUpload = {
    id: "prd_4c4c65ffbb01489c",
    title: "Nintendo eShop Gift Card $5 — USA",
    coverImage: "https://cdn.example/new-toad-card.png",
    mainImage: "https://cdn.example/new-toad-card.png",
  };

  it("shows the new picture", () => {
    expect(productGalleryImages(afterUpload)[0]).toBe("https://cdn.example/new-toad-card.png");
  });

  it("shows it once, not twice", () => {
    // The two keys hold the same URL; the list de-duplicates.
    expect(productGalleryImages(afterUpload)).toEqual(["https://cdn.example/new-toad-card.png"]);
  });
});

describe("the record as it was before the fix", () => {
  it("is the bug, reproduced", () => {
    /*
      `coverImage` updated, `mainImage` left behind — the gallery leads with the
      stale one. This is what the owner was looking at.
    */
    const stale = {
      coverImage: "https://cdn.example/new-toad-card.png",
      mainImage: "https://cdn.example/old-toad-card.png",
    };
    expect(productGalleryImages(stale)[0]).toBe("https://cdn.example/old-toad-card.png");
  });
});

describe("every other product", () => {
  it("keeps the gallery order it had", () => {
    /*
      The reader is deliberately untouched. Some thirty games carry a
      `coverImage` and no `mainImage`; leading with `cover` would have moved
      all of their lead images.
    */
    expect(GALLERY_FIELD_ORDER).toEqual([
      "main",
      "front",
      "back",
      "left",
      "right",
      "closeUp",
      "packagingFront",
      "packagingBack",
      "listing",
    ]);
  });
});
