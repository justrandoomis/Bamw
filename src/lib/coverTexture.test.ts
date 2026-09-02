import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COVER_TEXTURE_FIELD,
  COVER_TEXTURE_FOLDER,
  coverTextureFetchHeaders,
  mirrorCoverTextureSource,
  needsStorageMirror,
} from "./coverTexture";
import { resolveNintendoImage, TRIM_FIELDS } from "./nintendoImages";
import { parseGameImport } from "./gameImportParser";
import { applyGameImportToForm, createBlankProductForm } from "./gameImportForm";

const WRAP =
  "https://www.thecoverproject.net/uploads/pending/nintendo_switch_2.hyrulewarriorsageofimprisonment_GB.1763104671414002517.jpg";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("which values have to be copied into storage", () => {
  it("copies an external link and leaves everything already ours alone", () => {
    expect(needsStorageMirror(WRAP)).toBe(true);
    expect(needsStorageMirror("http://example.com/wrap.jpg")).toBe(true);

    expect(needsStorageMirror("/api/files/cartridges/usr_1/f_abc.jpg")).toBe(false);
    expect(needsStorageMirror("data:image/png;base64,AAAA")).toBe(false);
    expect(needsStorageMirror("")).toBe(false);
    expect(needsStorageMirror(undefined)).toBe(false);
    expect(needsStorageMirror("not a url")).toBe(false);
  });
});

describe("download headers for this field only", () => {
  it("always looks like an ordinary browser image request", () => {
    const headers = coverTextureFetchHeaders("https://example.com/wrap.jpg");
    expect(headers["User-Agent"]).toMatch(/Mozilla\/5\.0/);
    expect(headers["Accept"]).toBe(
      "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    );
    expect(headers["Accept-Language"]).toBe("en-US,en;q=0.9");
  });

  it("sends a Referer to The Cover Project and to nobody else", () => {
    expect(coverTextureFetchHeaders(WRAP)["Referer"]).toBe("https://www.thecoverproject.net/");
    expect(coverTextureFetchHeaders("https://thecoverproject.net/x.jpg")["Referer"]).toBe(
      "https://www.thecoverproject.net/",
    );
    expect(coverTextureFetchHeaders("https://example.com/wrap.jpg")["Referer"]).toBeUndefined();
    // A look-alike host must not collect our referer.
    expect(
      coverTextureFetchHeaders("https://thecoverproject.net.evil.test/x.jpg")["Referer"],
    ).toBeUndefined();
  });
});

describe("copying the wrap into the existing storage", () => {
  it("posts the source to the upload endpoint and returns the stored URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ url: "/api/files/cartridges/usr_1/f_stored.jpg" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await mirrorCoverTextureSource(WRAP);
    expect(result).toEqual({ ok: true, url: "/api/files/cartridges/usr_1/f_stored.jpg" });

    // The existing endpoint and the existing folder — no new storage path.
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/upload");
    expect(JSON.parse(init.body)).toEqual({ sourceUrl: WRAP, folder: COVER_TEXTURE_FOLDER });
    expect(COVER_TEXTURE_FOLDER).toBe("cartridges");
  });

  it("reports a refusing source instead of returning a URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "remote_status_403" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const result = await mirrorCoverTextureSource(WRAP);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("remote_status_403");
  });

  it("reports a network failure rather than throwing into the import", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await mirrorCoverTextureSource(WRAP);
    expect(result.ok).toBe(false);
  });
});

describe("the field keeps its meaning: full case wrap, uncropped", () => {
  it("imports the wrap URL into the 3D texture field and nowhere else", () => {
    const parsed = parseGameImport(`
schema_version=1
name=Hyrule Warriors Age of Imprisonment
platform=switch1
device_performance.1.device=Nintendo Switch
device_performance.1.information_status=not_published
device_performance.1.unavailable_reason=Nintendo has not published performance figures.
device_performance.1.source_name=Nintendo eShop
device_performance.1.verification_status=checked
cover_texture_url=${WRAP}
`);
    expect(parsed.errors.filter((issue) => issue.severity === "error")).toEqual([]);

    const form = applyGameImportToForm(createBlankProductForm("cat_nintendo"), parsed.data);
    expect(form[COVER_TEXTURE_FIELD]).toBe(WRAP);
    // The front cover is a different field and stays untouched by this import.
    expect(form["cartridgeImage"]).toBe("");
    expect(form["nintendoCardImage"]).toBe("");
  });

  it("hands the 3D sleeve the whole image, with no crop rectangle attached", () => {
    const product = {
      [COVER_TEXTURE_FIELD]: "/api/files/cartridges/usr_1/f_wrap.jpg",
      cartridgeImage: "/api/files/cartridges/usr_1/f_front.jpg",
      cartridgeImageTrim: { top: 1, left: 1, right: 1, bottom: 1 },
    };
    const texture = resolveNintendoImage(product, "3d-texture");

    expect(texture.url).toBe("/api/files/cartridges/usr_1/f_wrap.jpg");
    expect(texture.isPlaceholder).toBe(false);
    // No trim field maps to the wrap, so nothing can crop it down to the front.
    expect(texture.trim).toBeUndefined();
    expect(TRIM_FIELDS[COVER_TEXTURE_FIELD]).toBeUndefined();
  });

  it("does not quietly hand the sleeve a front cover when no wrap exists", () => {
    // The sleeve's UVs span back + spine + front. A front-only cover mapped
    // straight onto them paints the same artwork across all three panels, so
    // the resolver reports "no wrap" and the viewer (CaseStageWebGL) decides
    // out loud whether to compose one from the front box cover.
    const texture = resolveNintendoImage(
      { cartridgeImage: "/api/files/cartridges/usr_1/f_front.jpg" },
      "3d-texture",
    );
    expect(texture.isPlaceholder).toBe(true);
    expect(texture.source).toBe("placeholder");
  });
});
