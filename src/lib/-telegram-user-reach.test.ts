/**
 * @vitest-environment node
 */
/**
 * Whether a per-user Telegram message can reach anybody at all.
 *
 * `getUserTelegramChatId` exists because of a bug that silenced every
 * per-user message in the shop: the code read `telegram_id` from `users`, a
 * column that table does not have, the throw was swallowed, and the lookup
 * returned undefined for everyone. Its own comment lists what stopped
 * arriving — order status, game-request updates, release alerts.
 *
 * The helper was fixed. Three direct readers of `user.telegramId` were not,
 * and they failed more quietly still: `if (user.telegramId)` on a field
 * nothing ever sets is not an error, it is an `if` that is simply never true.
 * A buyer was never told their order existed, a member was never told support
 * had replied, and no price-drop alert has ever been sent.
 *
 * This test guards the property that actually matters — that the shop asks
 * the table the link lives in — because the failure it protects against
 * produces no error, no log, and no missing field. Only silence.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const files = {
  "orders.server.ts": readFileSync("src/lib/orders.server.ts", "utf8"),
  "db.server.ts": readFileSync("src/lib/db.server.ts", "utf8"),
};

/** Source with comments removed, so prose about the bug is not read as the bug. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("per-user Telegram notifications", () => {
  it("never gates a send on `telegramId`, a field the users table has no column for", () => {
    for (const [name, text] of Object.entries(files)) {
      const body = code(text);
      /*
        Any read of `.telegramId` on a user-shaped value. The referral service
        passes `telegramId` into its own payloads rather than sending to it,
        so this looks for the guard-and-send shape specifically.
      */
      const guards = [...body.matchAll(/if\s*\([^)]*\.telegramId[^)]*\)/g)].map((m) => m[0]);
      expect(guards, `${name} still gates a Telegram send on user.telegramId`).toEqual([]);
    }
  });

  it("asks getUserTelegramChatId in each of the three places that had the bug", () => {
    /* The buyer's order confirmation, the support reply, and the price watch. */
    expect(code(files["orders.server.ts"])).toContain("getUserTelegramChatId");
    const db = code(files["db.server.ts"]);
    expect([...db.matchAll(/getUserTelegramChatId\(/g)].length).toBeGreaterThanOrEqual(2);
  });

  it("reads telegram_links, which is where the mapping actually lives", async () => {
    const helper = readFileSync("src/lib/telegram-notifications.server.ts", "utf8");
    const fn = helper.slice(helper.indexOf("export async function getUserTelegramChatId"));
    const linksAt = fn.indexOf("telegram_links");
    const legacyAt = fn.indexOf("FROM users");
    expect(linksAt).toBeGreaterThan(-1);
    /* And reads it FIRST — the legacy column is the fallback, not the lead. */
    expect(linksAt).toBeLessThan(legacyAt === -1 ? Number.MAX_SAFE_INTEGER : legacyAt);
  });
});

/**
 * The link a lookup by user id will never find.
 *
 * `telegram_links.user_id` is not always a user id. Someone who verifies
 * Telegram before their account exists is filed under `guest:<phone>`, and
 * `adoptGuestTelegramLink` re-keys the row when they sign in — on the OTP
 * paths only. A member who arrived any other way keeps a row nothing looks up:
 * linked as far as they can tell, silent forever. Production is carrying one.
 */
describe("a link filed under a phone rather than a user id", () => {
  it("is still found, by the same criterion adoption uses", () => {
    const helper = readFileSync("src/lib/telegram-notifications.server.ts", "utf8");
    const body = helper.slice(
      helper.indexOf("export async function getUserTelegramChatId"),
      helper.indexOf("function buildInlineAppButton"),
    );
    expect(body).toContain("telegram_phone = ?");
    expect(body).toContain("normalizePhone");
  });

  it("is only reached after the two lookups that name the user directly", () => {
    /*
      Order matters. A row keyed to this member's own id is the authoritative
      answer; the phone is how an unadopted row is recognised, and must never
      outrank it — two accounts that once shared a number would otherwise send
      one member's messages to the other.
    */
    const helper = readFileSync("src/lib/telegram-notifications.server.ts", "utf8");
    const byUserId = helper.indexOf("FROM telegram_links WHERE user_id = ?");
    const byPhone = helper.indexOf("telegram_phone = ?");
    expect(byUserId).toBeGreaterThan(-1);
    expect(byPhone).toBeGreaterThan(byUserId);
  });

  it("never returns a link that carries no chat id", () => {
    const helper = readFileSync("src/lib/telegram-notifications.server.ts", "utf8");
    expect(helper).toContain("telegram_chat_id IS NOT NULL");
  });
});
