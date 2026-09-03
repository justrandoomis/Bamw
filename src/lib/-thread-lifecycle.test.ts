/**
 * @vitest-environment node
 */
/**
 * What may be deleted, and — much more importantly — what may not.
 *
 * Every case below is one where getting it wrong destroys something a person
 * would expect to still be there: a record of an order, a conversation with a
 * human, or what the shop itself said to a customer.
 */

import { describe, expect, it } from "vitest";
import {
  BOT_THREAD_TTL_MS,
  expiryFor,
  hasExpired,
  isExpirable,
  threadKind,
  visibleThreads,
} from "./thread-lifecycle";

const NOW = new Date("2026-09-03T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

const bot = {
  chatType: "AUTOMATED_SUPPORT" as const,
  lastMessageAt: hoursAgo(1),
};

describe("threadKind", () => {
  it("classifies on the field, never on the text", () => {
    expect(threadKind({ chatType: "AUTOMATED_SUPPORT" })).toBe("bot");
    expect(threadKind({ chatType: "GENERAL_SUPPORT" })).toBe("human_support");
    expect(threadKind({ chatType: "ORDER_SUPPORT" })).toBe("order");
    expect(threadKind({ chatType: "DELIVERY" })).toBe("order");
  });

  it("treats an order link as decisive", () => {
    // A thread attached to an order is an order thread whatever else has
    // happened in it — including having been the bot's at some point.
    expect(threadKind({ chatType: "AUTOMATED_SUPPORT", orderId: "ord_1" })).toBe("order");
  });

  it("treats anything unrecognised as human support", () => {
    // The safe direction: human support is never deleted.
    expect(threadKind({ chatType: "SUPPORT" as never })).toBe("human_support");
    expect(threadKind({})).toBe("human_support");
  });
});

describe("isExpirable", () => {
  it("expires only the assistant's own threads", () => {
    expect(isExpirable(bot)).toBe(true);
    expect(isExpirable({ chatType: "GENERAL_SUPPORT" })).toBe(false);
    expect(isExpirable({ chatType: "ORDER_SUPPORT" })).toBe(false);
    expect(isExpirable({ chatType: "AUTOMATED_SUPPORT", orderId: "ord_1" })).toBe(false);
  });

  it("never expires one that reached a person", () => {
    expect(isExpirable({ ...bot, mode: "ESCALATED" })).toBe(false);
    expect(isExpirable({ ...bot, mode: "ADMIN_ACTIVE" })).toBe(false);
    expect(isExpirable({ ...bot, needsAdmin: true })).toBe(false);
    expect(isExpirable({ ...bot, humanRequested: true })).toBe(false);
  });

  it("never expires one an admin has written in", () => {
    /*
      The subtle one. A conversation can be escalated, answered and closed
      without the kind ever changing, so it is still `bot` by label — and what
      the shop said to a customer is not ours to delete.
    */
    expect(isExpirable({ ...bot, lastAdminMessageAt: hoursAgo(30) })).toBe(false);
  });
});

describe("expiry", () => {
  it("is 24 hours after the last message", () => {
    const expires = expiryFor(bot, NOW)!;
    expect(Date.parse(expires) - Date.parse(bot.lastMessageAt)).toBe(BOT_THREAD_TTL_MS);
  });

  it("is absent for a thread that never expires, not merely far away", () => {
    // An absent value has to mean "keeps for ever" unambiguously, so nothing
    // downstream can read "not computed yet" as "due for deletion".
    expect(expiryFor({ chatType: "GENERAL_SUPPORT" }, NOW)).toBeUndefined();
  });

  it("is pushed out by every new message", () => {
    const stale = { ...bot, lastMessageAt: hoursAgo(23) };
    expect(hasExpired(stale, NOW)).toBe(false);
    const fresh = { ...bot, lastMessageAt: hoursAgo(0) };
    expect(Date.parse(expiryFor(fresh, NOW)!)).toBeGreaterThan(
      Date.parse(expiryFor(stale, NOW)!),
    );
  });

  it("expires at 24 hours and one moment, not before", () => {
    expect(hasExpired({ ...bot, lastMessageAt: hoursAgo(23.9) }, NOW)).toBe(false);
    expect(hasExpired({ ...bot, lastMessageAt: hoursAgo(24.1) }, NOW)).toBe(true);
  });
});

describe("visibleThreads", () => {
  it("keeps orders and human support, drops only stale bot threads", () => {
    const threads = [
      { id: "t_order", chatType: "ORDER_SUPPORT" as const, orderId: "o1", lastMessageAt: hoursAgo(500) },
      { id: "t_human", chatType: "GENERAL_SUPPORT" as const, lastMessageAt: hoursAgo(500) },
      { id: "t_bot_old", chatType: "AUTOMATED_SUPPORT" as const, lastMessageAt: hoursAgo(48) },
      { id: "t_bot_new", chatType: "AUTOMATED_SUPPORT" as const, lastMessageAt: hoursAgo(2) },
      {
        id: "t_bot_answered",
        chatType: "AUTOMATED_SUPPORT" as const,
        lastMessageAt: hoursAgo(400),
        lastAdminMessageAt: hoursAgo(399),
      },
    ];
    expect(visibleThreads(threads, NOW).map((t) => t.id)).toEqual([
      "t_order",
      "t_human",
      "t_bot_new",
      "t_bot_answered",
    ]);
  });
});
