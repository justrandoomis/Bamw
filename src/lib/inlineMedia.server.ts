/**
 * Moving a pasted picture out of the shop document and into the bucket.
 *
 * See `inlineMedia.ts` for why this exists at all. This half does the part that
 * needs R2, and it is written to fail loudly: an upload that cannot be proved
 * to have happened throws, so the caller refuses the save rather than replacing
 * a picture with a URL to nothing.
 */

import {
  ALLOWED_PUBLIC_MIMES,
  getPublicBucket,
  uploadPublicAsset,
} from "./public-assets.server";
import {
  contentName,
  decodeDataUrl,
  findInlineMedia,
  replaceInlineMedia,
  INLINE_MEDIA_LIMIT,
} from "./inlineMedia";

export class InlineMediaError extends Error {
  /** Arabic, because it is shown to the admin who pressed save. */
  readonly arabic: string;
  constructor(arabic: string, detail: string) {
    super(detail);
    this.name = "InlineMediaError";
    this.arabic = arabic;
  }
}

export interface OffloadResult<T> {
  value: T;
  /** How many distinct pictures were moved, and how many bytes they were. */
  moved: number;
  bytes: number;
}

/**
 * Replaces every oversized `data:` URI in `value` with a URL to the bucket.
 *
 * Returns the value unchanged when there are none, which is the usual case and
 * costs one walk of the object.
 *
 * Throws `InlineMediaError` rather than storing the picture when it cannot be
 * moved: an unsupported format, a corrupt string, or no bucket to write to. A
 * save refused with a reason is recoverable; a save that quietly writes eleven
 * megabytes into the document every request reads is what took the shop down.
 */
export async function offloadInlineMedia<T>(
  value: T,
  folder: string,
  prefix: string,
  limit = INLINE_MEDIA_LIMIT,
): Promise<OffloadResult<T>> {
  const found = findInlineMedia(value, limit);
  if (found.length === 0) return { value, moved: 0, bytes: 0 };

  if (!getPublicBucket()) {
    /*
      `uploadPublicAsset` returns a URL whether or not a bucket answered, which
      is fine for a caller that only wants the address. Here it is not: without
      this check the picture would be replaced by a link to an object nobody
      ever wrote.
    */
    throw new InlineMediaError(
      "تعذّر رفع الصورة إلى المخزن، فلم يُحفَظ التعديل. حاول مرة أخرى.",
      "public_bucket_unavailable",
    );
  }

  const urls = new Map<string, string>();
  let bytes = 0;
  for (const media of found) {
    const ext = ALLOWED_PUBLIC_MIMES[media.mime];
    if (!ext) {
      throw new InlineMediaError(
        `صيغة الصورة (${media.mime}) غير مدعومة في «${media.path}». استخدم JPG أو PNG أو WebP.`,
        `unsupported_inline_mime:${media.mime}`,
      );
    }
    const decoded = decodeDataUrl(media.dataUrl);
    if (!decoded) {
      throw new InlineMediaError(
        `تعذّرت قراءة الصورة في «${media.path}».`,
        `undecodable_inline_media:${media.path}`,
      );
    }
    try {
      const uploaded = await uploadPublicAsset({
        folder,
        bytes: decoded.bytes,
        mime: decoded.mime,
        customFilename: await contentName(decoded.bytes, ext, prefix),
      });
      urls.set(media.dataUrl, uploaded.url);
      bytes += media.bytes;
    } catch (err) {
      throw new InlineMediaError(
        `تعذّر رفع الصورة في «${media.path}» إلى المخزن، فلم يُحفَظ التعديل.`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return { value: replaceInlineMedia(value, urls), moved: urls.size, bytes };
}
