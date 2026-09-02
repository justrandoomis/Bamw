import { describe, expect, it } from "vitest";

import { parseGameImport } from "./gameImportParser";
import { isMostlyBlank, validateImageUrlShape } from "./imageValidation";

describe("validateImageUrlShape", () => {
  it("accepts real URLs", () => {
    for (const url of [
      "https://cdn.example/cover.jpg",
      "http://cdn.example/cover.png?v=2",
      "/img/cover.webp",
      "data:image/png;base64,iVBORw0KG",
    ]) {
      expect(validateImageUrlShape(url)).toEqual({ ok: true, value: url });
    }
  });

  it("trims surrounding whitespace", () => {
    expect(validateImageUrlShape("  https://cdn.example/a.jpg  ").value).toBe(
      "https://cdn.example/a.jpg",
    );
  });

  it("rejects the values a broken feed actually produces", () => {
    const bad = ["[object Object]", "undefined", "null", "   ", "", "NaN", "#"];
    for (const value of bad) {
      const result = validateImageUrlShape(value);
      expect(result.ok, `expected ${JSON.stringify(value)} to be rejected`).toBe(false);
      expect(result.issue?.severity).toBe("warning");
    }
  });

  it("rejects a nested object rather than stringifying it", () => {
    const result = validateImageUrlShape({ url: "https://cdn.example/a.jpg" });
    expect(result.ok).toBe(false);
    expect(result.issue?.code).toBe("malformed");
  });

  it("rejects javascript: URLs", () => {
    expect(validateImageUrlShape("javascript:alert(1)").ok).toBe(false);
  });
});

describe("isMostlyBlank", () => {
  const fill = (n: number, colour: [number, number, number]) => {
    const data = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      data[i * 4] = colour[0];
      data[i * 4 + 1] = colour[1];
      data[i * 4 + 2] = colour[2];
      data[i * 4 + 3] = 255;
    }
    return data;
  };

  it("flags a solid plate", () => {
    expect(isMostlyBlank(fill(1000, [253, 253, 253]))).toBe(true);
  });

  it("does not flag artwork", () => {
    const data = fill(1000, [255, 255, 255]);
    for (let i = 0; i < 400; i++) {
      data[i * 4] = (i * 7) % 255;
      data[i * 4 + 1] = (i * 13) % 255;
      data[i * 4 + 2] = (i * 3) % 255;
    }
    expect(isMostlyBlank(data)).toBe(false);
  });
});

describe("import parser image handling", () => {
  /* A complete header: a game must carry a performance record for its own
   platform, so a fixture without one is invalid for a reason that has
   nothing to do with images. */
  const base =
    "schema_version=1\nname=Test Game\nplatform=switch1\n" +
    "device_performance.1.device=Nintendo Switch\ndevice_performance.1.information_status=not_published\ndevice_performance.1.unavailable_reason=Nintendo has not published performance figures.\ndevice_performance.1.source_name=Nintendo eShop\ndevice_performance.1.verification_status=checked\n";

  it("keeps a valid front cover under either key name", () => {
    const a = parseGameImport(`${base}front_cover_image=https://cdn.example/front.jpg\n`);
    expect(a.data["cartridgeImage"]).toBe("https://cdn.example/front.jpg");

    const b = parseGameImport(`${base}cartridge_image=https://cdn.example/front.jpg\n`);
    expect(b.data["cartridgeImage"]).toBe("https://cdn.example/front.jpg");
  });

  it("maps the new square card key to its own field", () => {
    const result = parseGameImport(`${base}nintendo_card_image=https://cdn.example/square.jpg\n`);
    expect(result.data["nintendoCardImage"]).toBe("https://cdn.example/square.jpg");
    // and never onto the cover
    expect(result.data["cartridgeImage"]).toBeUndefined();
  });

  it("maps the hi-res key to the 3D texture field", () => {
    const result = parseGameImport(`${base}front_cover_hires_url=https://cdn.example/hi.png\n`);
    expect(result.data["coverHiResImage"]).toBe("https://cdn.example/hi.png");
  });

  it("drops a malformed image value instead of storing it", () => {
    const result = parseGameImport(`${base}cartridge_image=[object Object]\n`);
    expect(result.data["cartridgeImage"]).toBeUndefined();
  });

  it("reports a malformed image as a warning, so the import still runs", () => {
    const result = parseGameImport(`${base}cartridge_image=[object Object]\n`);
    const blocking = result.errors.filter((e) => e.severity === "error");
    expect(blocking).toHaveLength(0);
    expect(result.errors.some((e) => e.severity === "warning" && e.key === "cartridge_image")).toBe(
      true,
    );
    // The rest of the record survives.
    expect(result.data["title"]).toBe("Test Game");
    expect(result.data["platform"]).toBe("switch1");
  });

  it("still accepts a bare domain path, which some feeds emit", () => {
    const result = parseGameImport(`${base}cartridge_image=cdn.example.com/art/front.png\n`);
    expect(result.data["cartridgeImage"]).toBe("cdn.example.com/art/front.png");
  });

  it("does not confuse the cover, the square card and the banner", () => {
    const result = parseGameImport(
      `${base}front_cover_image=https://cdn.example/front.jpg\n` +
        `nintendo_card_image=https://cdn.example/square.jpg\n` +
        `banner_image.1=https://cdn.example/banner.jpg\n`,
    );
    expect(result.data["cartridgeImage"]).toBe("https://cdn.example/front.jpg");
    expect(result.data["nintendoCardImage"]).toBe("https://cdn.example/square.jpg");
    expect(result.data["bannerImages"]).toEqual(["https://cdn.example/banner.jpg"]);
  });
});

