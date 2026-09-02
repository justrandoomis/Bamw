import { describe, expect, it } from "vitest";

import { gameFromProduct } from "./fromProduct";

/**
 * The Arabic description had a spelling nobody read.
 *
 * The import template writes `description_ar=`, and the schema keeps it under
 * the snake_case target `description_ar`. Both `description` and
 * `description_en` target `description`. The hub only knew `descriptionAr`, so
 * it never found the Arabic text, fell through to `description`, and rendered
 * the English copy inside an Arabic page — the storefront's default locale.
 *
 * Product and studio names stay in English on purpose: those are proper nouns,
 * not UI copy.
 */

const base = {
  id: "prd_1",
  slug: "super-mario-odyssey",
  title: "سوبر ماريو أوديسي",
  titleEn: "Super Mario Odyssey",
  price: 25000,
  stock: 5,
  status: "نشط",
  isActive: true,
  categoryId: "cat_nintendo",
  platform: "switch",
  developer: "Nintendo EPD",
  publisher: "Nintendo",
};

const AR = "لعبة مغامرات ثلاثية الأبعاد تدور حول ماريو وقبعته السحرية.";
const EN = "A 3D adventure about Mario and his sentient hat.";

describe("Arabic locale prefers Arabic copy", () => {
  it("reads the spelling the import template actually writes", () => {
    const game = gameFromProduct({ ...base, description_ar: AR, description: EN }, "ar");
    expect(game.description).toBe(AR);
  });

  it("still reads the camelCase spelling older rows use", () => {
    const game = gameFromProduct({ ...base, descriptionAr: AR, description: EN }, "ar");
    expect(game.description).toBe(AR);
  });

  it("prefers descriptionAr when a row somehow carries both", () => {
    const game = gameFromProduct(
      { ...base, descriptionAr: AR, description_ar: "نسخة أخرى", description: EN },
      "ar",
    );
    expect(game.description).toBe(AR);
  });

  it("falls back to the English copy rather than showing nothing", () => {
    const game = gameFromProduct({ ...base, description: EN }, "ar");
    expect(game.description).toBe(EN);
  });

  it("reads the Arabic tagline spelling too", () => {
    const game = gameFromProduct({ ...base, tagline_ar: "قبعة، قفزة، عالم" }, "ar");
    expect(game.tagline).toBe("قبعة، قفزة، عالم");
  });
});

describe("English locale prefers English copy", () => {
  it("does not show Arabic to an English reader when both exist", () => {
    const game = gameFromProduct({ ...base, description_ar: AR, description_en: EN }, "en");
    expect(game.description).toBe(EN);
  });

  it("reads description_en, not only descriptionEn", () => {
    const game = gameFromProduct({ ...base, description_en: EN }, "en");
    expect(game.description).toBe(EN);
  });
});

describe("the title follows the reader, the studio names do not", () => {
  /*
    This used to assert the English name in both locales. That was the rule
    until "Show the stored Arabic game titles on the Arabic pages" (4f48d88):
    the catalogue carries an Arabic name for these games and an Arabic page
    that prints the English one is showing a translation nobody asked for.
    Studio and publisher names are still proper nouns and still stay English —
    the case below.
  */
  it("shows the Arabic name to an Arabic reader and the English one to an English reader", () => {
    const arabic = gameFromProduct({ ...base, description_ar: AR }, "ar");
    expect(arabic.title).toBe("سوبر ماريو أوديسي");

    const english = gameFromProduct({ ...base, description_ar: AR }, "en");
    expect(english.title).toBe("Super Mario Odyssey");
  });

  it("falls back to the English name when the game has no Arabic one", () => {
    const noArabic = gameFromProduct(
      { ...base, title: "Super Mario Odyssey", description_ar: AR },
      "ar",
    );
    expect(noArabic.title).toBe("Super Mario Odyssey");
  });

  it("keeps developer and publisher names", () => {
    const game = gameFromProduct({ ...base, description_ar: AR }, "ar");
    const studio = JSON.stringify(game);
    expect(studio).toContain("Nintendo EPD");
    expect(studio).toContain("Nintendo");
  });
});
