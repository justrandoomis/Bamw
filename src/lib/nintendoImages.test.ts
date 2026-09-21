import { describe, expect, it } from "vitest";

import {
  BANNER_FIELDS,
  DETAIL_COVER_FIELDS,
  FRONT_BOX_FIELDS,
  FRONT_COVER_FIELDS,
  getNintendoMedia,
  getNintendoMediaUrl,
  isUsableImageUrl,
  NINTENDO_IMAGE_PLACEHOLDER,
  resolveNintendoImage,
  resolveNintendoImageUrl,
  resolvePurchaseImage,
  SQUARE_CARD_FIELDS,
  TEXTURE_SOURCE_FIELDS,
  TRIM_FIELDS,
} from "./nintendoImages";

const COVER = "https://cdn.example/cover.jpg";
const LEGACY = "https://cdn.example/legacy.jpg";
const SQUARE = "https://cdn.example/square.jpg";
const HIRES = "https://cdn.example/hires.png";
const BANNER = "https://cdn.example/banner.jpg";
const SHOT = "https://cdn.example/screenshot.jpg";

describe("isUsableImageUrl", () => {
  it("accepts absolute, root-relative and data URLs", () => {
    expect(isUsableImageUrl(COVER)).toBe(true);
    expect(isUsableImageUrl("/img/cover.png")).toBe(true);
    expect(isUsableImageUrl("data:image/png;base64,iVBOR")).toBe(true);
  });

  it("rejects the malformed values import feeds actually produce", () => {
    for (const bad of [
      "[object Object]",
      "undefined",
      "null",
      "   ",
      "",
      "NaN",
      "#",
      "javascript:alert(1)",
      "cover.png",
      42,
      null,
      undefined,
      { url: COVER },
      [COVER],
    ]) {
      expect(isUsableImageUrl(bad)).toBe(false);
    }
  });
});

describe("resolveNintendoImage — front cover", () => {
  it("prefers the canonical cartridge image", () => {
    const hit = resolveNintendoImage(
      { cartridgeImage: COVER, coverImage: LEGACY, image: LEGACY },
      "front-cover",
    );
    expect(hit.url).toBe(COVER);
    expect(hit.source).toBe("cartridgeImage");
    expect(hit.isPlaceholder).toBe(false);
  });

  it("falls back through the legacy cover carriers in a fixed order", () => {
    expect(resolveNintendoImageUrl({ coverImage: LEGACY }, "front-cover")).toBe(LEGACY);
    expect(resolveNintendoImageUrl({ coverUrl: LEGACY }, "front-cover")).toBe(LEGACY);
    expect(resolveNintendoImageUrl({ box_front_url: LEGACY }, "front-cover")).toBe(LEGACY);
    expect(resolveNintendoImageUrl({ image: LEGACY }, "front-cover")).toBe(LEGACY);
  });

  it("never promotes a banner or a screenshot into a cover slot", () => {
    const product = {
      bannerImage: BANNER,
      banner: BANNER,
      galleryImages: [{ url: SHOT }],
      gallery: [SHOT],
      images: [SHOT],
    };
    const hit = resolveNintendoImage(product, "front-cover");
    expect(hit.url).toBe(NINTENDO_IMAGE_PLACEHOLDER);
    expect(hit.isPlaceholder).toBe(true);
  });

  it("skips malformed values and keeps looking", () => {
    const hit = resolveNintendoImage(
      { cartridgeImage: "[object Object]", coverImage: "   ", image: COVER },
      "front-cover",
    );
    expect(hit.url).toBe(COVER);
    expect(hit.source).toBe("image");
  });

  it("returns the placeholder for a product with no artwork at all", () => {
    expect(resolveNintendoImage({ id: "x" }, "front-cover").url).toBe(NINTENDO_IMAGE_PLACEHOLDER);
    expect(resolveNintendoImage(null).url).toBe(NINTENDO_IMAGE_PLACEHOLDER);
    expect(resolveNintendoImage(undefined).url).toBe(NINTENDO_IMAGE_PLACEHOLDER);
  });

  it("carries a stored crop rectangle along with the cover", () => {
    const trim = { left: 0.2, top: 0.1, width: 0.6, height: 0.8 };
    const hit = resolveNintendoImage({ cartridgeImage: COVER, cartridgeImageTrim: trim });
    expect(hit.trim).toEqual(trim);
  });

  it("does not attach a crop belonging to a field it did not choose", () => {
    const hit = resolveNintendoImage({
      image: COVER,
      cartridgeImageTrim: { left: 0.2, top: 0.1, width: 0.6, height: 0.8 },
    });
    expect(hit.source).toBe("image");
    expect(hit.trim).toBeUndefined();
  });
});

