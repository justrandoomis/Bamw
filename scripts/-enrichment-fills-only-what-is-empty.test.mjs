/**
 * Catalogue enrichment never replaces what the shop already says.
 */
import { describe, expect, it } from "vitest";

import { planFill, planRepair } from "./lib/catalogue-enrich.mjs";

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

/*
  The one value the enrichment may write over: a picture link to a file that
  is gone. Kirby and the Forgotten Land's square card answered 404 on
  2026-11-05 and its page showed «لم يتم إضافة الصورة بعد».
*/
describe("planRepair", () => {
  const DEAD = "/api/files/products/kirby/square-card-04bf5cb6cd6e7693.webp";
  const ALIVE = "/api/files/products/kirby/front-box-1.webp";
  const isDead = (url) => url === DEAD;
  const NINTENDO_SQUARE = "https://www.nintendo.com/eu/media/images/11_square_images/kirby.jpg";

  it("replaces a picture whose stored file is gone with Nintendo's for the same role", () => {
    const live = { nintendoCardImage: DEAD, cartridgeImage: ALIVE };
    const repair = { nintendoCardImage: NINTENDO_SQUARE, cartridgeImage: "https://www.nintendo.com/eu/box.png" };
    expect(planRepair(live, repair, isDead)).toEqual({ nintendoCardImage: NINTENDO_SQUARE });
  });

  it("never touches a live picture, an empty one, a field that is not a picture, or with a non-web value", () => {
    expect(planRepair({ nintendoCardImage: ALIVE }, { nintendoCardImage: NINTENDO_SQUARE }, isDead)).toEqual({});
    // Empty is the fill's business, not the repair's.
    expect(planRepair({ nintendoCardImage: "" }, { nintendoCardImage: NINTENDO_SQUARE }, () => true)).toEqual({});
    expect(planRepair({ description: DEAD }, { description: "x" }, () => true)).toEqual({});
    expect(planRepair({ nintendoCardImage: DEAD }, { nintendoCardImage: "javascript:alert(1)" }, isDead)).toEqual({});
    expect(planRepair({ nintendoCardImage: DEAD }, { nintendoCardImage: "" }, isDead)).toEqual({});
  });

  it("writes nothing when the buckets could not be read (every link «not dead»)", () => {
    expect(planRepair({ nintendoCardImage: DEAD }, { nintendoCardImage: NINTENDO_SQUARE }, () => false)).toEqual({});
  });
});
