/**
 * Four admin notifications that a single Telegram failure erased.
 *
 * ## The queue nobody was using
 *
 * `enqueueNotification` exists so a notification that fails to send is
 * retried: the consumer keeps a dedupe ledger and retries to five attempts.
 * Two of the six admin notifications went through it — new orders and wallet
 * top-ups. The other four sent inline, fire-and-forget, on the request path:
 *
 *   - a customer writing in, or attaching a screenshot;
 *   - somebody asking the shop to stock a game;
 *   - a disc offered for trade, waiting on a price;
 *   - a used listing submitted for review.
 *
 * Each swallowed its own failure and returned. One Telegram timeout, one 429,
 * and the store was never told — the customer sees a confirmation and waits
 * for an answer nobody knows to give.
 *
 * ## The trap this test is really guarding
 *
 * Enqueuing is only better than sending if the consumer understands the
 * envelope. `dispatch` logs and *acknowledges* a type it has no case for, so a
 * producer that emits a type the consumer never learned would lose the
 * notification more quietly than the inline send it replaced. So every type a
 * producer emits is checked against the consumer's cases here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

/** Producers, and the notification each one is responsible for. */
const PRODUCERS: { file: string; what: string; notify: string }[] = [
  { file: "src/routes/api/chat.ts", what: "a customer's message", notify: "notifyAdminCustomerMessage" },
  { file: "src/routes/api/game-requests.ts", what: "a game request", notify: "notifyAdminGameRequest" },
  { file: "src/routes/api/disc-trade.ts", what: "a disc trade", notify: "notifyAdminDiscTrade" },
  { file: "src/lib/used-marketplace.server.ts", what: "a used listing", notify: "notifyAdminUsedListing" },
  { file: "src/lib/orders.server.ts", what: "a new order", notify: "notifyAdminNewOrder" },
  { file: "src/routes/api/wallet.ts", what: "a wallet top-up", notify: "notifyAdminWalletTopUp" },
];

const consumer = source("src/lib/queue-consumer.server.ts");

/** Every `type:` an `enqueueNotification` envelope in this file declares. */
function enqueuedTypes(text: string): string[] {
  const types: string[] = [];
  let at = text.indexOf("enqueueNotification(");
  while (at !== -1) {
    const window = text.slice(at, at + 800);
    const match = /type:\s*"([^"]+)"/.exec(window);
    if (match?.[1]) types.push(match[1]);
    at = text.indexOf("enqueueNotification(", at + 1);
  }
  return types;
}

describe("every admin notification", () => {
  for (const producer of PRODUCERS) {
    describe(producer.what, () => {
      const text = source(producer.file);

      it("is handed to the outbox, not sent and forgotten", () => {
        expect(text).toContain("enqueueNotification");
        /*
          The notify function is still called — as the outbox's direct
          fallback, for the deployments with no queue binding — but only from
          inside an `enqueueNotification` call. A call anywhere else is the old
          inline path surviving beside the new one, which is the shape this
          whole change exists to remove.
        */
        const outboxWindows = [...text.matchAll(/enqueueNotification\(/g)].map((m) => [
          m.index ?? 0,
          (m.index ?? 0) + 800,
        ]);
        for (const call of text.matchAll(new RegExp(`\\b${producer.notify}\\(`, "g"))) {
          const at = call.index ?? 0;
          const inside = outboxWindows.some(([from, to]) => at > from && at < to);
          expect(inside, `${producer.notify} is called outside the outbox`).toBe(true);
        }
      });

      it("carries a dedupe key the consumer can file", () => {
        const at = text.indexOf("enqueueNotification(");
        const window = text.slice(at, at + 800);
        expect(window).toMatch(/dedupeKey:\s*`[^`]*\$\{/);
      });

      it("declares a type the consumer knows how to dispatch", () => {
        const types = enqueuedTypes(text);
        expect(types.length).toBeGreaterThan(0);
        for (const type of types) {
          expect(consumer).toContain(`case "${type}":`);
        }
      });
    });
  }

  it("keys a dedupe on the thing, never on the moment of sending", () => {
    for (const producer of PRODUCERS) {
      const text = source(producer.file);
      const at = text.indexOf("enqueueNotification(");
      const window = text.slice(at, at + 800);
      const key = /dedupeKey:\s*`([^`]*)`/.exec(window)?.[1] ?? "";
      // `Date.now()` and a fresh ISO stamp differ on every attempt, so nothing
      // would ever resolve to a duplicate and a retry would notify twice.
      expect(key).not.toContain("Date.now");
      expect(key).not.toContain("new Date");
    }
  });
});

describe("a re-submitted used listing", () => {
  const marketplace = source("src/lib/used-marketplace.server.ts");

  it("is announced again rather than deduped into silence", () => {
    /*
      Submitted, rejected, edited, submitted again: three separate things for
      the store to look at. Keyed on the listing id alone, the second and third
      would land on the first one's ledger row and never be sent. The key
      carries the transition's own timestamp — stamped once in
      `transitionListing`, shared with the event row — so one submission
      retried is one notification, and a later submission is its own.
    */
    expect(marketplace).toContain("used_listing_submitted:${listing.id}:${submittedAt}");
    expect(marketplace).toContain('if (to === "SUBMITTED") await notifyStore(listing, now);');
  });
});

describe("the primary admin chat id", () => {
  const notifications = source("src/lib/telegram-notifications.server.ts");

  it("is one id, even when several operators are configured", async () => {
    /*
      `TELEGRAM_ADMIN_CHAT_ID` may name several operators, comma separated —
      that is what authorisation has always read. This function returned the
      raw setting, so a second operator turned the fallback route's chat id
      into "111111111, 222222222" and Telegram answered "Bad Request: chat not
      found". Every notification would have been lost for as long as the admin
      group binding was missing, which is exactly when the fallback matters.
    */
    const { publishEnv } = await import("./env.server");
    publishEnv({ TELEGRAM_ADMIN_CHAT_ID: "111111111, 222222222" });
    const { getAdminTelegramChatId } = await import("./telegram-notifications.server");
    expect(getAdminTelegramChatId()).toBe("111111111");
  });

  it("parses the setting in one place", () => {
    // Not its own splitting rule beside `telegramAdminIds()`: two readings of
    // one setting is how they drift apart.
    expect(notifications).toContain("telegramAdminIds()[0]");
  });
});