describe("resolveNintendoImage — square card", () => {
  it("uses the dedicated square asset when one exists", () => {
    const hit = resolveNintendoImage(
      { nintendoCardImage: SQUARE, cartridgeImage: COVER },
      "square-card",
    );
    expect(hit.url).toBe(SQUARE);
    expect(hit.source).toBe("nintendoCardImage");
  });

  it("shows the placeholder rather than borrowing the front box cover", () => {
    // The home strip's window is cut for square art. A vertical packshot
    // dropped into it reads as a rendering fault, so a missing square asset
    // stays visibly missing.
    expect(
      getNintendoMediaUrl({ cartridgeImage: COVER, bannerImage: BANNER }, "square-card"),
    ).toBe(NINTENDO_IMAGE_PLACEHOLDER);
    expect(getNintendoMediaUrl({ bannerImage: BANNER }, "square-card")).toBe(
      NINTENDO_IMAGE_PLACEHOLDER,
    );
  });

  it("does not let the square asset stand in for a front cover", () => {
    expect(resolveNintendoImageUrl({ nintendoCardImage: SQUARE }, "front-cover")).toBe(
      NINTENDO_IMAGE_PLACEHOLDER,
    );
    expect(getNintendoMediaUrl({ nintendoCardImage: SQUARE }, "front-box")).toBe(
      NINTENDO_IMAGE_PLACEHOLDER,
    );
  });
});

describe("resolveNintendoImage — 3D texture", () => {
  it("prefers the print-resolution source over the listing cover", () => {
    const hit = resolveNintendoImage(
      { coverHiResImage: HIRES, cartridgeImage: COVER },
      "3d-texture",
    );
    expect(hit.url).toBe(HIRES);
  });

  it("returns nothing when no wrap exists, rather than a front cover", () => {
    // The sleeve's UVs span back + spine + front. Front-only art mapped onto
    // them paints the cover across all three panels, so the viewer composes a
    // wrap explicitly instead of the resolver substituting one here.
    const hit = getNintendoMedia({ cartridgeImage: COVER }, "3d-texture");
    expect(hit.url).toBe("");
    expect(hit.isPlaceholder).toBe(true);
  });

  it("never uses a gallery frame or a square card as a texture", () => {
    expect(getNintendoMediaUrl({ galleryImages: [{ url: SHOT }] }, "3d-texture")).toBe("");
    expect(getNintendoMediaUrl({ nintendoCardImage: SQUARE }, "3d-texture")).toBe("");
  });
});

describe("resolveNintendoImage — banner", () => {
  it("reads banner fields and nothing else", () => {
    expect(resolveNintendoImageUrl({ bannerImage: BANNER, cartridgeImage: COVER }, "banner")).toBe(
      BANNER,
    );
    // A screenshot is not key art. Promoting one into a promotional slot is the
    // same class of substitution as promoting a banner into a cover slot.
    expect(resolveNintendoImageUrl({ galleryImages: [{ url: SHOT }] }, "banner")).toBe(
      NINTENDO_IMAGE_PLACEHOLDER,
    );
    // The gallery role still reads it, because that is what the gallery is.
    expect(getNintendoMediaUrl({ galleryImages: [{ url: SHOT }] }, "gallery")).toBe(SHOT);
  });

  it("never falls back to a cover", () => {
    expect(resolveNintendoImageUrl({ cartridgeImage: COVER }, "banner")).toBe(
      NINTENDO_IMAGE_PLACEHOLDER,
    );
  });
});

