/**
 * "فشل في ارسال الصوره من قبل المستخدم للادمن."
 *
 * Two different failures under one sentence.
 *
 * ## The send fails
 *
 * `/api/upload` converts every image to WebP, best-effort. It fails outright
 * for HEIC and HEIF — sharp has no decoder in the Worker and the jsquash
 * fallback handles only JPEG, PNG and WebP — and when it failed the original
 * mime survived, so the file was stored as `.heic` and the endpoint answered
 * 200. The very next call, `POST /api/chat`, ran `isOwnUploadUrl`, which
 * allows only formats a browser can display, and returned `400 invalid_image`.
 *
 * The upload succeeded and the send failed, with no reason shown. That is
 * every iPhone photo picked through Files rather than the camera roll, because
 * iOS only transcodes HEIC on the way out of the latter.
 *
 * Retrying could not help: the bubble kept the local `blob:` URL created for
 * the preview, so every retry posted a handle to this tab's memory, which the
 * same guard refuses. And picking the same photo again did nothing, because
 * the file input never cleared its value.
 *
 * ## It never reaches the admin
 *
 * There was no photo primitive at all — a repo-wide search for `sendPhoto`
 * found nothing. The admin's entire view of an attachment was the string
 * "📸 [صورة / مرفق]", and even that was unreachable when the customer wrote a
 * caption, because the expression was `text || (imageUrl ? placeholder : "")`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isOwnUploadUrl } from "./uploads";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const upload = source("src/routes/api/upload.ts");
const chatView = source("src/components/ChatView.tsx");
const telegram = source("src/lib/telegram.server.ts");
const notifications = source("src/lib/telegram-notifications.server.ts");

describe("the guard that rejected the file", () => {
  it("still refuses a format a browser cannot display", () => {
    /*
      Unchanged on purpose. Widening it to accept `.heic` would have stored a
      file the admin's browser renders as a broken image — the failure moved
      rather than fixed.
    */
    expect(isOwnUploadUrl("/api/files/chat/usr_a1/photo.heic", "usr_a1")).toBe(false);
    expect(isOwnUploadUrl("/api/files/chat/usr_a1/photo.webp", "usr_a1")).toBe(true);
  });

  it("still refuses a blob URL, which is what retry used to send", () => {
    expect(isOwnUploadUrl("blob:https://banan.to/9f2c-1234", "usr_a1")).toBe(false);
  });
});

describe("the upload endpoint", () => {
  it("refuses to store what the rest of the app will reject", () => {
    expect(upload).toContain("unsupported_image_format");
    expect(upload).toContain("SERVABLE_IMAGE");
  });

  it("answers with a reason the member can act on, not a bare failure", () => {
    expect(upload).toContain("أرسلها بصيغة JPG أو PNG");
    // 415 says "this file", not "try again", which is what 500 would imply.
    expect(upload).toMatch(/status:\s*415/);
  });
});

describe("the composer", () => {
  it("adopts the stored URL, so a retry can succeed", () => {
    expect(chatView).toContain("payload: { imageUrl: url }");
  });

  it("refuses a retry that carries a blob URL instead of failing again", () => {
    expect(chatView).toContain('pendingImage.startsWith("blob:")');
  });

  it("clears the file input, so re-picking the same photo fires change", () => {
    expect(chatView).toContain('event.target.value = "";');
  });

  it("shows the server's reason rather than discarding it", () => {
    expect(chatView).toContain("failureReason");
    expect(chatView).toContain("toast.error(reason)");
  });

  it("no longer marks an unsent attachment as sent when no thread is open", () => {
    /*
      It used to render the local file, mark it "sent", and make no request at
      all — while typing text in the same state created a thread and sent.
    */
    const attach = chatView.slice(
      chatView.indexOf("const attachWithProgress"),
      chatView.indexOf("const handleSwitchToAutomatedSupport"),
    );
    /*
      The no-thread branch only. Marking the bubble sent *after* the server
      confirms is the success path and must stay.
    */
    const noThreadBranch = attach.slice(attach.indexOf("    } else {"));
    expect(noThreadBranch).not.toMatch(/status:\s*"sent"/);
    expect(noThreadBranch).not.toContain("pushLocal(");
    expect(noThreadBranch).toContain("createThread.mutateAsync");
    expect(noThreadBranch).toContain("api.sendMessage(");
  });
});

describe("the admin's Telegram", () => {
  it("has a photo primitive at all", () => {
    expect(telegram).toContain("export async function sendTelegramPhoto");
  });

  it("uploads the bytes rather than handing Telegram a URL it cannot fetch", () => {
    const fn = telegram.slice(
      telegram.indexOf("export async function sendTelegramPhoto"),
      telegram.indexOf("/** Bot identity"),
    );
    expect(fn).toContain("FormData");
    expect(fn).toContain('form.append(\n    "photo"');
  });

  it("keeps the caption inside Telegram's limit instead of losing the send", () => {
    const fn = telegram.slice(
      telegram.indexOf("export async function sendTelegramPhoto"),
      telegram.indexOf("/** Bot identity"),
    );
    expect(fn).toContain("slice(0, 1024)");
  });

  it("forwards a customer's attachment after the card, never instead of it", () => {
    expect(notifications).toContain("forwardAttachmentToAdmin(");
    const call = notifications.indexOf("forwardAttachmentToAdmin(sent.chatId");
    const card = notifications.indexOf('sendAdminNotification("support", messageText');
    expect(card).toBeLessThan(call);
    expect(notifications).toContain("if (sent.ok && message.imageUrl)");
  });

  it("says an attachment arrived even when it came with a caption", () => {
    /*
      The old expression was `text || (imageUrl ? "📸 …" : "")`, so a caption
      made the placeholder unreachable and the admin was never told.
    */
    expect(notifications).not.toContain('message.text || (message.imageUrl ? "📸');
    expect(notifications).toContain("attachmentLine");
  });

  it("does not make the file public to get it into Telegram", () => {
    expect(notifications).toContain("readBinary(");
    expect(notifications).not.toMatch(/publicUrl|makePublic|signed[Uu]rl/);
  });
});
