/**
 * Catalogue enrichment never replaces what the shop already says.
 */
import { describe, expect, it } from "vitest";

import { planFill } from "./lib/catalogue-enrich.mjs";

describe("planFill", () => {
  it("fills empty fields and leaves written ones alone", () => {
    const live = {
      description: "وصف كتبه المالك",
      genres: [],
      publisher: "",
      cartridgeImage: "/api/files/products/x/front.webp",
      nintendoCardImage: null,
    };
    const fill = {
      description: "Survive Together!",
      genres: ["Action"],
      publisher: "Konami",
      cartridgeImage: "https://www.nintendo.com/eu/media/images/05_packshots/x.png",
      nintendoCardImage: "https://www.nintendo.com/eu/media/images/11_square_images/x.jpg",
    };
    expect(planFill(live, fill)).toEqual({
      genres: ["Action"],
      publisher: "Konami",
      nintendoCardImage: "https://www.nintendo.com/eu/media/images/11_square_images/x.jpg",
    });
  });

  it("ignores fields it is not allowed to write, prices above all", () => {
    expect(planFill({}, { price: 1, cost: 1, isHidden: true, title: "x" })).toEqual({});
  });

  it("treats a zero size as empty and a real one as written", () => {
    expect(planFill({ downloadSizeGb: 0 }, { downloadSizeGb: 2.5 })).toEqual({ downloadSizeGb: 2.5 });
    expect(planFill({ downloadSizeGb: 3 }, { downloadSizeGb: 2.5 })).toEqual({});
  });
});
