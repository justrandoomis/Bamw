/**
 * A customer asking about a password used to silence the whole notification.
 *
 * `findForbiddenSecret` runs on the fully-assembled body and the caller drops
 * the message entirely — which is right for a body the shop composed: one that
 * has to be censored to be sent was assembled wrongly, and sending the
 * censored half would hide that.
 *
 * It is wrong for a customer's own words, and those are interpolated straight
 * into the support and escalation cards. A member writing "كلمة المرور: 1234"
 * while asking for help tripped the guard, and the admin was never told that
 * customer had written in at all. A member typing about a password is not a
 * bug in the shop's code — it is somebody needing help, and losing them
 * silently is the worst outcome on offer.
 *
 * Untrusted text is scrubbed at the boundary where it enters now. The guard
 * keeps dropping anything the shop writes itself.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findForbiddenSecret, redactSecrets } from "./telegram-admin-routing.server";

const notifications = readFileSync(
  resolve(process.cwd(), "src/lib/telegram-notifications.server.ts"),
  "utf8",
);

describe("redactSecrets", () => {
  it("takes the secret out and leaves the sentence", () => {
    const scrubbed = redactSecrets("مرحبا، كلمة المرور: 1234 لا تعمل معي");
    expect(scrubbed).not.toContain("كلمة المرور:");
    expect(scrubbed).toContain("مرحبا");
    expect(scrubbed).toContain("لا تعمل معي");
  });

  it("leaves nothing the guard would still object to", () => {
    /*
      The point of the whole change: scrubbed customer text must not trip the
      guard, or the notification is dropped anyway and nothing was gained.
    */
    for (const text of [
      "كلمة المرور: 1234",
      "the password: hunter2 does not work",
      "رمز التحقق 445566 ما وصلني",
      "api_key = abcdefghijklmnop",
      "密码: 8899",
    ]) {
      expect(findForbiddenSecret(redactSecrets(text)), text).toBeUndefined();
    }
  });

  it("removes every occurrence, not only the first", () => {
    const scrubbed = redactSecrets("كلمة المرور: 1111 و كلمة المرور: 2222");
    expect(findForbiddenSecret(scrubbed)).toBeUndefined();
    expect(scrubbed.match(/«محذوف»/g) ?? []).toHaveLength(2);
  });

  it("does not carry state between calls", () => {
    /*
      A shared `/g` regex keeps `lastIndex` between uses, so the second caller
      would start scanning half-way through their own text and miss a match.
    */
    const once = redactSecrets("كلمة المرور: 1234");
    const twice = redactSecrets("كلمة المرور: 1234");
    expect(twice).toBe(once);
  });

  it("leaves an ordinary message completely alone", () => {
    const text = "سلام، طلبي رقم ١٢٣ ما وصل لحد الآن، شكراً";
    expect(redactSecrets(text)).toBe(text);
  });
});

describe("the guard still drops what the shop composed wrongly", () => {
  it("is unchanged: a bare secret in a shop-written body is refused", () => {
    expect(findForbiddenSecret("كلمة المرور: 1234")).toBe("password");
    expect(findForbiddenSecret("api_key = abc")).toBe("api_key");
  });
});

describe("every customer-written field is scrubbed on the way in", () => {
  it.each([
    ["the support card's message text", "redactSecrets(message.text"],
    ["the escalation excerpt", "redactSecrets((params.lastUserText"],
    ["the game request's notes", "redactSecrets(request.notes)"],
    ["the game request's product name", "redactSecrets(request.productName)"],
  ])("%s", (_name, marker) => {
    expect(notifications).toContain(marker);
  });

  it("scrubs before escaping, so the marker is not double-processed", () => {
    expect(notifications).toContain("escapeHtml(redactSecrets(message.text");
  });
});