describe("the four image fields are independent", () => {
  /* A complete header: a game must carry a performance record for its own
   platform, so a fixture without one is invalid for a reason that has
   nothing to do with images. */
  const base =
    "schema_version=1\nname=Test Game\nplatform=switch1\n" +
    "device_performance.1.device=Nintendo Switch\ndevice_performance.1.information_status=not_published\ndevice_performance.1.unavailable_reason=Nintendo has not published performance figures.\ndevice_performance.1.source_name=Nintendo eShop\ndevice_performance.1.verification_status=checked\n";

  /**
   * The screenshot that started this: all four image boxes in the product
   * editor showing a "?". The value was not a picture and not empty — it was a
   * string the browser could not load, handed straight to `<img src>`, so it
   * painted the broken-image glyph. `?` resolves against the current page, so
   * the browser fetched the HTML document and failed to decode it.
   */
  it("never stores a value that only looks like a URL", () => {
    for (const junk of ["?", "??", "-", "n/a", "N/A", "[object Object]", "undefined", "null"]) {
      const result = parseGameImport(`${base}front_cover_image=${junk}\n`);
      expect(result.data["cartridgeImage"], `expected ${junk} to be dropped`).toBeUndefined();
    }
  });

  it("keeps the good fields when one is broken", () => {
    const result = parseGameImport(
      `${base}front_cover_image=?\n` +
        `nintendo_card_image=https://cdn.example/square.jpg\n` +
        `front_cover_hires_url=[object Object]\n` +
        `cover_image=https://cdn.example/cover.jpg\n`,
    );
    // The two broken ones are dropped…
    expect(result.data["cartridgeImage"]).toBeUndefined();
    expect(result.data["coverHiResImage"]).toBeUndefined();
    // …and the two good ones are untouched.
    expect(result.data["nintendoCardImage"]).toBe("https://cdn.example/square.jpg");
    expect(result.data["coverImage"]).toBe("https://cdn.example/cover.jpg");
    // Nothing about it blocks the import.
    expect(result.errors.filter((e) => e.severity === "error")).toHaveLength(0);
  });

  it("warns once per broken field, naming the field", () => {
    const result = parseGameImport(
      `${base}front_cover_image=?\nfront_cover_hires_url=[object Object]\n`,
    );
    const warned = result.errors.filter((e) => e.severity === "warning").map((e) => e.key);
    expect(warned).toContain("front_cover_image");
    expect(warned).toContain("front_cover_hires_url");
  });

  it("no image field ever receives another field's value", () => {
    const result = parseGameImport(
      `${base}front_cover_image=https://cdn.example/front.jpg\n` +
        `nintendo_card_image=https://cdn.example/square.jpg\n` +
        `front_cover_hires_url=https://cdn.example/hi.png\n` +
        `cover_image=https://cdn.example/cover.jpg\n`,
    );
    expect(result.data["cartridgeImage"]).toBe("https://cdn.example/front.jpg");
    expect(result.data["nintendoCardImage"]).toBe("https://cdn.example/square.jpg");
    expect(result.data["coverHiResImage"]).toBe("https://cdn.example/hi.png");
    expect(result.data["coverImage"]).toBe("https://cdn.example/cover.jpg");
    const values = [
      result.data["cartridgeImage"],
      result.data["nintendoCardImage"],
      result.data["coverHiResImage"],
      result.data["coverImage"],
    ];
    expect(new Set(values).size).toBe(4);
  });
});
