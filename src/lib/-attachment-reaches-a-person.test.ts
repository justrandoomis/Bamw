/**
 * The image the assistant promised to forward, and nobody did.
 *
 * The admin was told about a customer's message only when the thread was an
 * order or a human-support one. But the paperclip lives in the assistant
 * thread too — it is where a member with no open conversation lands, including
 * one sent there by the fix that stopped attachments being silently dropped —
 * and an image posted there notified nobody at all.
 *
 * The assistant answers such an image with "سأحوّل الصورة والرمز للإدارة
 * الآن". `support/images.ts` sets `escalate: true` in the reply body to make
 * that true, and nothing on the server has ever read the flag. The shop
 * promised a customer their screenshot was on its way to a person, and it
 * went nowhere.
 *
 * Two more, both in the forwarding added alongside it:
 *
 *  - `sendPhoto` refuses a video, and the member's picker offers mp4, webm and
 *    mov. Forwarding one unconditionally means the card says an attachment
 *    arrived and the picture never follows.
 *  - Telegram refuses a message over 4096 characters, and refuses it whole.
 *    The chat input accepts 4000, and that text is interpolated into the
 *    notification — so one long customer message told the admin nothing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isVideoUploadUrl } from "./uploads";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const chat = source("src/routes/api/chat.ts");
const notifications = source("src/lib/telegram-notifications.server.ts");
const images = source("src/lib/support/images.ts");

describe("an attachment in the assistant thread", () => {
  it("notifies the admin, whatever kind of thread it arrived in", () => {
    expect(chat).toContain("const hasAttachment = Boolean(data.imageUrl)");
    expect(chat).toContain("if (!isAutomatedThread || hasAttachment)");
  });

  it("does not drag the human-thread handling along with it", () => {
    /*
      Queue re-entry and the availability check belong to a human
      conversation. Only the notification was widened.
    */
    const block = chat.slice(
      chat.indexOf("const hasAttachment = Boolean(data.imageUrl)"),
      chat.indexOf("const availability = await getAdminAvailabilityStatus()"),
    );
    const notifyEnd = block.indexOf("[chat:notify_admin_failed]");
    expect(block.slice(0, notifyEnd)).not.toContain("handleCustomerQueueReentry");
  });

  it("is a promise the assistant actually makes", () => {
    // If this text ever goes, the reason for the widening goes with it.
    expect(images).toContain("سأحوّل الصورة والرمز للإدارة");
    expect(images).toContain("escalate: true");
  });
});

describe("forwarding the file", () => {
  it("recognises a video rather than sending it as a photo", () => {
    expect(isVideoUploadUrl("/api/files/chat/usr_a1/clip.mp4")).toBe(true);
    expect(isVideoUploadUrl("/api/files/chat/usr_a1/shot.webp")).toBe(false);
    expect(notifications).toContain("isVideoUploadUrl(path)");
  });

  it("still tells the admin a video arrived and where to watch it", () => {
    const fn = notifications.slice(
      notifications.indexOf("async function forwardAttachmentToAdmin"),
      notifications.indexOf("Notify Admin when a user submits a wallet recharge"),
    );
    expect(fn).toContain("مقطع فيديو");
    // And returns rather than falling through to sendPhoto.
    expect(fn.indexOf("مقطع فيديو")).toBeLessThan(fn.indexOf("sendTelegramPhoto"));
  });
});

describe("a very long customer message", () => {
  it("is trimmed rather than refused whole", () => {
    expect(notifications).toContain("TELEGRAM_MESSAGE_LIMIT = 4096");
    expect(notifications).toContain("اختُصرت");
  });

  it("is checked for secrets after trimming, on the text actually sent", () => {
    /*
      Checking the untrimmed body and sending the trimmed one would mean the
      guard ran over something other than what left the server.
    */
    const fn = notifications.slice(
      notifications.indexOf("export async function sendAdminNotification"),
      notifications.indexOf("export async function notifyAdminNewOrder"),
    );
    expect(fn.indexOf("const body =")).toBeLessThan(fn.indexOf("findForbiddenSecret(body)"));
    expect(fn).toContain("withRoutePrefix(route, body)");
  });
});
