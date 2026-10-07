/**
 * «البصمات الصوتية عند إرسالها من الجهتين لا تعمل ولا يوجد هنالك إرسال بصمة
 *  صوتية من الأدمن ومحاولة فتح الرسالة الصوتية لا تعمل وعند إرسال الصورة من
 *  الأدمن لا تصل للمستخدم, وزر إعادة إرسال إثبات التسجيل لا يعمل»
 *
 * Each of those was a specific break:
 *
 * - the member's microphone ran a timer and sent the words «🎤 رسالة صوتية»;
 * - the server stored no audio, served no audio and answered no byte range,
 *   which Safari needs before it plays anything;
 * - an admin's picture was filed in the admin's own folder, which answers the
 *   member with a 404;
 * - a second sign-in proof met an UPDATE that only matched the first.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { readBinaryRange, writeBinary } from "./storage.server";
import { isAudioUrl, isConversationVoiceUrl, isOwnUploadUrl, isOwnVoiceUrl } from "./uploads";
import { formatVoiceDuration, voiceExtension, voiceFile } from "./voiceNotes";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("which voice notes may be sent", () => {
  it("a member's own recording, in their own chat folder", () => {
    expect(isOwnVoiceUrl("/api/files/chat/usr_abc123/0f1e2d3c4b5a6978.weba", "usr_abc123")).toBe(
      true,
    );
    expect(isOwnVoiceUrl("/api/files/chat/usr_abc123/0f1e2d3c4b5a6978.m4a", "usr_abc123")).toBe(
      true,
    );
    // Somebody else's, or not a recording at all.
    expect(isOwnVoiceUrl("/api/files/chat/usr_other/0f1e2d3c4b5a6978.weba", "usr_abc123")).toBe(
      false,
    );
    expect(isOwnVoiceUrl("/api/files/chat/usr_abc123/0f1e2d3c4b5a6978.png", "usr_abc123")).toBe(
      false,
    );
    expect(isOwnVoiceUrl("https://evil.example/a.weba", "usr_abc123")).toBe(false);
  });

  it("an admin's, only into the conversation it was recorded for", () => {
    const url = "/api/files/chat/thr_0123456789abcdef/aabbccddeeff0011.ogg";
    expect(isConversationVoiceUrl(url, "thr_0123456789abcdef")).toBe(true);
    expect(isConversationVoiceUrl(url, "thr_ffffffffffffffff")).toBe(false);
  });

  it("is played, never shown as an image or a video", () => {
    expect(isAudioUrl("/api/files/chat/usr_a/x.weba")).toBe(true);
    expect(isAudioUrl("/api/files/chat/usr_a/x.mp4")).toBe(false);
    // And an image URL check still refuses audio: imageUrl stays an image.
    expect(isOwnUploadUrl("/api/files/chat/usr_a/0f1e2d3c4b5a6978.weba", "usr_a")).toBe(false);
  });
});

describe("a recording becomes a file the server keeps", () => {
  it("names it by what the browser recorded", () => {
    expect(voiceExtension("audio/webm;codecs=opus")).toBe("weba");
    expect(voiceExtension("audio/mp4")).toBe("m4a");
    expect(voiceExtension("audio/ogg;codecs=opus")).toBe("ogg");
    const file = voiceFile(new Blob([new Uint8Array([1, 2, 3])]), "audio/webm;codecs=opus");
    expect(file.type).toBe("audio/webm");
    expect(file.name).toMatch(/\.weba$/);
  });

  it("shows its length the way a messenger does", () => {
    expect(formatVoiceDuration(7_000)).toBe("0:07");
    expect(formatVoiceDuration(102_000)).toBe("1:42");
    expect(formatVoiceDuration(Number.POSITIVE_INFINITY)).toBe("0:00");
  });

  it("is accepted by the upload route, under its own extensions, only as a chat note", () => {
    const upload = source("src/routes/api/upload.ts");
    expect(upload).toContain('"audio/webm": "weba"');
    expect(upload).toContain('"audio/mp4": "m4a"');
    expect(upload).toContain('if (root !== "chat" || !MIME_EXT[mime])');
    // `audio/webm;codecs=opus` is read as `audio/webm`.
    expect(upload).toContain('.split(";")[0]!');
  });
});

describe("a file is served in pieces, as a player asks for it", () => {
  const objects = new Map<string, { bytes: Uint8Array; type: string }>();
  const bucket = {
    async get(key: string, options?: { range?: { offset: number; length?: number } }) {
      const found = objects.get(key);
      if (!found) return null;
      const { offset = 0, length } = options?.range ?? {};
      const bytes = found.bytes.slice(offset, length === undefined ? undefined : offset + length);
      return {
        size: found.bytes.byteLength,
        etag: '"e"',
        httpMetadata: { contentType: found.type },
        text: async () => "",
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
    },
    async head(key: string) {
      const found = objects.get(key);
      return found
        ? { size: found.bytes.byteLength, etag: '"e"', httpMetadata: { contentType: found.type } }
        : null;
    },
    async put(
      key: string,
      value: Uint8Array,
      options?: { httpMetadata?: { contentType?: string } },
    ) {
      objects.set(key, { bytes: value, type: options?.httpMetadata?.contentType ?? "" });
    },
    async list() {
      return { objects: [] };
    },
    async delete() {},
  };
  const env = globalThis as { __CF_ENV__?: Record<string, unknown> };
  let saved: Record<string, unknown> | undefined;

  beforeEach(async () => {
    saved = env.__CF_ENV__;
    env.__CF_ENV__ = { ...(saved ?? {}), BANANTO_PRIVATE_BUCKET: bucket };
    await writeBinary(
      "files/chat/usr_a/voice.weba",
      new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
      "audio/webm",
    );
  });
  afterEach(() => {
    env.__CF_ENV__ = saved;
    objects.clear();
  });

  const bytesOf = (part: Awaited<ReturnType<typeof readBinaryRange>>) =>
    part && "body" in part && part.body instanceof Uint8Array ? [...part.body] : null;

  it("answers the opening probe Safari sends", async () => {
    const part = await readBinaryRange("files/chat/usr_a/voice.weba", "bytes=0-1");
    expect(part && "start" in part ? [part.start, part.end, part.size, part.mime] : null).toEqual([
      0,
      1,
      10,
      "audio/webm",
    ]);
    expect(bytesOf(part)).toEqual([0, 1]);
  });

  it("answers an open-ended range and a suffix", async () => {
    expect(bytesOf(await readBinaryRange("files/chat/usr_a/voice.weba", "bytes=7-"))).toEqual([
      7, 8, 9,
    ]);
    expect(bytesOf(await readBinaryRange("files/chat/usr_a/voice.weba", "bytes=-2"))).toEqual([
      8, 9,
    ]);
  });

  it("says when a range lies past the end, and ignores what it cannot read", async () => {
    expect(await readBinaryRange("files/chat/usr_a/voice.weba", "bytes=50-60")).toEqual({
      unsatisfiable: true,
      size: 10,
    });
    expect(await readBinaryRange("files/chat/usr_a/voice.weba", "bytes=0-1,4-5")).toBeUndefined();
    expect(await readBinaryRange("files/chat/usr_a/missing.weba", "bytes=0-1")).toBeUndefined();
  });

  it("and the file route answers 206 with it", () => {
    const route = source("src/routes/api/files/$.ts");
    expect(route).toContain("status: 206");
    expect(route).toContain('"accept-ranges": "bytes"');
    expect(route).toMatch(/weba\|ogg\|oga\|opus\|m4a\|aac\|mp3/);
  });
});

describe("what the shop sends reaches the member", () => {
  it("files an admin's upload under the conversation", () => {
    const upload = source("src/routes/api/upload.ts");
    expect(upload).toContain("key = `files/chat/${conversationId}/${hashHex}.${ext}`;");
    const composer = source("src/components/admin/inbox/ActiveConversation.tsx");
    expect(composer).toContain('uploadFileWithProgress(file, "chat", undefined, { threadId })');
    expect(composer).not.toContain('fetch("/api/upload"');
  });

  it("lets the conversation's member open it, and nobody else", () => {
    const route = source("src/routes/api/files/$.ts");
    expect(route).toContain("const threadMatch = /^chat\\/(thr_[a-z0-9]+)\\//i.exec(path);");
    expect(route).toContain("if (!thread || thread.userId !== viewer.id)");
  });

  it("lets the shop record a voice note, and plays one on both sides", () => {
    const composer = source("src/components/admin/inbox/ActiveConversation.tsx");
    expect(composer).toContain("useVoiceRecorder()");
    expect(source("src/components/admin/inbox/MessageCard.tsx")).toContain("<VoiceNotePlayer");
    expect(source("src/components/ChatView.tsx")).toContain("<VoiceNotePlayer");
  });

  it("records for real on the member's side, instead of sending a label", () => {
    const chat = source("src/components/ChatView.tsx");
    expect(chat).toContain("const voice = useVoiceRecorder();");
    expect(chat).not.toContain("🎤 رسالة صوتية (${formatTime(recordingTime)})");
    expect(chat).toContain("audioUrl: url,");
  });

  it("draws the server's copy of a sent message as a bubble, not the raw row", () => {
    const chat = source("src/components/ChatView.tsx");
    expect(chat).not.toContain('({ ...res.message, status: "sent" } as any)');
    expect(chat).toContain("confirmedBubble(res.message, m)");
  });
});

describe("a sign-in proof can be sent again", () => {
  const delivery = source("src/lib/order-delivery-items.server.ts");
  const fn = delivery.slice(
    delivery.indexOf("export async function recordDeliveryProof"),
    delivery.indexOf("export async function markDeliveryOtpSent"),
  );

  it("replaces the last one, before and after the code was sent", () => {
    expect(fn).toContain('const replaceable = ["sent", "proof_received", "otp_sent"] as const;');
    // Pinned to the status that was read — not to 'sent' alone, which refused every replacement.
    expect(fn).toContain("WHERE id = ? AND order_id = ? AND status = ? AND archived_at IS NULL");
    expect(fn).not.toContain("AND status = 'sent' AND archived_at IS NULL");
  });

  it("is prepared like any photo, and its target does not go stale", () => {
    const chat = source("src/components/ChatView.tsx");
    expect(chat).toContain("const prepared = await prepareImageForUpload(file);");
    expect(chat).toContain('uploadFileWithProgress(prepared, "orders")');
    expect(chat).toContain("proofItemRef.current = null;");
  });
});
