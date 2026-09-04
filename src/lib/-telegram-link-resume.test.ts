/**
 * The link the bot said had worked.
 *
 * Linking is `/start <token>`, and the `@banan_to` subscription gate sits in
 * front of it. A member not yet in the channel never reaches the handler: the
 * gate answers with a subscribe prompt and carries their token into a
 * `verify_sub_<token>` button. The callback that button fires confirmed
 * membership, replied "✅ تم التحقق من اشتراكك بنجاح", opened the Mini App —
 * and dropped the token. No row was written, the challenge expired unused, and
 * the member had been told in as many words that it had worked.
 *
 * That is the answer to "الرسائل لا تصل بالرغم من ربط التليكرام": for anyone
 * who was not already subscribed, the link never existed.
 *
 * Also note `checkChannelSubscription` returns `isMember: false` for *any*
 * failure — including the bot lacking rights to read the channel's members —
 * so this gate can stand in front of every member at once.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const webhook = readFileSync("src/routes/api/public/telegram/webhook.ts", "utf8");

describe("the subscription callback", () => {
  it("resumes the link token it was carrying", () => {
    const callback = webhook.slice(
      webhook.indexOf('callback.data?.startsWith("verify_sub_")'),
      webhook.indexOf('callback.data === "get_id"'),
    );
    expect(callback).toContain("resumeLinkToken(");
  });

  it("resumes it before answering with the plain welcome", () => {
    const callback = webhook.slice(
      webhook.indexOf('callback.data?.startsWith("verify_sub_")'),
      webhook.indexOf('callback.data === "get_id"'),
    );
    /*
      Order is the whole fix. Sending the welcome first and returning is
      exactly what dropped the token.
    */
    expect(callback.indexOf("resumeLinkToken(")).toBeLessThan(
      callback.indexOf("تم التحقق من اشتراكك في القناة بنجاح"),
    );
  });
});

describe("resumeLinkToken", () => {
  it("is the one place a token is turned into a link", () => {
    /*
      `/start` used to hold its own copy. Two copies is how one of them gets
      fixed and the other does not — which is the shape of this bug.
    */
    expect(webhook.match(/bindSessionChat\(/g) ?? []).toHaveLength(1);
    expect(webhook.match(/handleLinkToken\(chatId, from, token\)/g) ?? []).toHaveLength(1);
  });

  it("refuses the gate's 'main' placeholder", () => {
    /*
      "main" is what the gate substitutes when `/start` carried no parameter.
      It matches the token shape, so without this a plain visitor who subscribes
      would be answered with a verification screen for a session that does not
      exist.
    */
    const fn = webhook.slice(
      webhook.indexOf("async function resumeLinkToken"),
      webhook.indexOf("async function handleLinkToken"),
    );
    expect(fn).toContain('token === "main"');
  });

  it("still validates the token's shape before using it", () => {
    const fn = webhook.slice(
      webhook.indexOf("async function resumeLinkToken"),
      webhook.indexOf("async function handleLinkToken"),
    );
    expect(fn).toContain("/^[A-Za-z0-9_-]{8,128}$/");
  });

  it("tells the caller when there was nothing to resume", () => {
    const fn = webhook.slice(
      webhook.indexOf("async function resumeLinkToken"),
      webhook.indexOf("async function handleLinkToken"),
    );
    // So `/start` with no token falls through to its ordinary welcome.
    expect(fn).toContain("return false");
  });
});
