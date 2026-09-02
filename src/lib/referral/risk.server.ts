/**
 * Why a referral is refused.
 *
 * Every check here runs on the server, on data the server fetched itself. The
 * browser contributes nothing that is believed: not the price, not the rate,
 * not the referrer, not the device. The customer is told one sentence — "this
 * code could not be applied to this purchase" — and the reason is written to
 * `referral_risk_events` for the admin screen, because telling an abuser which
 * signal caught them is telling them which one to change.
 *
 * The shape of every identity check is the same question: **is this identity
 * already attached to the referrer's account?** Device, address and guest
 * session are all recorded against an account the moment a signed-in member
 * touches a referral surface, so the comparison is against a history rather
 * than against a single moment — which is why buying from the referrer's phone
 * a week later is caught just as well as buying from it the same afternoon.
 */

import { randomId } from "../crypto.server";
import { d1All, d1First, d1Run } from "../d1.server";
import type { ReferralSettings } from "./config";
import { contactHashes, type ContactHashes } from "./identity.server";

/** Every way a referral can fail a check. */
export type ReferralRiskReason =
  | "self_referral"
  | "same_device"
  | "same_ip"
  | "same_phone"
  | "same_email"
  | "same_telegram"
  | "same_session"
  | "circular_referral"
  | "referrer_blocked"
  | "buyer_blocked"
  | "code_inactive"
  | "not_first_purchase"
  | "daily_invite_limit"
  | "daily_reward_cap"
  | "monthly_reward_cap"
  | "attribution_expired";

/**
 * What each signal costs.
 *
 * Every one of these is on its own enough to refuse — they are all listed in
 * the programme's rules as prohibitions, not as hints — so the score is for
 * the admin's triage queue, not for the decision. It is what "Risk score" in
 * the admin screen shows and what sorts the review list.
 */
const WEIGHTS: Record<ReferralRiskReason, number> = {
  self_referral: 100,
  same_device: 90,
  same_ip: 70,
  same_phone: 90,
  same_email: 90,
  same_telegram: 90,
  same_session: 90,
  circular_referral: 80,
  referrer_blocked: 100,
  buyer_blocked: 100,
  code_inactive: 100,
  not_first_purchase: 40,
  daily_invite_limit: 50,
  daily_reward_cap: 30,
  monthly_reward_cap: 30,
  attribution_expired: 40,
};

export interface ReferralRiskVerdict {
  blocked: boolean;
  score: number;
  reasons: ReferralRiskReason[];
  /** A stable, machine-readable summary stored on the reward row. */
  verdict: string;
}

export function scoreReasons(reasons: readonly ReferralRiskReason[]): number {
  return reasons.reduce((worst, reason) => Math.max(worst, WEIGHTS[reason] ?? 10), 0);
}

export function riskVerdict(reasons: readonly ReferralRiskReason[]): ReferralRiskVerdict {
  const unique = Array.from(new Set(reasons));
  return {
    blocked: unique.length > 0,
    score: scoreReasons(unique),
    reasons: unique,
    verdict: unique.length ? unique.join(",") : "clear",
  };
}

/** The kinds of identity the programme tracks against an account. */
export type IdentityKind = "device" | "ip" | "session";

export interface RiskParty {
  id: string;
  phone?: string | null;
  email?: string | null;
  telegramId?: string | null;
}

export interface AssessReferralInput {
  settings: ReferralSettings;
  referrer: RiskParty;
  /** Absent while the visitor is still a guest: only the code checks run. */
  buyer?: RiskParty;
  /** The buyer's identities right now, already hashed. */
  buyerDeviceHash?: string | null;
  buyerIpHash?: string | null;
  buyerSessionHash?: string | null;
  /** What was recorded when the link was opened. */
  attributionDeviceHash?: string | null;
  attributionIpHash?: string | null;
  attributionSessionHash?: string | null;
  attributionExpiresAt?: string | null;
  now?: Date;
}

/** Has the admin thrown this member out of the programme? */
export async function isBlockedFromProgramme(userId: string): Promise<boolean> {
  if (!userId) return false;
  const row = await d1First<{ user_id?: unknown }>(
    `SELECT user_id FROM referral_blocklist WHERE user_id = ? LIMIT 1`,
    userId,
  );
  return Boolean(row?.user_id);
}

