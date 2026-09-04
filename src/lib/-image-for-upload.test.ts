/**
 * "عند محاوله المستخدم رفع الصورة اثناء تعبئة المحفظة يظهر فشل رفع الصورة."
 *
 * The wallet modal read the whole photo into a base64 data URL and posted it
 * inside a JSON body. Base64 inflates by a third; the server refuses a body
 * over 20 MB; a current phone hands the page an 8–15 MB, 48-megapixel JPEG. So
 * an ordinary receipt photo failed, the message said "try again", and trying
 * again failed the same way for the same reason — the retry could not have
 * worked, because nothing about the file had changed.
 *
 * None of that size was worth anything: a receipt is read, not enlarged.
 *
 * The picture is scaled down in the browser now and sent as a file rather than
 * as text. Re-encoding is also what makes an iPhone photo work at all — HEIC
 * has no decoder on the server, and Safari, which is where HEIC comes from,
 * decodes it natively.
 *
 * These are source assertions plus behaviour on the pure helper: canvas and
 * `createImageBitmap` do not exist in the test environment, which is exactly
 * the case the helper must survive by returning the file untouched.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepareImageForUpload } from "./imageForUpload";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const modal = source("src/components/wallet/TopUpModal.tsx");
const chatView = source("src/components/ChatView.tsx");

const fileOf = (name: string, type: string, size: number) =>
  new File([new Uint8Array(size)], name, { type });

describe("prepareImageForUpload never becomes a new reason an upload fails", () => {
  it("returns the original when the browser cannot help", async () => {
    /*
      No canvas here, which stands in for every browser or file the decoder
      refuses. The server is a better judge than a broken canvas.
    */
    const file = fileOf("receipt.jpg", "image/jpeg", 5 * 1024 * 1024);
    await expect(prepareImageForUpload(file)).resolves.toBe(file);
  });

  it("leaves a small image alone rather than re-encoding it for nothing", async () => {
    const file = fileOf("small.png", "image/png", 50 * 1024);
    await expect(prepareImageForUpload(file)).resolves.toBe(file);
  });

  it("leaves an animation alone, which a canvas would flatten", async () => {
    const file = fileOf("clip.gif", "image/gif", 4 * 1024 * 1024);
    await expect(prepareImageForUpload(file)).resolves.toBe(file);
  });

  it("leaves anything that is not an image alone", async () => {
    const file = fileOf("statement.pdf", "application/pdf", 4 * 1024 * 1024);
    await expect(prepareImageForUpload(file)).resolves.toBe(file);
  });

  it("does not throw on a file with no type at all", async () => {
    const file = fileOf("photo", "", 9 * 1024 * 1024);
    await expect(prepareImageForUpload(file)).resolves.toBe(file);
  });
});

describe("the wallet top-up modal", () => {
  it("sends the file, not a base64 copy of it inside JSON", () => {
    expect(modal).toContain("uploadFileWithProgress(prepared");
    expect(modal).not.toContain("fileToDataUrl");
    expect(modal).not.toContain('api.upload(');
  });

  it("scales the photo down first", () => {
    expect(modal).toContain("prepareImageForUpload(file)");
  });

  it("shows the server's reason instead of 'try again'", () => {
    /*
      "try again" is advice that does not work for an unreadable format, a
      spent hourly limit, or a file too large — which is every real cause.
    */
    expect(modal).toContain("err instanceof Error && err.message");
    expect(modal).toContain("toast.error(reason)");
  });

  it("clears the input, so re-picking the same receipt fires change", () => {
    const handler = modal.slice(
      modal.indexOf("const handleFileUpload"),
      modal.indexOf("const handleRemoveProof"),
    );
    expect(handler).toContain('e.target.value = "";');
    // Cleared before the early return, or a cancelled picker leaves it stuck.
    expect(handler.indexOf('e.target.value = "";')).toBeLessThan(
      handler.indexOf("if (!file) return;"),
    );
  });
});

describe("the chat composer gets the same treatment", () => {
  it("scales an attachment down before uploading it", () => {
    /*
      The same photo, the same phone, the same 20 MB ceiling — reported first
      as a chat failure and then as a wallet one.
    */
    expect(chatView).toContain("prepareImageForUpload(rawFile)");
  });
});
