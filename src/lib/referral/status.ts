/**
 * The two state machines the referral programme runs on.
 *
 * An *attribution* is the claim that this visitor arrived through someone's
 * link. A *reward* is the money that claim eventually becomes. They are
 * separate because an attribution can be captured months before an order and
 * can expire without ever producing one, while a reward only exists once an
 * order does — and must never be paid twice for the same order line.
 */

/**
 * Where an attribution can be in its life.
 *
 * - `pending`  — captured, or a code typed in, with no qualifying order yet.
 * - `reserved` — held for an order being placed right now, so two checkouts
 *                running at once cannot both spend the one lifetime discount.
 * - `used`     — the first qualifying order completed and the discount is gone.
 * - `rejected` — refused: abuse, or the purchase was never eligible.
 *
 * `expired` is kept because an attribution can simply run out of time without
 * ever having been any of the above.
 */
export type ReferralAttributionStatus =
  | "pending"
  | "reserved"
  | "used"
  | "rejected"
  | "expired";

/**
 * The names the first version of the programme wrote, and what each means now.
 *
 * Rows written before this change still hold these, and rewriting them in a
 * migration would be a data change for no gain — reading them through this map
 * is exact and costs nothing.
 */
const LEGACY_ATTRIBUTION_STATUS: Record<string, ReferralAttributionStatus> = {
  captured: "pending",
  eligible: "pending",
  converted: "used",
  blocked: "rejected",
};

/** A stored status, old or new, as one of the four current names. */
export function normalizeAttributionStatus(value: unknown): ReferralAttributionStatus {
  const text = typeof value === "string" ? value.trim() : "";
  if ((ATTRIBUTION_STATUSES as readonly string[]).includes(text)) {
    return text as ReferralAttributionStatus;
  }
  const legacy = LEGACY_ATTRIBUTION_STATUS[text];
  /*
    An unreadable status is `rejected`, never `pending`: a row nobody can
    interpret must not be worth a discount.
  */
  return legacy ?? "rejected";
}

/** Where a reward can be in its life. */
export type ReferralRewardStatus =
  | "eligible"
  | "pending"
  | "approved"
  | "blocked"
  | "reversed"
  | "expired";

export const ATTRIBUTION_STATUSES: readonly ReferralAttributionStatus[] = [
  "pending",
  "reserved",
  "used",
  "rejected",
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
  /*
    `reserved` can go back to `pending`: an order that is abandoned or
    cancelled before it completes must hand the discount back, or a customer
    loses it to a sale that never happened.
  */
  pending: ["reserved", "used", "rejected", "expired"],
  reserved: ["used", "pending", "rejected", "expired"],
  used: ["rejected"],
  rejected: [],
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