/**
 * Record that this account has been seen under this identity.
 *
 * Idempotent per (kind, hash, account). Called on every referral surface a
 * signed-in member touches, which is what turns a single sighting into the
 * history the checks below read.
 */
export async function rememberIdentity(
  userId: string,
  kind: IdentityKind,
  identityHash: string | null | undefined,
): Promise<void> {
  if (!userId || !identityHash) return;
  const now = new Date().toISOString();
  await d1Run(
    `INSERT INTO referral_identity_links (id, kind, identity_hash, user_id, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, identity_hash, user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    randomId("ril"),
    kind,
    identityHash,
    userId,
    now,
    now,
  );
}

/** Remember every identity this request carries, in one go. */
export async function rememberRequestIdentities(
  userId: string,
  identities: { deviceHash?: string | null; ipHash?: string | null; sessionHash?: string | null },
): Promise<void> {
  if (!userId) return;
  await Promise.all([
    rememberIdentity(userId, "device", identities.deviceHash),
    rememberIdentity(userId, "ip", identities.ipHash),
    rememberIdentity(userId, "session", identities.sessionHash),
  ]).catch((error) => {
    console.warn("[referral:identity_link_failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/** Every account an identity has been seen on. */
export async function accountsForIdentity(
  kind: IdentityKind,
  identityHash: string,
): Promise<string[]> {
  if (!identityHash) return [];
  const rows = await d1All<{ user_id?: unknown }>(
    `SELECT user_id FROM referral_identity_links WHERE kind = ? AND identity_hash = ?`,
    kind,
    identityHash,
  );
  return rows.map((row) => String(row.user_id ?? "")).filter(Boolean);
}

/**
 * How many identity hashes one check may compare at once.
 *
 * The callers pass two — the one in front of us now and the one recorded when
 * the link was opened — but the placeholder list is built from an array, and
 * D1 refuses a statement carrying more than a hundred bound parameters. The
 * bound is written here rather than left to the callers so it cannot drift.
 */
const MAX_IDENTITY_COMPARISONS = 8;

/** Is any of these identities already attached to that account? */
async function identityBelongsTo(
  userId: string,
  kind: IdentityKind,
  hashes: (string | null | undefined)[],
): Promise<boolean> {
  const wanted = Array.from(
    new Set(hashes.filter((hash): hash is string => Boolean(hash))),
  ).slice(0, MAX_IDENTITY_COMPARISONS);
  if (!userId || wanted.length === 0) return false;
  const placeholders = wanted.map(() => "?").join(", ");
  const row = await d1First<{ total?: number }>(
    `SELECT COUNT(*) AS total FROM referral_identity_links
      WHERE user_id = ? AND kind = ? AND identity_hash IN (${placeholders})`,
    userId,
    kind,
    ...wanted,
  );
  return Number(row?.total ?? 0) > 0;
}

/**
 * The member's Telegram identity, from the table that actually holds it.
 *
 * `User.telegramId` is not populated by the D1 user mapper — the link lives in
 * `telegram_links`, which is what every other Telegram feature reads. Taking
 * the field at face value here would have made the "same Telegram account"
 * rule compare two undefineds and never fire.
 */
async function telegramIdentity(party: RiskParty): Promise<string> {
  if (party.telegramId) return String(party.telegramId);
  try {
    const row = await d1First<{ telegram_chat_id?: unknown; telegram_user_id?: unknown }>(
      `SELECT telegram_chat_id, telegram_user_id FROM telegram_links WHERE user_id = ?`,
      party.id,
    );
    /*
      `telegram_user_id` is the person; `telegram_chat_id` is the conversation.
      The person is what has to be compared — and the chat id is unique per
      store account anyway, so comparing that could never find a match.
    */
    return String(row?.telegram_user_id ?? row?.telegram_chat_id ?? "");
  } catch {
    // A deployment without the table: no Telegram identity to compare.
    return "";
  }
}

/** Does the buyer already have a referral reward behind them? */
async function hasEarnedBefore(buyerUserId: string): Promise<boolean> {
  const row = await d1First<{ total?: number }>(
    `SELECT COUNT(*) AS total FROM referral_rewards
      WHERE buyer_user_id = ? AND status IN ('pending', 'approved')`,
    buyerUserId,
  );
  return Number(row?.total ?? 0) > 0;
}

/** A referred B before: paying B for referring A back closes the loop. */
async function isCircular(referrerUserId: string, buyerUserId: string): Promise<boolean> {
  const row = await d1First<{ total?: number }>(
    `SELECT COUNT(*) AS total FROM referral_attributions
      WHERE referrer_user_id = ? AND referred_user_id = ?
        AND status IN ('captured', 'eligible', 'converted')`,
    buyerUserId,
    referrerUserId,
  );
  return Number(row?.total ?? 0) > 0;
}

/**
 * An identity comparison that treats "unknown" as "no match".
 *
 * Two accounts with no phone number on file both hash to the empty string, and
 * calling that a match would block every honest referral between two members
 * who signed up with an email.
 */
function sameHash(left: string | null | undefined, right: string | null | undefined): boolean {
  return Boolean(left) && Boolean(right) && left === right;
}

/** Push a reason for every contact detail the two accounts share. */
function compareContacts(
  referrer: ContactHashes,
  buyer: ContactHashes,
  reasons: ReferralRiskReason[],
): void {
  if (sameHash(referrer.phoneHash, buyer.phoneHash)) reasons.push("same_phone");
  if (sameHash(referrer.emailHash, buyer.emailHash)) reasons.push("same_email");
  if (sameHash(referrer.telegramHash, buyer.telegramHash)) reasons.push("same_telegram");
}

/**
 * Run every identity check.
 *
 * This is the gate for capture, for applying a code in the cart and for
 * pricing at checkout — the same verdict at every stage, so a referral cannot
 * be waved through at one and paid at another. The counting rules that need a
 * price live in `checkProgrammeLimits`.
 */
export async function assessReferralRisk(
  input: AssessReferralInput,
): Promise<ReferralRiskVerdict> {
  const now = input.now ?? new Date();
  const reasons: ReferralRiskReason[] = [];

  if (input.attributionExpiresAt) {
    const expiry = Date.parse(input.attributionExpiresAt);
    if (Number.isFinite(expiry) && expiry <= now.getTime()) reasons.push("attribution_expired");
  }

  const referrerId = input.referrer.id;
  if (!referrerId) return riskVerdict(reasons);

  if (await isBlockedFromProgramme(referrerId)) reasons.push("referrer_blocked");

  /*
    The device, address and session checks do not need the buyer to have an
    account — they are what stops somebody opening their own link in a private
    window and signing up. They compare the identities in front of us now, and
    the ones recorded when the link was opened, against everything the
    *referrer's* account has ever been seen under.
  */
  const [sameDevice, sameIp, sameSession] = await Promise.all([
    identityBelongsTo(referrerId, "device", [input.buyerDeviceHash, input.attributionDeviceHash]),
    identityBelongsTo(referrerId, "ip", [input.buyerIpHash, input.attributionIpHash]),
    identityBelongsTo(referrerId, "session", [
      input.buyerSessionHash,
      input.attributionSessionHash,
    ]),
  ]);
  if (sameDevice) reasons.push("same_device");
  if (sameIp) reasons.push("same_ip");
  if (sameSession) reasons.push("same_session");

  const buyer = input.buyer;
  if (!buyer?.id) return riskVerdict(reasons);

  if (referrerId === buyer.id) reasons.push("self_referral");

  const [buyerBlocked, circular, referrerTelegram, buyerTelegram] = await Promise.all([
    isBlockedFromProgramme(buyer.id),
    isCircular(referrerId, buyer.id),
    telegramIdentity(input.referrer),
    telegramIdentity(buyer),
  ]);
  const [referrerContacts, buyerContacts] = await Promise.all([
    contactHashes({ ...input.referrer, telegramId: referrerTelegram }),
    contactHashes({ ...buyer, telegramId: buyerTelegram }),
  ]);

  if (buyerBlocked) reasons.push("buyer_blocked");
  if (circular) reasons.push("circular_referral");
  compareContacts(referrerContacts, buyerContacts, reasons);

  return riskVerdict(reasons);
}

export interface ProgrammeLimitsInput {
  settings: ReferralSettings;
  referrerUserId: string;
  buyerUserId: string;
  rewardIqd: number;
  now?: Date;
}

/** How many friends this member has brought in since midnight UTC. */
async function invitesToday(referrerUserId: string, now: Date): Promise<number> {
  const since = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
  const row = await d1First<{ total?: number }>(
    `SELECT COUNT(DISTINCT COALESCE(referred_user_id, guest_session_hash)) AS total
       FROM referral_attributions
      WHERE referrer_user_id = ? AND captured_at >= ?`,
    referrerUserId,
    since,
  );
  return Number(row?.total ?? 0);
}

/** What this member has already earned in a window, approved or awaiting. */
async function earnedSince(referrerUserId: string, sinceIso: string): Promise<number> {
  const row = await d1First<{ total?: number }>(
    `SELECT COALESCE(SUM(referrer_reward_iqd - reversed_amount_iqd), 0) AS total
       FROM referral_rewards
      WHERE referrer_user_id = ? AND created_at >= ? AND status IN ('pending', 'approved')`,
    referrerUserId,
    sinceIso,
  );
  return Number(row?.total ?? 0);
}

/**
 * The counting rules: first purchase only, the invite limit, the earning caps.
 *
 * Separate from `assessReferralRisk` because these need the reward amount and
 * therefore only apply once there is a price — but they are the same kind of
 * refusal and produce the same reasons.
 */
export async function checkProgrammeLimits(
  input: ProgrammeLimitsInput,
): Promise<ReferralRiskReason[]> {
  const now = input.now ?? new Date();
  const reasons: ReferralRiskReason[] = [];

  if (input.settings.firstPurchaseOnly && (await hasEarnedBefore(input.buyerUserId))) {
    reasons.push("not_first_purchase");
  }

  if (input.settings.dailyInviteLimit > 0) {
    const invites = await invitesToday(input.referrerUserId, now);
    if (invites > input.settings.dailyInviteLimit) reasons.push("daily_invite_limit");
  }

  if (input.settings.dailyRewardCapIqd > 0) {
    const since = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString();
    if ((await earnedSince(input.referrerUserId, since)) + input.rewardIqd >
      input.settings.dailyRewardCapIqd) {
      reasons.push("daily_reward_cap");
    }
  }

  if (input.settings.monthlyRewardCapIqd > 0) {
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    if ((await earnedSince(input.referrerUserId, since)) + input.rewardIqd >
      input.settings.monthlyRewardCapIqd) {
      reasons.push("monthly_reward_cap");
    }
  }

  return reasons;
}

export interface RiskEventInput {
  attributionId?: string | null;
  rewardId?: string | null;
  orderId?: string | null;
  referrerUserId?: string | null;
  buyerUserId?: string | null;
  eventType: string;
  riskScore?: number;
  deviceHash?: string | null;
  ipHash?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Write one line of the audit trail.
 *
 * Never throws: a referral that could not be logged is still a referral that
 * was correctly refused, and losing a checkout over a log write would be the
 * worse failure. The metadata carries reasons and ids only — never an address,
 * a device string or a contact detail.
 */
export async function recordRiskEvent(input: RiskEventInput): Promise<void> {
  try {
    await d1Run(
      `INSERT INTO referral_risk_events (
         id, attribution_id, reward_id, order_id, referrer_user_id, buyer_user_id,
         event_type, risk_score, device_hash, ip_hash, metadata, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomId("rre"),
      input.attributionId ?? null,
      input.rewardId ?? null,
      input.orderId ?? null,
      input.referrerUserId ?? null,
      input.buyerUserId ?? null,
      input.eventType,
      Math.max(0, Math.min(100, Math.floor(input.riskScore ?? 0))),
      input.deviceHash ?? null,
      input.ipHash ?? null,
      JSON.stringify(input.metadata ?? {}),
      new Date().toISOString(),
    );
  } catch (error) {
    console.warn("[referral:risk_event_failed]", {
      eventType: input.eventType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
