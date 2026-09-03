/**
 * An attachment sent from Telegram, made permanent.
 *
 * Telegram's own file URL carries the bot token and expires — the token is in
 * the path, so the link is both a credential and a time bomb. Putting one in a
 * customer's conversation would leak the bot and then rot. The file is
 * downloaded, checked, written to R2, and what the customer gets is the
 * shop's own permanent path.
 *
 * What is checked, and why each one:
 *
 *   - **The size Telegram declares, before downloading.** A refusal that comes
 *     after pulling 40 MB through the Worker has already cost the thing it was
 *     meant to prevent.
 *   - **The size actually received.** The declared size is a number in an
 *     update, which is to say a number somebody else controls.
 *   - **The type, sniffed from the bytes.** Not from `mime_type`, which the
 *     sender chooses, and not from the extension, which is part of a filename.
 *     A `.png` that is not a PNG is the oldest trick there is.
 */

import { sniffImageMimeType } from "./mediaIngest.server";
import { hasObject, writeBinary } from "./storage.server";

/** 10 MB. Large enough for a photograph of a receipt, small enough to refuse a video. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * What a support conversation may carry.
 *
 * Images and PDFs, and nothing that executes. The customer's browser renders
 * whatever this returns, so the list is what the browser may be handed rather
 * than what an admin might reasonably want to send.
 */
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export type AttachmentRefusal =
  | "no_file"
  | "too_large_declared"
  | "too_large_received"
  | "download_failed"
  | "unsupported_type";

export interface AttachmentResult {
  ok: boolean;
  url?: string;
  mime?: string;
  bytes?: number;
  refusal?: AttachmentRefusal;
}

/**
 * The file id and declared size of whatever this message carries, if anything.
 *
 * A photo arrives as several sizes; the last is the largest, which is the one
 * worth keeping. A document arrives once.
 */
export function attachmentOf(message: unknown): { fileId: string; declaredSize: number } | null {
  const msg = message as
    | {
        photo?: Array<{ file_id?: unknown; file_size?: unknown }>;
        document?: { file_id?: unknown; file_size?: unknown };
      }
    | undefined;

  const photo = Array.isArray(msg?.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
  const source = photo ?? msg?.document ?? null;
  const fileId = String(source?.file_id ?? "").trim();
  if (!fileId) return null;
  const declared = Number(source?.file_size);
  return { fileId, declaredSize: Number.isFinite(declared) && declared > 0 ? declared : 0 };
}

/** The PDF magic number, since `sniffImageMimeType` only knows images. */
function sniffMime(bytes: Uint8Array): string | undefined {
  const image = sniffImageMimeType(bytes);
  if (image) return image;
  if (
    bytes.length > 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "application/pdf";
  }
  return undefined;
}

/**
 * Decide on the bytes alone.
 *
 * Separated from the download so the rules can be tested without a network:
 * the interesting cases here are a type nobody declared and a size that
 * disagrees with the one that was promised.
 */
export function checkAttachment(bytes: Uint8Array): {
  ok: boolean;
  mime?: string;
  ext?: string;
  refusal?: AttachmentRefusal;
} {
  if (bytes.length > MAX_ATTACHMENT_BYTES) return { ok: false, refusal: "too_large_received" };
  const mime = sniffMime(bytes);
  const ext = mime ? ALLOWED[mime] : undefined;
  if (!mime || !ext) return { ok: false, refusal: "unsupported_type" };
  return { ok: true, mime, ext };
}

/**
 * Fetch a Telegram file and put it in R2 under the conversation it belongs to.
 *
 * `getFile` is called with the bot token and its answer is used immediately;
 * neither the token nor the temporary URL is ever returned from here, so
 * nothing upstream can put one in a message by accident.
 */
export async function storeTelegramAttachment(input: {
  fileId: string;
  declaredSize: number;
  conversationId: string;
  botToken: string;
  fetchImpl?: typeof fetch;
}): Promise<AttachmentResult> {
  const { fileId, declaredSize, conversationId, botToken } = input;
  const doFetch = input.fetchImpl ?? fetch;
  if (!fileId || !botToken) return { ok: false, refusal: "no_file" };

  /* Refused before the bytes are pulled, which is the only refusal that saves anything. */
  if (declaredSize > MAX_ATTACHMENT_BYTES) {
    return { ok: false, refusal: "too_large_declared" };
  }

  let path = "";
  try {
    const res = await doFetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
    );
    if (!res.ok) return { ok: false, refusal: "download_failed" };
    const body = (await res.json()) as { ok?: boolean; result?: { file_path?: unknown } };
    path = String(body?.result?.file_path ?? "").trim();
    if (!body?.ok || !path) return { ok: false, refusal: "download_failed" };
  } catch {
    return { ok: false, refusal: "download_failed" };
  }

  let bytes: Uint8Array;
  try {
    const res = await doFetch(`https://api.telegram.org/file/bot${botToken}/${path}`);
    if (!res.ok) return { ok: false, refusal: "download_failed" };
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return { ok: false, refusal: "download_failed" };
  }

  const check = checkAttachment(bytes);
  if (!check.ok || !check.mime || !check.ext) {
    return { ok: false, refusal: check.refusal ?? "unsupported_type" };
  }

  /*
    Hashed, so the same file sent twice is stored once, and filed under the
    conversation so an attachment cannot be found by guessing at another one.
    `chat/` is a private prefix: the objects are served `no-store` and only
    through the app's own file route.
  */
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  const hash = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  const key = `files/chat/${conversationId}/${hash}.${check.ext}`;

  if (!(await hasObject(key))) {
    await writeBinary(key, bytes, check.mime, { cacheControl: "private, no-store" });
    /* Read after write: a silent storage failure would leave a link to nothing. */
    if (!(await hasObject(key))) return { ok: false, refusal: "download_failed" };
  }

  return {
    ok: true,
    url: `/api/files/${key.slice("files/".length)}`,
    mime: check.mime,
    bytes: bytes.length,
  };
}
