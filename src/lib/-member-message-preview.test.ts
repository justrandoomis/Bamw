/**
 * The message that told a buyer the shop had sent them a picture.
 *
 * When an admin delivers a game account, `appendMessage` really does send the
 * member a Telegram message — `senderRole` is "admin" on every delivery
 * sender, and that is what the send is gated on. What it said was the problem.
 *
 * The line was `"${body["text"] || "أرسل صورة"}"`, and that fallback is right
 * for exactly one kind of message: an attachment with no caption. Every other
 * admin-authored kind keeps its content in named fields and carries no `text` —
 * a delivered account is `{email, password, title, slot}`, a verification code
 * is `{code, expiresAt}`. So at the moment the thing they had paid for
 * arrived, the buyer was told the shop had sent a picture, in a message whose
 * Markdown asterisks rendered literally because nothing set a parse mode.
 *
 * That is worse than silence. Silence sends someone to look.
 *
 * The other half of this test is the rule that must never bend: the password,
 * the account e-mail and the one-time code do not go into Telegram. A message
 * there is forwardable, searchable, and sits in a history on a phone that may
 * be handed to someone else.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { memberMessagePreview } from "./memberMessagePreview";

describe("a delivered account", () => {
  const body = {
    deliveryItemId: "dli_1",
    itemId: "itm_1",
    productId: "prd_1",
    title: "EA FC 26",
    email: "buyer.account@example.com",
    password: "S3cr3t-P4ss",
    slot: 2,
  };

  it("says the account is ready, naming the game", () => {
    const preview = memberMessagePreview({ kind: "item_credentials", body });
    expect(preview).toContain("EA FC 26");
    expect(preview).toContain("افتح التطبيق");
  });

  it("never carries the password or the e-mail into Telegram", () => {
    const preview = memberMessagePreview({ kind: "item_credentials", body });
    expect(preview).not.toContain("S3cr3t-P4ss");
    expect(preview).not.toContain("buyer.account@example.com");
  });

  it("still says something useful when the title is missing", () => {
    const preview = memberMessagePreview({ kind: "item_credentials", body: { password: "x" } });
    expect(preview).toContain("بيانات حسابك");
    expect(preview).not.toContain("x");
  });
});

describe("a verification code", () => {
  const body = { title: "Nintendo Switch Online", code: "441233", expiresAt: "2026-09-04T10:00:00Z" };

  it("says a code arrived without being the code", () => {
    const preview = memberMessagePreview({ kind: "item_verification_code", body });
    expect(preview).toContain("رمز التحقق");
    expect(preview).not.toContain("441233");
  });
});

describe("the kinds that do carry text", () => {
  it("uses the admin's own words for a plain reply", () => {
    expect(memberMessagePreview({ kind: "text", body: { text: "طلبك جاهز" } })).toBe("طلبك جاهز");
  });

  it("uses the caption on an image, and the word only when there is none", () => {
    expect(memberMessagePreview({ kind: "image", body: { text: "هذا الإيصال" } })).toContain(
      "هذا الإيصال",
    );
    expect(memberMessagePreview({ kind: "image", body: {} })).toContain("صورة");
  });

  it("never returns nothing, whatever the kind", () => {
    /*
      A message the shop sent is worth telling the member about even when this
      does not recognise it. "Something arrived" beats silence, and beats a
      wrong description.
    */
    for (const kind of ["", "unknown_kind", "discount_code", "shipping_update", "instructions"]) {
      expect(memberMessagePreview({ kind, body: {} }).trim().length).toBeGreaterThan(0);
    }
  });
});

describe("the send itself", () => {
  const db = readFileSync(resolve(process.cwd(), "src/lib/db.server.ts"), "utf8");

  it("no longer falls back to describing everything as an image", () => {
    expect(db).not.toContain('full.body["text"] || "أرسل صورة"');
    expect(db).toContain("memberMessagePreview(");
  });

  it("sets a parse mode, so the emphasis is not printed as asterisks", () => {
    /*
      It used Markdown `*bold*` with no parse_mode, and `looksLikeHtml` only
      matches HTML tags, so it never set one — the member saw the asterisks.
    */
    const block = db.slice(db.indexOf('full.senderRole === "admin"'), db.indexOf("return full;"));
    expect(block).toContain('parse_mode: "HTML"');
    expect(block).not.toMatch(/\*رسالة جديدة/);
  });

  it("escapes the thread subject, which a customer chose", () => {
    const block = db.slice(db.indexOf('full.senderRole === "admin"'), db.indexOf("return full;"));
    expect(block).toContain("escapeHtml(String(thread.subject");
    expect(block).toContain("escapeHtml(preview)");
  });
});