describe("purchase surfaces agree", () => {
  it("gives the cart, the bundle card and the toast the same picture", () => {
    const product = {
      cartridgeImage: COVER,
      nintendoCardImage: SQUARE,
      bannerImage: BANNER,
      galleryImages: [{ url: SHOT }],
    };
    const urls = new Set(
      (["cart", "toast", "bundle-card", "listing-card", "front-cover"] as const).map(
        (usage) => resolveNintendoImage(product, usage).url,
      ),
    );
    expect([...urls]).toEqual([COVER]);
    expect(resolvePurchaseImage(product).url).toBe(COVER);
  });

  it("agrees on the placeholder too, rather than each surface guessing", () => {
    const product = { bannerImage: BANNER };
    expect(resolvePurchaseImage(product).url).toBe(NINTENDO_IMAGE_PLACEHOLDER);
    expect(resolveNintendoImageUrl(product, "toast")).toBe(NINTENDO_IMAGE_PLACEHOLDER);
  });
});

describe("backwards compatibility", () => {
  it("renders a pre-migration product that only has `image`", () => {
    const hit = resolveNintendoImage({ id: "old", image: LEGACY });
    expect(hit.url).toBe(LEGACY);
    expect(hit.isPlaceholder).toBe(false);
  });

  it("renders a pre-migration product that only has `coverImage`", () => {
    expect(resolveNintendoImageUrl({ id: "old", coverImage: LEGACY })).toBe(LEGACY);
  });

  it("picks no artwork by title — there are no per-game special cases", () => {
    for (const title of ["Super Mario Odyssey", "Mario Kart 8 Deluxe", "Cyberpunk 2077"]) {
      expect(resolveNintendoImage({ title, titleEn: title }).url).toBe(NINTENDO_IMAGE_PLACEHOLDER);
    }
  });
});

describe("field taxonomy", () => {
  it("keeps the cover, square and banner field sets disjoint", () => {
    const banner = ["bannerImage", "banner", "keyArtUrl", "regionBanner"];
    for (const field of FRONT_COVER_FIELDS) {
      expect(SQUARE_CARD_FIELDS as readonly string[]).not.toContain(field);
      expect(banner).not.toContain(field);
    }
    for (const field of SQUARE_CARD_FIELDS) {
      expect(banner).not.toContain(field);
    }
  });

  it("names a distinct trim column for each field that can carry one", () => {
    const columns = Object.values(TRIM_FIELDS);
    expect(new Set(columns).size).toBe(columns.length);
    for (const [field, column] of Object.entries(TRIM_FIELDS)) {
      expect(column).not.toBe(field);
      expect(column.endsWith("Trim")).toBe(true);
    }
  });

  it("only claims a trim column for a field the resolver can actually pick", () => {
    const known = new Set<string>([...FRONT_COVER_FIELDS, ...SQUARE_CARD_FIELDS]);
    for (const field of Object.keys(TRIM_FIELDS)) {
      expect(known.has(field), `${field} has a trim column but is never resolved`).toBe(true);
    }
  });
});

describe("semantic roles do not borrow from each other", () => {
  /**
   * The bug this file exists to prevent: one product legitimately showing a
   * different *kind* of picture depending on which surface asked. Every role is
   * given only the other roles' artwork and must answer "nothing here".
   */
  const ROLE_FIELD: Record<string, string> = {
    "square-card": "nintendoCardImage",
    "front-box": "cartridgeImage",
    "detail-cover": "coverImage",
    "3d-texture": "coverHiResImage",
    banner: "bannerImage",
  };
  const URL_FOR: Record<string, string> = {
    "square-card": SQUARE,
    "front-box": COVER,
    "detail-cover": "https://cdn.example/detail.jpg",
    "3d-texture": HIRES,
    banner: BANNER,
  };
  const ROLES = Object.keys(ROLE_FIELD) as (keyof typeof ROLE_FIELD)[];

  it("each role reads only its own field", () => {
    for (const role of ROLES) {
      const product: Record<string, string> = {};
      for (const other of ROLES) {
        if (other !== role) product[ROLE_FIELD[other]!] = URL_FOR[other]!;
      }
      const hit = getNintendoMedia(product, role as never);
      expect(hit.isPlaceholder, `${role} borrowed ${hit.source}`).toBe(true);
    }
  });

  it("each role finds its own field when it is the only one present", () => {
    for (const role of ROLES) {
      const product = { [ROLE_FIELD[role]!]: URL_FOR[role]! };
      const hit = getNintendoMedia(product, role as never);
      expect(hit.url, `${role} missed its own field`).toBe(URL_FOR[role]);
      expect(hit.isPlaceholder).toBe(false);
    }
  });

  it("keeps every role's field set disjoint from every other's", () => {
    const sets: Record<string, readonly string[]> = {
      square: SQUARE_CARD_FIELDS,
      front: FRONT_BOX_FIELDS,
      detail: DETAIL_COVER_FIELDS,
      texture: TEXTURE_SOURCE_FIELDS,
      banner: BANNER_FIELDS,
    };
    const names = Object.keys(sets);
    for (const a of names) {
      for (const b of names) {
        if (a === b) continue;
        for (const field of sets[a]!) {
          expect(sets[b], `${field} is in both ${a} and ${b}`).not.toContain(field);
        }
      }
    }
  });
});

