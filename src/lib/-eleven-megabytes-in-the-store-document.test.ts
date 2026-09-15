import { describe, expect, it } from "vitest";

import { findInlineMedia, replaceInlineMedia, INLINE_MEDIA_LIMIT } from "./inlineMedia";
import { toIndexRow } from "./product-index.server";
import { buildListing, parseCatalogueCsv } from "./catalogueImport";

/**
 * The outage, as production actually recorded it.
 *
 * Two bundles were saved with a photo pasted into `image`. `store:bundles`
 * became 10,889,492 bytes, of which 10,885,716 — a hundred percent — were those
 * two strings. `/api/admin/store` reads that section on every cold isolate, the
 * runtime ended the invocation `exceededCpu` and answered **503** with an HTML
 * error page, the catalogue import running at the time received that page
 * mid-batch, and what reached the owner was Safari's words for a broken JSON
 * document.
 *
 * Every step of that chain has a test here, because every step of it was
 * something the code allowed.
 */

/** The shape of the thing that did it, at a size a test can hold. */
const photo = `data:image/jpeg;base64,${"A".repeat(INLINE_MEDIA_LIMIT + 5000)}`;
const icon = `data:image/png;base64,${"B".repeat(64)}`;

describe("a picture pasted into the shop document", () => {
  it("is found however deep it is nested", () => {
    const bundles = [
      { id: "bnd_1", title: "بندل", image: photo, gameIds: ["a", "b"] },
      { id: "bnd_2", nested: { deeper: [{ banner: photo }] } },
    ];
    const found = findInlineMedia(bundles);
    // One entry, not two: the same picture in two places is one upload.
    expect(found).toHaveLength(1);
    expect(found[0]!.mime).toBe("image/jpeg");
    /*
      The limit bounds the *string*; `bytes` is the file it decodes to, three
      quarters of it, which is the number worth reporting to a person.
    */
    expect(found[0]!.bytes).toBeCloseTo((photo.length * 3) / 4, -3);
  });

  it("names where it was, because the admin has to be told which field", () => {
    const found = findInlineMedia({ bundles: [{ id: "bnd_1", image: photo }] });
    expect(found[0]!.path).toBe("bundles.0.image");
  });

  it("leaves a small inline image alone", () => {
    // An SVG icon or a placeholder pixel is cheap and often deliberate.
    expect(findInlineMedia({ image: icon })).toEqual([]);
  });

  it("leaves a URL alone, which is what a repaired record looks like", () => {
    expect(findInlineMedia({ image: "https://assets.banan.to/Images/Pages/x.jpg" })).toEqual([]);
  });

  it("is swapped for its address without touching anything else", () => {
    const before = {
      bundles: [{ id: "bnd_1", title: "بندل", price: 25000, image: photo, gameIds: ["a"] }],
    };
    const after = replaceInlineMedia(before, new Map([[photo, "https://assets.banan.to/x.jpg"]]));
    expect(after.bundles[0]!.image).toBe("https://assets.banan.to/x.jpg");
    expect(after.bundles[0]!.price).toBe(25000);
    expect(after.bundles[0]!.gameIds).toEqual(["a"]);
    // A copy, not the caller's object: the request body has other readers.
    expect(before.bundles[0]!.image).toBe(photo);
  });

  it("shrinks the document by the size of the picture, which is the whole point", () => {
    const before = JSON.stringify({ bundles: [{ id: "bnd_1", image: photo }] });
    const after = JSON.stringify(
      replaceInlineMedia({ bundles: [{ id: "bnd_1", image: photo }] }, new Map([[photo, "u"]])),
    );
    expect(before.length).toBeGreaterThan(INLINE_MEDIA_LIMIT);
    expect(after.length).toBeLessThan(200);
  });
});

describe("the badge that fired on all 198 catalogue listings", () => {
  const row = parseCatalogueCsv(
    [
      "English Name,Cost IQD,Chinese Name,Platform,Offline Price IQD,English Support",
      "Metroid Dread,7000,密特罗德 生存恐惧,Nintendo Switch,10250,نعم",
    ].join("\n"),
  ).rows[0]!;
  const built = buildListing(row, { categoryId: "nintendo-switch-games" });
  if (built.action === "skip") throw new Error("a new row must not be skipped");

  it("says «بانتظار التفاصيل» and stops there", () => {
    const indexed = toIndexRow(built.product);
    expect(indexed.bareListing).toBe(true);
    // Was: also true, on every one of them — a warning that means "this row
    // exists" rather than "look at this row".
    expect(indexed.performanceRequired).toBe(false);
  });

  it("asks for the performance review once the game is written up", () => {
    const written = {
      ...built.product,
      platform: "switch2",
      description:
        "لعبة مغامرات ثنائية الأبعاد من نينتندو، تدور حول ساميران في كوكب مجهول وتستغرق نحو عشر ساعات.",
      images: ["https://assets.banan.to/Images/Pages/metroid.jpg"],
    };
    const indexed = toIndexRow(written);
    expect(indexed.bareListing).toBe(false);
    expect(indexed.performanceRequired).toBe(true);
  });
});
