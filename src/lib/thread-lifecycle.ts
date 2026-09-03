/**
 * Which conversations a member keeps, and which the assistant's own expire.
 *
 * ## The three kinds
 *
 * `chatType` already distinguishes them and is set explicitly at creation, so
 * nothing here reads a subject line or a message body to decide what a thread
 * is. That matters: a title-based rule would delete a support ticket whose
 * customer happened to phrase it like a question for the bot.
 *
 * ## What expires
 *
 * Only the assistant's own threads — `AUTOMATED_SUPPORT` with no order behind
 * it — and only 24 hours after the last thing said in them. Every message
 * pushes that out again, so an active conversation never disappears mid-way.
 *
 * ## What never expires
 *
 * An order thread, a human support thread, an escalated one, and one an admin
 * has actually written in. The last is the subtle one: a thread can still be
 * `AUTOMATED_SUPPORT` by kind and have a person's message in it, and deleting
 * that would destroy a record of what the shop told a customer.
 */

import type { Thread } from "./types";

/** 24 hours, in milliseconds. */
export const BOT_THREAD_TTL_MS = 24 * 60 * 60 * 1000;

export type ThreadKind = "bot" | "human_support" | "order";

/**
 * What kind of conversation this is, for the member's list and the cleanup.
 *
 * Order wins over everything: a thread attached to an order is an order
 * thread whatever else has happened in it.
 */
export function threadKind(thread: Pick<Thread, "chatType" | "orderId">): ThreadKind {
  if (thread.orderId) return "order";
  if (thread.chatType === "ORDER_SUPPORT" || thread.chatType === "DELIVERY") return "order";
  if (thread.chatType === "AUTOMATED_SUPPORT") return "bot";
  // GENERAL_SUPPORT, the legacy "SUPPORT", and anything unrecognised.
  return "human_support";
}

/**
 * May this thread ever be expired?
 *
 * Deliberately a list of reasons to keep rather than a single test, because
 * every one of them is a case where deleting would lose something a person
 * would expect to still be there.
 */
export function isExpirable(
  thread: Pick<
    Thread,
    "chatType" | "orderId" | "mode" | "needsAdmin" | "humanRequested" | "lastAdminMessageAt"
  >,
): boolean {
  if (threadKind(thread) !== "bot") return false;
  // Handed to a person, or waiting to be.
  if (thread.mode === "ESCALATED" || thread.mode === "ADMIN_ACTIVE") return false;
  if (thread.needsAdmin || thread.humanRequested) return false;
  /*
    An admin has written in it. The kind may still say `bot` — a conversation
    can be escalated, answered and closed without the label ever changing —
    and what the shop said to a customer is not ours to delete.
  */
  if (thread.lastAdminMessageAt) return false;
  return true;
}

/**
 * When this thread should drop out of the member's list.
 *
 * Returns nothing for a thread that never expires, so an absent `expiresAt` is
 * unambiguous: it means "keeps for ever", not "nobody has computed it yet".
 */
export function expiryFor(
  thread: Parameters<typeof isExpirable>[0] & { lastMessageAt?: string },
  now = new Date(),
): string | undefined {
  if (!isExpirable(thread)) return undefined;
  const last = thread.lastMessageAt ? Date.parse(thread.lastMessageAt) : NaN;
  const base = Number.isFinite(last) ? last : now.getTime();
  return new Date(base + BOT_THREAD_TTL_MS).toISOString();
}

/** Has this thread's 24 hours run out? */
export function hasExpired(
  thread: Parameters<typeof expiryFor>[0],
  now = new Date(),
): boolean {
  const expires = expiryFor(thread, now);
  if (!expires) return false;
  return Date.parse(expires) <= now.getTime();
}

/**
 * The threads a member should see in "محادثاتي السابقة".
 *
 * Order and human-support threads always; assistant threads only inside their
 * 24 hours. Filtered on read as well as swept by the cron, so the list is
 * right the moment the clock passes rather than the next time the job runs.
 */
export function visibleThreads<T extends Parameters<typeof expiryFor>[0]>(
  threads: T[],
  now = new Date(),
): T[] {
  return threads.filter((thread) => !hasExpired(thread, now));
}
