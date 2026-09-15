/**
 * Pictures stored as text inside the shop's own document.
 *
 * A `data:` URI is the image itself, base64, and base64 is a third larger than
 * the file. Put one in a record and it stops being a reference to a picture and
 * becomes the picture — carried by every read of the section it lives in,
 * parsed by every isolate that serves a request, and counted against a Worker's
 * CPU budget every single time.
 *
 * This is not hypothetical. Two bundles in this shop were saved with a photo
 * pasted straight into `image`, and `store:bundles` became **10.9 MB** — of
 * which 10,885,716 bytes, a hundred percent, were those two strings. Everything
 * that read the store then had to parse them: the every-minute cron, the
 * storefront, and `/api/admin/store`, which the runtime killed with
 * `exceededCpu` and answered **503**. The admin page said «تعذر قراءة إعدادات
 * المتجر», the catalogue import got that 503 mid-run, and the error the owner
 * finally saw was Safari's complaint about parsing an HTML page as JSON.
 *
 * So: find them, and put them where images go.
 *
 * Deliberately pure — no R2, no bindings, no network. `inlineMedia.server.ts`
 * does the uploading; this half is walked over in tests without either.
 */

/**
 * The most a stored `data:` URI may be.
 *
 * Small enough that a real photo can never pass — the smallest of the two that
 * broke production was 5.3 MB — and large enough that an inline SVG icon or a
 * one-pixel placeholder, which are cheap and often deliberate, still can.
 */
export const INLINE_MEDIA_LIMIT = 64 * 1024;

export interface InlineMedia {
  /** The full `data:` URI, exactly as stored. */
  dataUrl: string;
  /** Its media type, e.g. `image/jpeg`. */
  mime: string;
  /** How many bytes the decoded file is, near enough to report. */
  bytes: number;
  /** Where it was found, for a message an admin can act on. */
  path: string;
}

const DATA_URL = /^data:([\w/+.-]+);base64,/;

function describe(path: (string | number)[]): string {
  return path.length ? path.join(".") : "(root)";
}

/**
 * Every oversized `data:` URI in a value, wherever it is nested.
 *
 * Keyed by the URI itself on the way out, so the same picture pasted into two
 * bundles is one upload and one stored URL rather than two of each.
 */
export function findInlineMedia(value: unknown, limit = INLINE_MEDIA_LIMIT): InlineMedia[] {
  const found = new Map<string, InlineMedia>();

  const walk = (node: unknown, path: (string | number)[]): void => {
    if (typeof node === "string") {
      if (node.length <= limit) return;
      const match = DATA_URL.exec(node);
      if (!match) return;
      if (!found.has(node)) {
        found.set(node, {
          dataUrl: node,
          mime: match[1]!,
          // base64 carries three bytes in four characters, give or take padding.
          bytes: Math.floor(((node.length - match[0].length) * 3) / 4),
          path: describe(path),
        });
      }
      return;
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], [...path, i]);
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        walk(child, [...path, key]);
      }
    }
  };

  walk(value, []);
  return [...found.values()];
}

/**
 * The same value with each named `data:` URI swapped for its stored URL.
 *
 * A copy: the caller's object is a request body that other code has already
 * read, and mutating it in place is how a retry ends up writing something
 * different from what it reported.
 */
export function replaceInlineMedia<T>(value: T, urls: ReadonlyMap<string, string>): T {
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return urls.get(node) ?? node;
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        out[key] = walk(child);
      }
      return out;
    }
    return node;
  };
  return walk(value) as T;
}

/** The decoded bytes of a `data:` URI, or undefined when it is not one. */
export function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | undefined {
  const match = /^data:([\w/+.-]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return undefined;
  try {
    const binary = atob(match[2]!);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { mime: match[1]!, bytes };
  } catch {
    return undefined;
  }
}

/**
 * A name derived from the picture rather than from the clock.
 *
 * Saving the same bundle twice must not leave two copies of its cover in the
 * bucket, and an admin who re-uploads the identical file should get the
 * identical URL — which is only true if the name comes from the bytes.
 */
export async function contentName(bytes: Uint8Array, ext: string, prefix: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 20);
  return `${prefix}-${hex}.${ext}`;
}
