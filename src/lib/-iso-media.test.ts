/**
 * «بعض الصور لا تُرسل».
 *
 * AVIF, HEIC, MP4 and QuickTime all begin `....ftyp`, and the upload route
 * tested only for that box — so each of them matched the first candidate it
 * tried, which was AVIF. An iPhone photo picked through «الملفات» was called
 * an AVIF and refused; a video picked the same way was called an image, pushed
 * into the image converter, and refused as an unsupported image.
 */
import { describe, expect, it } from "vitest";

import { isoBrandMime } from "./isoMedia";

/** The first twelve bytes of an ISO base-media file with the given brand. */
function header(brand: string): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0, 0, 0, 0x18], 0);
  bytes.set(new TextEncoder().encode("ftyp"), 4);
  bytes.set(new TextEncoder().encode(brand), 8);
  return bytes;
}

describe("what an ISO base-media file actually is", () => {
  it("knows an AVIF", () => {
    expect(isoBrandMime(header("avif"))).toBe("image/avif");
    expect(isoBrandMime(header("avis"))).toBe("image/avif");
  });

  it("knows an iPhone photo, in every brand iOS writes", () => {
    for (const brand of ["heic", "heix", "heim", "heis", "hevc", "mif1", "msf1"]) {
      expect(isoBrandMime(header(brand)), brand).toBe("image/heic");
    }
  });

  it("does not call a video an image", () => {
    /*
      The fault exactly: an .mp4 or .mov with no MIME type was sniffed as
      image/avif and then refused as an unsupported image — for a file the
      picker had just offered.
    */
    expect(isoBrandMime(header("isom"))).toBe("video/mp4");
    expect(isoBrandMime(header("mp42"))).toBe("video/mp4");
    expect(isoBrandMime(header("qt  "))).toBe("video/quicktime");
  });

  it("treats an unknown container as video, not as a still", () => {
    /*
      The safer direction: the video path stores the file untouched, while the
      image path hands it to a decoder that cannot read it.
    */
    expect(isoBrandMime(header("xxxx"))).toBe("video/mp4");
  });

  it("says nothing about a file that is not one of these at all", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(isoBrandMime(png)).toBeUndefined();
    expect(isoBrandMime(new Uint8Array([0, 1, 2]))).toBeUndefined();
    expect(isoBrandMime(new Uint8Array())).toBeUndefined();
  });
});
