/**
 * Telling an AVIF, a HEIC, an MP4 and a QuickTime clip apart.
 *
 * All four are ISO base-media files and all four begin `....ftyp`. The upload
 * route tested only for that box, so every one of them matched whichever
 * candidate it happened to try first — which was AVIF. Two things followed:
 *
 *   - An iPhone HEIC handed over with no MIME type (iOS «الملفات» does that)
 *     was called `image/avif`, sent to a converter that cannot read it, and
 *     refused with `unsupported_image_format` after the whole photo had been
 *     uploaded.
 *   - A video handed over the same way was called an *image*, pushed into the
 *     image path, and refused as an unsupported image — a clip the file picker
 *     had just offered the member.
 *
 * The four characters after `ftyp` are the brand, and the brand is what says
 * which of the four this actually is.
 */

/** HEIF's image brands. `mif1`/`msf1` are the generic still and sequence. */
const HEIF_BRANDS = ["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"];

/**
 * The type of an ISO base-media file, or undefined if it is not one.
 *
 * An unrecognised brand is reported as `video/mp4`: an unknown container is
 * far likelier to be a clip than a still, and the video path stores the file
 * untouched rather than handing it to a decoder that will fail.
 */
export function isoBrandMime(bytes: Uint8Array): string | undefined {
  if (bytes.length < 12) return undefined;
  const decoder = new TextDecoder();
  if (decoder.decode(bytes.slice(4, 8)) !== "ftyp") return undefined;
  const brand = decoder.decode(bytes.slice(8, 12)).toLowerCase();
  if (brand === "avif" || brand === "avis") return "image/avif";
  if (HEIF_BRANDS.includes(brand)) return "image/heic";
  if (brand.startsWith("qt")) return "video/quicktime";
  return "video/mp4";
}

/** The types this file answers for, so a caller knows when to ask it. */
export const ISO_BMFF_MIMES = new Set([
  "image/avif",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
]);
