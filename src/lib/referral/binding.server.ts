/**
 * The referral facts that belong to a member rather than to a link.
 *
 * Three columns on `users` carry the whole of the programme's memory:
 *
 * - `referred_by_user_id`      — who brought them in. Written once, never again.
 * - `referral_discount_used_at` — when they spent their one lifetime discount.
 * - `first_referral_order_id`  — the order that spent it.
 *
 * They live on the member, not on the attribution, because that is where the
 * rules actually are. The discount is once per account for ever; the referrer
 * keeps earning on every later qualifying order the member places, years after
 * the link, the cookie and the attribution row have all gone. An attribution is
 * only how a binding gets established — this is the binding.
 */

import { d1First, d1Run } from "../d1.server";

export interface ReferralBinding {
  /** The permanent referrer, or empty until a first qualifying order lands. */
  referrerUserId: string;
  /** When the one lifetime discount was taken; empty while it is still free. */
  discountUsedAt: string;
  /** The order that took it. */
  firstOrderId: string;
}

const EMPTY: ReferralBinding = { referrerUserId: "", discountUsedAt: "", firstOrderId: "" };

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/** What the database says about one member's referral history. */
export async function referralBinding(userId: string): Promise<ReferralBinding> {
  if (!userId) return EMPTY;
  try {
    const row = await d1First<Record<string, unknown>>(
      `SELECT referred_by_user_id, referral_discount_used_at, first_referral_order_id
         FROM users WHERE id = ? LIMIT 1`,
      userId,
    );
    if (!row) return EMPTY;
    return {
      referrerUserId: text(row["referred_by_user_id"]),
      discountUsedAt: text(row["referral_discount_used_at"]),
      firstOrderId: text(row["first_referral_order_id"]),
    };
  } catch {
    /*
      Unreadable means "no discount", never "free discount". A database that
      cannot answer must not be read as an account that has never claimed.
    */
    return { ...EMPTY, discountUsedAt: "unknown" };
  }
}

/** Has this member already spent the once-in-a-lifetime discount? */
export function hasSpentDiscount(binding: ReferralBinding): boolean {
  return Boolean(binding.discountUsedAt);
}

/**
 * May the cart still show a referral field to this member?
 *
 * Only while they have neither spent the discount nor been bound to anybody.
 * Once either is true the field is gone for good: a second code can change
 * nothing, so offering one would be a lie.
 */
export function canStillUseReferral(binding: ReferralBinding): boolean {
  return !binding.discountUsedAt && !binding.referrerUserId;
}

export interface ClaimResult {
  /** True only for the one checkout that won the discount. */
  claimed: boolean;
  /** The referrer the member is now permanently bound to. */
  referrerUserId: string;
}

/**
 * Take the one lifetime discount, and bind the referrer for good.
 *
 * A single conditional UPDATE, and the whole of the concurrency rule. Two
 * checkouts running at once both read "not used yet"; only one of them can
 * satisfy `referral_discount_used_at IS NULL` in the write, so only one gets
 * the discount and the other is told there is none. The same statement writes
 * `referred_by_user_id` under `IS NULL`, which is what makes the binding
 * permanent — a later link finds the column already set and cannot move it.
 *
 * Both guards are in the WHERE clause rather than checked first in JavaScript,
 * because a check and a write that are not the same statement are a race.
 */
export async function claimFirstReferralDiscount(params: {
  userId: string;
  referrerUserId: string;
  orderId: string;
  now: string;
}): Promise<ClaimResult> {
  const { userId, referrerUserId, orderId, now } = params;
  if (!userId || !referrerUserId || userId === referrerUserId) {
    return { claimed: false, referrerUserId: "" };
  }
  try {
    await d1Run(
      `UPDATE users
          SET referral_discount_used_at = ?,
              first_referral_order_id = ?,
              referred_by_user_id = COALESCE(referred_by_user_id, ?)
        WHERE id = ?
          AND referral_discount_used_at IS NULL
          AND referred_by_user_id IS NULL`,
      now,
      orderId,
      referrerUserId,
      userId,
    );
    /*
      Read back rather than trusting a driver's change count: D1 adapters
      differ on what they report, and paying a discount on a row that was not
      written is the one mistake this must not make.
    */
    const after = await referralBinding(userId);
    const claimed = after.firstOrderId === orderId && after.referrerUserId === referrerUserId;
    return { claimed, referrerUserId: after.referrerUserId };
  } catch (error) {
    console.warn("[referral:claim_failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { claimed: false, referrerUserId: "" };
  }
}

/**
 * Hand the discount back when the order that took it never happened.
 *
 * Cancelled or fully refunded, the member has not had their one discount, so
 * they get it back. The *binding* is untouched on purpose: the referrer stays
 * the person who brought them in whatever became of that first order, and the
 * rules say it can never be replaced.
 *
 * Scoped to the exact order id, so a later order that legitimately holds the
 * discount cannot be released by an older one being cancelled.
 */
export async function releaseReferralDiscount(orderId: string): Promise<void> {
  if (!orderId) return;
  await d1Run(
    `UPDATE users
        SET referral_discount_used_at = NULL, first_referral_order_id = NULL
      WHERE first_referral_order_id = ?`,
    orderId,
  ).catch((error) => {
    console.warn("[referral:release_failed]", {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * Bind a referrer to a member who is not buying yet.
 *
 * Used where a binding should exist but no discount is being spent — the
 * referrer is recorded so their 5% on later orders is never lost. Still
 * `IS NULL`-guarded, so it can only ever fill an empty binding.
 */
export async function bindReferrerIfUnbound(userId: string, referrerUserId: string): Promise<void> {
  if (!userId || !referrerUserId || userId === referrerUserId) return;
  await d1Run(
    `UPDATE users SET referred_by_user_id = ?
      WHERE id = ? AND referred_by_user_id IS NULL`,
    referrerUserId,
    userId,
  ).catch(() => undefined);
}
