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
 * the discount and the other is told there is none.
 *
 * The referrer guard reads "NULL, or already this same referrer". It used to
 * be `IS NULL` alone, which was right only while nothing recorded a referrer
 * before checkout — and the moment signup began recording one (which is what
 * the shop asks for: bound when they register, not when they first buy) that
 * clause could never be satisfied and every referred order silently lost its
 * discount. Accepting the same referrer keeps both guarantees that mattered:
 * a *different* link still cannot take a member off the person who brought
 * them, and `referral_discount_used_at IS NULL` is still the one that decides
 * a race.
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
          AND (referred_by_user_id IS NULL OR referred_by_user_id = ?)`,
      now,
      orderId,
      referrerUserId,
      userId,
      referrerUserId,
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
 * Was this account brand new when it followed the link?
 *
 * The programme is for bringing *new* customers in, so the only person a
 * referral may pay for is one who had no account at the moment they clicked.
 * Three ways an account fails that, and each is checked against the record
 * rather than trusted from the browser:
 *
 *   1. the account already existed when the link was opened — the surest
 *      signal there is, because it is the literal statement of the rule;
 *   2. the account is already bound to a referrer — one member is brought in
 *      by one person, for ever, and a second link cannot take them off the
 *      first;
 *   3. the account has ordered before — a returning customer, whatever their
 *      row says about referrers.
 *
 * A missing or unparseable `created_at` is treated as *not* new. An account
 * whose age cannot be established is exactly the case where paying out would
 * be a guess, and refusing costs a discount while paying wrongly costs money
 * and the rule.
 */
export interface NewReferralCheck {
  ok: boolean;
  reason?: "account_predates_link" | "already_referred" | "existing_customer" | "unknown_account";
}

export async function checkReferredAccountIsNew(
  userId: string,
  capturedAt: string,
): Promise<NewReferralCheck> {
  if (!userId) return { ok: false, reason: "unknown_account" };
  try {
    const row = await d1First<Record<string, unknown>>(
      `SELECT created_at, referred_by_user_id FROM users WHERE id = ? LIMIT 1`,
      userId,
    );
    if (!row) return { ok: false, reason: "unknown_account" };

    if (text(row["referred_by_user_id"])) return { ok: false, reason: "already_referred" };

    const created = Date.parse(String(row["created_at"] ?? ""));
    const clicked = Date.parse(capturedAt);
    if (!Number.isFinite(created)) return { ok: false, reason: "unknown_account" };
    /*
      A little slack, because the two stamps are written by different requests.

      Registration captures and creates within seconds of each other, and the
      attribution is always written first — but clock skew between isolates,
      and a visitor who lands and signs up in one motion, can put the account a
      moment "before" the click. Thirty seconds is far below the time any real
      returning customer's account predates a link by, and comfortably above
      any skew.
    */
    const SLACK_MS = 30_000;
    if (Number.isFinite(clicked) && created < clicked - SLACK_MS) {
      return { ok: false, reason: "account_predates_link" };
    }

    const priorOrder = await d1First<Record<string, unknown>>(
      `SELECT id FROM orders WHERE user_id = ? LIMIT 1`,
      userId,
    );
    if (priorOrder?.["id"]) return { ok: false, reason: "existing_customer" };

    return { ok: true };
  } catch (error) {
    /*
      A failed lookup refuses. Everywhere else in this shop a failed check
      allows, because the cost is a message nobody reads; here the cost is
      money paid on a rule that was never established.
    */
    console.warn("[referral:new_account_check_failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "unknown_account" };
  }
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