describe("the storefront surfaces named in the media contract", () => {
  // One product with every semantic field populated, so a surface that reads
  // the wrong one is caught by the value it returns rather than by absence.
  const game = {
    slug: "super-mario-odyssey",
    nintendoCardImage: SQUARE,
    cartridgeImage: COVER,
    coverImage: "https://cdn.example/detail.jpg",
    coverHiResImage: HIRES,
    bannerImage: BANNER,
    galleryImages: [{ url: SHOT }],
  };

  it("home 'ألعاب نينتندو سويتش' shows the square card image", () => {
    expect(getNintendoMediaUrl(game, "square-card")).toBe(SQUARE);
  });

  it("a retail-box surface shows the front box cover", () => {
    expect(getNintendoMediaUrl(game, "front-box")).toBe(COVER);
  });

  it("/nintendo_games shows the square card image", () => {
    expect(getNintendoMediaUrl(game, "square-card")).toBe(SQUARE);
  });

  it("the product detail cover shows the cover image", () => {
    expect(getNintendoMediaUrl(game, "detail-cover")).toBe("https://cdn.example/detail.jpg");
  });

  it("the 3D viewer shows the 3D texture source", () => {
    expect(getNintendoMediaUrl(game, "3d-texture")).toBe(HIRES);
  });

  it("gives the same product a different picture per surface", () => {
    const urls = (["square-card", "front-box", "detail-cover", "3d-texture"] as const).map((role) =>
      getNintendoMediaUrl(game, role),
    );
    expect(new Set(urls).size).toBe(4);
  });

  it("keeps the slug untouched — media selection is not identity", () => {
    getNintendoMedia(game, "square-card");
    getNintendoMedia(game, "front-box");
    expect(game.slug).toBe("super-mario-odyssey");
  });
});

describe("products with partial media", () => {
  it("a game missing its square card still shows its box on the catalogue", () => {
    const p = { cartridgeImage: COVER };
    expect(getNintendoMediaUrl(p, "square-card")).toBe(NINTENDO_IMAGE_PLACEHOLDER);
    expect(getNintendoMediaUrl(p, "front-box")).toBe(COVER);
  });

  it("a game missing its box still shows its square art on the home strip", () => {
    const p = { nintendoCardImage: SQUARE };
    expect(getNintendoMediaUrl(p, "front-box")).toBe(NINTENDO_IMAGE_PLACEHOLDER);
    expect(getNintendoMediaUrl(p, "square-card")).toBe(SQUARE);
  });

  it("a game with only a wrap texture shows placeholders on every 2D surface", () => {
    const p = { coverHiResImage: HIRES };
    for (const role of ["square-card", "front-box", "detail-cover"] as const) {
      expect(getNintendoMediaUrl(p, role)).toBe(NINTENDO_IMAGE_PLACEHOLDER);
    }
    expect(getNintendoMediaUrl(p, "3d-texture")).toBe(HIRES);
  });

  it("skips malformed values inside a role without leaving it", () => {
    expect(getNintendoMediaUrl({ nintendoCardImage: "[object Object]", squareImage: SQUARE }, "square-card")).toBe(
      SQUARE,
    );
    expect(getNintendoMediaUrl({ nintendoCardImage: "undefined" }, "square-card")).toBe(
      NINTENDO_IMAGE_PLACEHOLDER,
    );
  });

  it("offers further URLs from the same role, never another role's", () => {
    const hit = getNintendoMedia(
      { nintendoCardImage: SQUARE, squareImage: LEGACY, cartridgeImage: COVER },
      "square-card",
    );
    expect(hit.url).toBe(SQUARE);
    expect(hit.fallbackUrls).toEqual([LEGACY]);
    expect(hit.fallbackUrls).not.toContain(COVER);
  });
});
