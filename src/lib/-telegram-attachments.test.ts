/**
 * @vitest-environment node
 */
/**
 * What may come out of Telegram and into a customer's conversation.
 *
 * The link Telegram gives for a file carries the bot token in its path and
 * expires. Putting one in a message would leak the bot and then rot, so the
 * bytes are fetched, checked and written to R2, and the customer gets the
 * shop's own permanent path.
 */

import { describe, expect, it, vi } from "vitest";

import {
  MAX_ATTACHMENT_BYTES,
  attachmentOf,
  checkAttachment,
  storeTelegramAttachment,
} from "./telegram-attachments.server";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");

describe("attachmentOf", () => {
  it("takes the largest size of a photo", () => {
    /* Telegram sends several; the last is the biggest and the one worth keeping. */
    const out = attachmentOf({
      photo: [
        { file_id: "small", file_size: 100 },
        { file_id: "big", file_size: 9000 },
      ],
    });
    expect(out).toEqual({ fileId: "big", declaredSize: 9000 });
  });

  it("takes a document when there is no photo", () => {
    expect(attachmentOf({ document: { file_id: "doc", file_size: 5 } })).toEqual({
      fileId: "doc",
      declaredSize: 5,
    });
  });

  it("finds nothing in a plain message", () => {
    expect(attachmentOf({ text: "hello" })).toBeNull();
    expect(attachmentOf({ photo: [] })).toBeNull();
    expect(attachmentOf(undefined)).toBeNull();
  });
});

describe("checkAttachment", () => {
  it("accepts an image and a PDF", () => {
    expect(checkAttachment(PNG)).toMatchObject({ ok: true, mime: "image/png", ext: "png" });
    expect(checkAttachment(PDF)).toMatchObject({ ok: true, mime: "application/pdf", ext: "pdf" });
  });

  it("refuses anything that executes, however it is labelled", () => {
    /*
      The customer's browser renders whatever comes back, so the check is on
      the bytes. `mime_type` is chosen by the sender and an extension is part
      of a filename; a `.png` that is not a PNG is the oldest trick there is.
    */
    const out = checkAttachment(HTML);
    expect(out.ok).toBe(false);
    expect(out.refusal).toBe("unsupported_type");
  });

  it("refuses a file bigger than the limit", () => {
    const huge = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    huge.set(PNG);
    expect(checkAttachment(huge)).toMatchObject({ ok: false, refusal: "too_large_received" });
  });
});

describe("storeTelegramAttachment", () => {
  const base = { conversationId: "thr_1", botToken: "12345:AAA" };

  it("refuses on the declared size, before pulling the bytes", async () => {
    /* A refusal that arrives after downloading 40 MB has already cost the
       thing it was meant to prevent. */
    const fetchImpl = vi.fn();
    const out = await storeTelegramAttachment({
      ...base,
      fileId: "f",
      declaredSize: MAX_ATTACHMENT_BYTES + 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toEqual({ ok: false, refusal: "too_large_declared" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses without a file id or a token", async () => {
    expect(await storeTelegramAttachment({ ...base, fileId: "", declaredSize: 1 })).toEqual({
      ok: false,
      refusal: "no_file",
    });
    expect(
      await storeTelegramAttachment({ ...base, botToken: "", fileId: "f", declaredSize: 1 }),
    ).toEqual({ ok: false, refusal: "no_file" });
  });

  it("gives back the shop's own path, never Telegram's", async () => {
    vi.resetModules();
    const written: string[] = [];
    vi.doMock("./storage.server", () => ({
      hasObject: async (key: string) => written.includes(key),
      writeBinary: async (key: string) => {
        written.push(key);
      },
    }));
    const mod = await import("./telegram-attachments.server");

    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("getFile")) {
        return {
          ok: true,
          json: async () => ({ ok: true, result: { file_path: "photos/x.png" } }),
        } as unknown as Response;
      }
      return {
        ok: true,
        arrayBuffer: async () => PNG.buffer.slice(0),
      } as unknown as Response;
    });

    const out = await mod.storeTelegramAttachment({
      ...base,
      fileId: "f",
      declaredSize: PNG.length,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(out.ok).toBe(true);
    expect(out.mime).toBe("image/png");
    /* Filed under the conversation, so one attachment cannot be found by
       guessing at another. */
    expect(out.url).toMatch(/^\/api\/files\/chat\/thr_1\/[0-9a-f]{32}\.png$/);
    /* And nothing of Telegram's — the token is in its file path. */
    expect(out.url).not.toContain("telegram");
    expect(out.url).not.toContain(base.botToken);
  });

  it("refuses a download that fails", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false }) as unknown as Response);
    const out = await storeTelegramAttachment({
      ...base,
      fileId: "f",
      declaredSize: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toEqual({ ok: false, refusal: "download_failed" });
  });
});
