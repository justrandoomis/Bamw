import { describe, expect, it } from "vitest";

import { isOwnReviewImageUrl, isOwnUploadUrl, isVideoUploadUrl, isVideoUrl } from "./uploads";

const ME = "usr_member1";

/**
 * The order chat uploads payment receipts and account-registration proofs to
 * `receipts/`, but the chat only accepted `chat/`, so attaching one always
 * failed with `invalid_image` — the step where a buyer proves they registered
 * the account they were delivered.
 */
describe("isOwnUploadUrl", () => {
  it("accepts the member's own uploads from the folders the app writes to", () => {
    for (const folder of [
      "chat",
      "uploads",
      "orders",
      "receipts",
      "support",
      "documents",
      "reviews",
    ]) {
      expect(isOwnUploadUrl(`/api/files/${folder}/${ME}/f_abc123.png`, ME)).toBe(true);
    }
  });

  it("accepts every image type the uploader can produce", () => {
    for (const ext of ["png", "jpg", "jpeg", "webp", "gif"]) {
      expect(isOwnUploadUrl(`/api/files/receipts/${ME}/f_abc.${ext}`, ME)).toBe(true);
    }
  });

  it("refuses another member's file, which is the rule that actually matters", () => {
    expect(isOwnUploadUrl(`/api/files/receipts/usr_someoneelse/f_abc.png`, ME)).toBe(false);
    expect(isOwnUploadUrl(`/api/files/chat/usr_admin1/f_abc.png`, ME)).toBe(false);
  });

  it("refuses folders members do not upload into", () => {
    expect(isOwnUploadUrl(`/api/files/wallets/${ME}/f_abc.png`, ME)).toBe(false);
    expect(isOwnUploadUrl(`/api/files/products/${ME}/f_abc.png`, ME)).toBe(false);
  });

  it("refuses traversal, absolute and lookalike URLs", () => {
    for (const url of [
      `/api/files/receipts/${ME}/../../../etc/passwd.png`,
      `https://evil.example/api/files/receipts/${ME}/f_abc.png`,
      `//evil.example/api/files/receipts/${ME}/f_abc.png`,
      `/api/files/receipts/${ME}/f_abc.svg`,
      `/api/files/receipts/${ME}/f_abc.png?x=/api/files/chat/${ME}/y.png`,
      `/api/filesX/receipts/${ME}/f_abc.png`,
      `/api/files/receipts/${ME}/sub/f_abc.png`,
    ]) {
      expect(isOwnUploadUrl(url, ME)).toBe(false);
    }
  });

  it("refuses an id that merely starts with the member's id", () => {
    expect(isOwnUploadUrl(`/api/files/chat/${ME}9/f_abc.png`, ME)).toBe(false);
  });
});

describe("video attachments", () => {
  it("accepts the member's own video uploads", () => {
    for (const ext of ["mp4", "webm", "mov"]) {
      expect(isOwnUploadUrl(`/api/files/chat/${ME}/f_abc.${ext}`, ME)).toBe(true);
      expect(isVideoUploadUrl(`/api/files/chat/${ME}/f_abc.${ext}`)).toBe(true);
    }
  });

  it("does not mistake an image for a video", () => {
    expect(isVideoUploadUrl(`/api/files/chat/${ME}/f_abc.png`)).toBe(false);
    expect(isVideoUrl(`/api/files/chat/${ME}/f_abc.png`)).toBe(false);
  });

  it("recognises stored video URLs at render time, including with a query", () => {
    expect(isVideoUrl(`/api/files/chat/${ME}/f_abc.mp4`)).toBe(true);
    expect(isVideoUrl(`/api/files/chat/${ME}/f_abc.webm?v=2`)).toBe(true);
    expect(isVideoUrl(null)).toBe(false);
    expect(isVideoUrl(undefined)).toBe(false);
    expect(isVideoUrl("")).toBe(false);
  });

  it("still refuses another member's video", () => {
    expect(isOwnUploadUrl(`/api/files/chat/usr_other/f_abc.mp4`, ME)).toBe(false);
  });
});

describe("review images", () => {
  it("accepts only the member's own still image in the reviews folder", () => {
    expect(isOwnReviewImageUrl(`/api/files/reviews/${ME}/f_abc.webp`, ME)).toBe(true);
    expect(isOwnReviewImageUrl(`/api/files/chat/${ME}/f_abc.webp`, ME)).toBe(false);
    expect(isOwnReviewImageUrl(`/api/files/reviews/${ME}/f_abc.mp4`, ME)).toBe(false);
    expect(isOwnReviewImageUrl(`/api/files/reviews/usr_other/f_abc.webp`, ME)).toBe(false);
  });
});
