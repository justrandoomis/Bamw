/**
 * Two ways a message failed to land properly, both invisible in development.
 *
 * ## The admin inbox never updated live
 *
 * There are two SSE streams. The in-process fallback in `api/chat.ts` writes
 * `event: ${type}\ndata: …`; the Durable Object wrote `data: …` with no
 * `event:` line at all. Per the spec a frame with no event field dispatches as
 * "message", and the client registers only named listeners —
 * `message.created`, `thread.updated`, `typing.update` and the rest — so not
 * one of them ever fired.
 *
 * Production binds the Durable Object. A developer's machine, with no DO, took
 * the working path. So the inbox updated live everywhere except in the shop: a
 * customer's message, and the image with it, appeared only on a reload.
 *
 * ## And one reply arrived twice
 *
 * `appendMessage` sends a Telegram message for any admin-authored message, and
 * `POST /api/chat` sent a second of its own right after it. One reply typed in
 * the inbox reached the member twice — the first plain, the second carrying
 * the button. The button moved to the one notification every admin message
 * produces, so a reply sent from the Telegram group, or a delivered account,
 * gets it too instead of a bare line.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const realtime = source("src/lib/chat-realtime.server.ts");
const chat = source("src/routes/api/chat.ts");
const db = source("src/lib/db.server.ts");
const hook = source("src/hooks/useChatRealtime.ts");

describe("the Durable Object's stream", () => {
  it("names every frame it sends", () => {
    expect(realtime).toContain("`event: ${name}\\ndata: ${data}\\n\\n`");
  });

  it("takes the name from the payload the producers already set", () => {
    const fn = realtime.slice(realtime.indexOf("private pushEvent"));
    expect(fn).toContain("parsed?.type");
  });

  it("strips newlines from the name, which would let a payload inject frames", () => {
    const fn = realtime.slice(realtime.indexOf("private pushEvent"));
    expect(fn).toContain("replace(/[\\r\\n]/g");
  });

  it("still sends an event it cannot name rather than dropping it", () => {
    const fn = realtime.slice(realtime.indexOf("private pushEvent"));
    expect(fn).toContain('let name = "message"');
  });

  it("sends names the client is actually listening for", () => {
    /*
      The two halves have to agree. These are the names the DO's producers
      emit; each one must have a listener, or the frame is delivered and
      ignored — which is the failure this fixes, one step later.
    */
    for (const name of ["message.created", "thread.updated", "typing.update"]) {
      expect(hook, name).toContain(`addEventListener("${name}"`);
    }
    expect(realtime).toContain('type: "typing.update"');
  });
});

describe("an admin reply", () => {
  it("is announced once, by appendMessage", () => {
    expect(chat).not.toContain("notifyUserAdminMessage({");
  });

  it("carries a button back into the conversation", () => {
    const block = db.slice(db.indexOf('full.senderRole === "admin"'), db.indexOf("return full;"));
    expect(block).toContain("telegramMiniAppDeepLink(");
    expect(block).toContain("فتح المحادثة");
  });

  it("opens the order when the thread has one, and the chat otherwise", () => {
    const block = db.slice(db.indexOf('full.senderRole === "admin"'), db.indexOf("return full;"));
    expect(block).toContain("thread.orderId ? `order_${thread.orderId}` : `chat_${threadId}`");
  });
});
