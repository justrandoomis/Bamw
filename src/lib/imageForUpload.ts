/**
 * Make a photo from a phone small enough to actually arrive.
 *
 * ## Why
 *
 * A member proving a wallet top-up photographs a receipt, and a current phone
 * hands the page an 8–15 MB, 48-megapixel JPEG — or an HEIC. The wallet modal
 * then base64-encoded the whole thing into a JSON body, which inflates it by a
 * third, and the server's body reader refuses anything over 20 MB. So a
 * perfectly ordinary receipt photo failed with "فشل رفع الصورة، يرجى المحاولة
 * مرة أخرى", and trying again did the same thing for the same reason.
 *
 * None of that size is worth anything. A receipt is read, not enlarged.
 *
 * ## What it does
 *
 * Decodes the picture with the browser's own decoder, draws it down to at most
 * {@link MAX_DIMENSION} on its long side, and re-encodes it. A 48 MP photo
 * becomes a few hundred kilobytes, which uploads in a second on a phone
 * connection instead of timing out on one.
 *
 * Re-encoding is also what makes an iPhone photo work at all. HEIC has no
 * decoder in the Worker — sharp is unavailable there and the WebAssembly
 * fallback handles only JPEG, PNG and WebP — but Safari, which is where HEIC
 * comes from, decodes it natively. Doing it here means the file that leaves
 * the device is already a format everything downstream can read.
 *
 * ## What it never does
 *
 * Fail. Every path returns a `File`: if the browser cannot decode the picture,
 * if canvas is unavailable, if the encode produces nothing or produces
 * something larger than the original, the original file is returned unchanged
 * and the server decides. A helper meant to stop uploads failing must not
 * become a new reason they fail.
 */

/** Long side, in pixels. Generous for a receipt; unremarkable for a screen. */
const MAX_DIMENSION = 2000;

/** Below this, re-encoding costs more than it saves. */
const SKIP_BELOW_BYTES = 400 * 1024;

/** Encoder quality. High enough that a printed serial number stays readable. */
const QUALITY = 0.85;

/** Formats a browser can hand back, best first. */
const OUTPUT_TYPES = ["image/webp", "image/jpeg"] as const;

/** A format the whole pipeline can already read, so there is nothing to gain. */
function isAlreadyFine(file: File): boolean {
  return (
    file.size <= SKIP_BELOW_BYTES &&
    /^image\/(jpeg|png|webp|gif)$/i.test(file.type || "")
  );
}

async function decode(file: File): Promise<{ width: number; height: number; source: CanvasImageSource } | null> {
  /*
    `createImageBitmap` is the fast path and, on Safari, the one that decodes
    HEIC. The `<img>` fallback is for browsers that lack it or refuse a
    particular file.
  */
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { width: bitmap.width, height: bitmap.height, source: bitmap };
    } catch {
      /* Fall through to the element decoder. */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode_failed"));
      el.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight, source: image };
  } catch {
    return null;
  } finally {
    /*
      Revoked after decoding either way. An object URL held for the life of the
      page is a copy of the photo kept in memory for no reason.
    */
    URL.revokeObjectURL(url);
  }
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, QUALITY);
    } catch {
      resolve(null);
    }
  });
}

/**
 * The same picture, small enough to upload — or the original, unchanged.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  try {
    if (!file || !file.type.startsWith("image/")) return file;
    /* An animation loses its animation on a canvas, so it is left alone. */
    if (/^image\/gif$/i.test(file.type)) return file;
    if (isAlreadyFine(file)) return file;
    if (typeof document === "undefined") return file;

    const decoded = await decode(file);
    if (!decoded || !decoded.width || !decoded.height) return file;

    const scale = Math.min(1, MAX_DIMENSION / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(decoded.source, 0, 0, width, height);

    for (const type of OUTPUT_TYPES) {
      const blob = await encode(canvas, type);
      /*
        `toBlob` falls back to PNG when it does not support the type asked for,
        and a PNG of a photograph is usually bigger than the JPEG it came from.
        Checking the type it actually produced, and the size, is what stops
        this making things worse.
      */
      if (!blob || blob.type !== type) continue;
      if (blob.size >= file.size && scale === 1) continue;

      const base = (file.name || "upload").replace(/\.[^./\\]+$/, "");
      const extension = type === "image/webp" ? "webp" : "jpg";
      return new File([blob], `${base}.${extension}`, { type, lastModified: Date.now() });
    }

    return file;
  } catch {
    /* The server is a better judge than a broken canvas. */
    return file;
  }
}
