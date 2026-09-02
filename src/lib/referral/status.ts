/**
 * The two state machines the referral programme runs on.
 *
 * An *attribution* is the claim that this visitor arrived through someone's
 * link. A *reward* is the money that claim eventually becomes. They are
 * separate because an attribution can be captured months before an order and
 * can expire without ever producing one, while a reward only exists once an
 * order does — and must never be paid twice for the same order line.
 */

/** Where an attribution can be in its life. */
export type ReferralAttributionStatus =
  | "captured"
  | "eligible"
  | "converted"
  | "blocked"
  | "expired";

/** Where a reward can be in its life. */
export type ReferralRewardStatus =
  | "eligible"
  | "pending"
  | "approved"
  | "blocked"
  | "reversed"
  | "expired";

export const ATTRIBUTION_STATUSES: readonly ReferralAttributionStatus[] = [
  "captured",
  "eligible",
  "converted",
  "blocked",
  "expired",
];

export const REWARD_STATUSES: readonly ReferralRewardStatus[] = [
  "eligible",
  "pending",
  "approved",
  "blocked",
  "reversed",
  "expired",
];

/**
 * Which reward transitions are legal.
 *
 * `approved` is deliberately terminal except for `reversed`: once the money is
 * in someone's wallet the only honest way back is an explicit reversal that
 * writes its own wallet entry, never a quiet flip back to `pending`.
 */
const REWARD_TRANSITIONS: Record<ReferralRewardStatus, readonly ReferralRewardStatus[]> = {
  eligible: ["pending", "blocked", "expired", "reversed"],
  pending: ["approved", "blocked", "reversed", "expired"],
  approved: ["reversed"],
  blocked: [],
  reversed: [],
  expired: [],
};

const ATTRIBUTION_TRANSITIONS: Record<
  ReferralAttributionStatus,
  readonly ReferralAttributionStatus[]
> = {
  captured: ["eligible", "converted", "blocked", "expired"],
  eligible: ["converted", "blocked", "expired"],
  converted: ["blocked"],
  blocked: [],
  expired: [],
};

export function isRewardStatus(value: unknown): value is ReferralRewardStatus {
  return typeof value === "string" && (REWARD_STATUSES as readonly string[]).includes(value);
}

export function isAttributionStatus(value: unknown): value is ReferralAttributionStatus {
  return typeof value === "string" && (ATTRIBUTION_STATUSES as readonly string[]).includes(value);
}

export function canTransitionReward(
  from: ReferralRewardStatus,
  to: ReferralRewardStatus,
): boolean {
  if (from === to) return false;
  return REWARD_TRANSITIONS[from].includes(to);
}

export function canTransitionAttribution(
  from: ReferralAttributionStatus,
  to: ReferralAttributionStatus,
): boolean {
  if (from === to) return false;
  return ATTRIBUTION_TRANSITIONS[from].includes(to);
}

/** A reward whose money is already in the referrer's wallet. */
export function isRewardPaid(status: ReferralRewardStatus): boolean {
  return status === "approved";
}

/** A reward that is still owed and could still be paid. */
export function isRewardOutstanding(status: ReferralRewardStatus): boolean {
  return status === "eligible" || status === "pending";
}
