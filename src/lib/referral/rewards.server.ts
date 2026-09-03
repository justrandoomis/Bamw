/**
 * The money half of the referral programme.
 *
 * A reward is written when the order is, approved only when the order is
 * finished, and reversed if it is cancelled or refunded. Three properties hold
 * throughout, and each one is a database constraint rather than a promise made
 * in code:
 *
 * - **One reward per order, one per order line.** Two unique indexes on
 *   `referral_rewards`. Re-submitting a checkout, or a retried write, cannot
 *   produce a second reward.
 * - **One wallet credit per reward.** The unique index on
 *   `wallet_transactions (reference_type, reference_id)` — keyed to the order
 *   and the game, exactly as specified — is the idempotency key. Approving
 *   twice inserts nothing the second time.
 * - **The credit and the balance move together.** Both are in one D1 batch,
 *   with the ledger row guarded by `changes() = 1`, so a balance that did not
 *   move cannot leave a ledger line saying it did.
 */

import { randomId } from "../crypto.server";
import { d1All, d1Batch, d1First, d1Run } from "../db.server";
import type { Order } from "../types";
import { getReferralSettings } from "./service.server";
import { reversalAmount } from "./money";
import { toReferralReward, type ReferralReward } from "./rows";
import { recordRiskEvent } from "./risk.server";
import { canTransitionReward } from "./status";

/** The idempotency key for a reward's wallet movement: the order and the game. */
export function rewardIdempotencyKey(orderId: string, productId: string): string {
  return `${orderId}:${productId}`;
}

export interface CreateRewardInput {
  orderId: string;
  orderItemId: string;
  productId: string;
  attributionId?: string | null;
  referralCodeId?: string | null;
  referralCode?: string | null;
  referrerUserId: string;
  buyerUserId: string;
  originalPriceIqd: number;
  buyerDiscountIqd: number;
  referrerRewardIqd: number;
  buyerPercentBps: number;
  referrerPercentBps: number;
  riskScore: number;
  riskVerdict: string;
  /** Paid orders start `pending`; unpaid ones wait at `eligible`. */
  paid: boolean;
  holdDays?: number;
  now?: string;
}

const REWARD_COLUMNS = `id, attribution_id, order_id, order_item_id, product_id,
            referrer_user_id, buyer_user_id, referral_code_id, referral_code,
            original_price_iqd, buyer_discount_iqd, referrer_reward_iqd,
            reversed_amount_iqd, buyer_percent_bps, referrer_percent_bps,
            status, risk_score, risk_verdict, hold_until, created_at, updated_at`;

/** The twenty-one values, with the always-zero reversal amount inline. */
const REWARD_VALUES = `?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?`;

/**
 * The statement that writes a reward.
 *
 * Two forms of the same insert. `sql` is the plain one; `chainedSql` is the
 * `INSERT … SELECT … WHERE changes() = 1` form, which is how a statement joins
 * a D1 batch that is already chained — checkout commits the reward in the same
 * batch as the wallet debit, so the discount and the reward stand or fall
 * together.
 */
export function insertRewardStatement(input: CreateRewardInput): {
  id: string;
  sql: string;
  chainedSql: string;
  params: unknown[];
} {
  const now = input.now ?? new Date().toISOString();
  const id = randomId("rrw");
  const holdDays = Math.max(0, Math.floor(input.holdDays ?? 0));
  const holdUntil = holdDays
    ? new Date(Date.parse(now) + holdDays * 24 * 60 * 60 * 1000).toISOString()
    : null;
  return {
    id,
    sql: `INSERT INTO referral_rewards (${REWARD_COLUMNS}) VALUES (${REWARD_VALUES})`,
    chainedSql: `INSERT INTO referral_rewards (${REWARD_COLUMNS})
                 SELECT ${REWARD_VALUES} WHERE changes() = 1`,
    params: [
      id,
      input.attributionId ?? null,
      input.orderId,
      input.orderItemId,
      input.productId,
      input.referrerUserId,
      input.buyerUserId,
      input.referralCodeId ?? null,
      input.referralCode ?? null,
      Math.max(0, Math.floor(input.originalPriceIqd)),
      Math.max(0, Math.floor(input.buyerDiscountIqd)),
      Math.max(0, Math.floor(input.referrerRewardIqd)),
      Math.max(0, Math.floor(input.buyerPercentBps)),
      Math.max(0, Math.floor(input.referrerPercentBps)),
      input.paid ? "pending" : "eligible",
      Math.max(0, Math.min(100, Math.floor(input.riskScore))),
      input.riskVerdict,
      holdUntil,
      now,
      now,
    ],
  };
}

/** The rewards attached to one order. Usually one; never more than one. */
export async function rewardsForOrder(orderId: string): Promise<ReferralReward[]> {
  const rows = await d1All<Record<string, unknown>>(
    `SELECT * FROM referral_rewards WHERE order_id = ?`,
    orderId,
  );
  return rows.filter((row) => row["id"]).map(toReferralReward);
}

/** Mark the attribution spent, so a second order cannot use the same offer. */
export async function markAttributionConverted(
  attributionId: string | null | undefined,
  orderId: string,
): Promise<void> {
  if (!attributionId) return;
  const now = new Date().toISOString();
  await d1Run(
    `UPDATE referral_attributions
        SET status = 'used', converted_order_id = ?, converted_at = ?, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'reserved', 'captured', 'eligible')`,
    orderId,
    now,
    now,
    attributionId,
  ).catch((error) => {
    console.warn("[referral:mark_converted_failed]", {
      attributionId,
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * The order was paid: the reward moves from `eligible` to `pending`.
 *
 * Nothing reaches a wallet here — the reward is only owed once the order is
 * actually finished, which is what `approveRewardsForOrder` decides.
 */
export async function markRewardsPending(orderId: string): Promise<void> {
  const now = new Date().toISOString();
  await d1Run(
    `UPDATE referral_rewards SET status = 'pending', updated_at = ?
      WHERE order_id = ? AND status = 'eligible'`,
    now,
    orderId,
  );
}

export interface ApproveResult {
  approved: number;
  creditedIqd: number;
  skipped: number;
}

/**
 * The order is complete: pay the referrer, once.
 *
 * Safe to call on every completion, including a repeat: a reward that is no
 * longer `pending` is skipped, and the wallet insert is guarded by its own
 * unique key even if two isolates reach this line at the same moment.
 */
export async function approveRewardsForOrder(order: Order): Promise<ApproveResult> {
  const result: ApproveResult = { approved: 0, creditedIqd: 0, skipped: 0 };
  const rewards = await rewardsForOrder(order.id);
  if (!rewards.length) return result;

  const now = new Date();
  const nowIso = now.toISOString();

  for (const reward of rewards) {
    if (!canTransitionReward(reward.status, "approved")) {
      result.skipped += 1;
      continue;
    }
    if (reward.status !== "pending") {
      result.skipped += 1;
      continue;
    }
    /*
      A hold period, when the admin has set one, keeps the money out of the
      wallet until it has passed. The reward stays `pending`; the scheduled
      job picks it up later, so nothing is lost by refusing it now.
    */
    if (reward.holdUntil && Date.parse(reward.holdUntil) > now.getTime()) {
      result.skipped += 1;
      continue;
    }
    if (reward.referrerRewardIqd <= 0) {
      await d1Run(
        `UPDATE referral_rewards SET status = 'approved', approved_at = ?, updated_at = ?
          WHERE id = ? AND status = 'pending'`,
        nowIso,
        nowIso,
        reward.id,
      );
      result.approved += 1;
      continue;
    }

    const walletTxId = randomId("wtx");
    const reference = rewardIdempotencyKey(reward.orderId, reward.productId);

    /*
      Balance and ledger in one batch, ledger guarded by `changes() = 1`.

      The wallet row's unique `(reference_type, reference_id)` index is what
      makes a second attempt a no-op rather than a second payment — and because
      the balance update comes first, a duplicate run still moves the balance…
      which is why the *whole* batch is only entered for a reward that is still
      `pending`, and why the status update below is itself conditional on that.
    */
    const claimed = await d1Run(
      `UPDATE referral_rewards SET status = 'approved', approved_at = ?, updated_at = ?,
              wallet_transaction_id = ?
        WHERE id = ? AND status = 'pending'`,
      nowIso,
      nowIso,
      walletTxId,
      reward.id,
    )
      .then(async () => {
        const row = await d1First<{ status?: unknown; wallet_transaction_id?: unknown }>(
          `SELECT status, wallet_transaction_id FROM referral_rewards WHERE id = ?`,
          reward.id,
        );
        return String(row?.status ?? "") === "approved" &&
          String(row?.wallet_transaction_id ?? "") === walletTxId;
      })
      .catch(() => false);

    if (!claimed) {
      result.skipped += 1;
      continue;
    }

    try {
      await d1Batch([
        {
          sql: `UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + ? WHERE id = ?`,
          params: [reward.referrerRewardIqd, reward.referrerUserId],
        },
        {
          sql: `INSERT INTO wallet_transactions (
                  id, user_id, kind, amount, description, order_id,
                  reference_type, reference_id, created_at
                ) SELECT ?, ?, 'referral_reward', ?, ?, ?, 'referral_reward', ?, ?
                  WHERE changes() = 1`,
          params: [
            walletTxId,
            reward.referrerUserId,
            reward.referrerRewardIqd,
            `مكافأة إحالة — طلب ${order.code}`,
            reward.orderId,
            reference,
            nowIso,
          ],
        },
      ]);
      result.approved += 1;
      result.creditedIqd += reward.referrerRewardIqd;
    } catch (error) {
      /*
        The credit failed after the reward was claimed. Put it back to
        `pending` so the next completion pass — or the admin's button — tries
        again, rather than leaving a reward marked paid that never was.
      */
      await d1Run(
        `UPDATE referral_rewards SET status = 'pending', approved_at = NULL,
                wallet_transaction_id = NULL, updated_at = ?
          WHERE id = ? AND status = 'approved'`,
        nowIso,
        reward.id,
      ).catch(() => {});
      result.skipped += 1;
      console.error("[referral:reward_credit_failed]", {
        rewardId: reward.id,
        orderId: order.id,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    await recordRiskEvent({
      rewardId: reward.id,
      attributionId: reward.attributionId,
      orderId: reward.orderId,
      referrerUserId: reward.referrerUserId,
      buyerUserId: reward.buyerUserId,
      eventType: "reward_approved",
      riskScore: reward.riskScore,
      metadata: { amountIqd: reward.referrerRewardIqd, reference },
    });
  }

  return result;
}

export interface ReverseResult {
  reversed: number;
  debitedIqd: number;
}

/**
 * The order was cancelled or refunded: take the reward back.
 *
 * A reward still waiting is simply refused — no money moved, so nothing has to
 * come back. One already paid gets an explicit reversal in the wallet, keyed
 * the same way so it too can only happen once. A partial refund takes back the
 * same share of the reward as was returned to the buyer.
 */
export async function reverseRewardsForOrder(params: {
  order: Pick<Order, "id" | "code">;
  refundedIqd?: number;
  paidIqd?: number;
  reason?: string;
}): Promise<ReverseResult> {
  const result: ReverseResult = { reversed: 0, debitedIqd: 0 };
  const rewards = await rewardsForOrder(params.order.id);
  if (!rewards.length) return result;

  const nowIso = new Date().toISOString();

  for (const reward of rewards) {
    if (reward.status === "reversed" || reward.status === "blocked") continue;

    if (reward.status === "eligible" || reward.status === "pending") {
      await d1Run(
        `UPDATE referral_rewards
            SET status = 'reversed', reversed_at = ?, updated_at = ?, blocked_reason = ?
          WHERE id = ? AND status IN ('eligible', 'pending')`,
        nowIso,
        nowIso,
        params.reason ?? "order_cancelled",
        reward.id,
      );
      result.reversed += 1;
      await recordRiskEvent({
        rewardId: reward.id,
        orderId: reward.orderId,
        referrerUserId: reward.referrerUserId,
        buyerUserId: reward.buyerUserId,
        eventType: "reward_cancelled_before_payment",
        metadata: { reason: params.reason ?? "order_cancelled" },
      });
      continue;
    }

    if (reward.status !== "approved") continue;

    const takeBack = reversalAmount(
      reward.referrerRewardIqd - reward.reversedAmountIqd,
      params.refundedIqd ?? 0,
      params.paidIqd ?? 0,
    );
    const amount =
      params.refundedIqd === undefined || params.paidIqd === undefined
        ? reward.referrerRewardIqd - reward.reversedAmountIqd
        : takeBack;
    if (amount <= 0) continue;

    /*
      Deduct what is there.

      If the referrer has already spent the reward the balance cannot go
      negative — a negative wallet would block their next purchase for a debt
      they were never told about. The shortfall is recorded on the reward row
      instead, where the admin screen shows it.
    */
    const balanceRow = await d1First<{ wallet_balance?: unknown }>(
      `SELECT wallet_balance FROM users WHERE id = ?`,
      reward.referrerUserId,
    );
    const balance = Math.max(0, Math.floor(Number(balanceRow?.wallet_balance ?? 0)));
    const applied = Math.min(amount, balance);
    const reference = `${rewardIdempotencyKey(reward.orderId, reward.productId)}:reversal`;

    try {
      await d1Batch([
        {
          sql: `UPDATE users SET wallet_balance = MAX(0, COALESCE(wallet_balance, 0) - ?) WHERE id = ?`,
          params: [applied, reward.referrerUserId],
        },
        {
          sql: `INSERT INTO wallet_transactions (
                  id, user_id, kind, amount, description, order_id,
                  reference_type, reference_id, created_at
                ) SELECT ?, ?, 'referral_reversal', ?, ?, ?, 'referral_reversal', ?, ?
                  WHERE changes() = 1`,
          params: [
            randomId("wtx"),
            reward.referrerUserId,
            -applied,
            `عكس مكافأة إحالة — طلب ${params.order.code}`,
            reward.orderId,
            reference,
            nowIso,
          ],
        },
      ]);
    } catch (error) {
      console.error("[referral:reward_reversal_failed]", {
        rewardId: reward.id,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const totalReversed = reward.reversedAmountIqd + amount;
    const fullyReversed = totalReversed >= reward.referrerRewardIqd;
    await d1Run(
      `UPDATE referral_rewards
          SET reversed_amount_iqd = ?, status = ?, reversed_at = ?, updated_at = ?, blocked_reason = ?
        WHERE id = ?`,
      totalReversed,
      fullyReversed ? "reversed" : "approved",
      nowIso,
      nowIso,
      params.reason ?? "order_refunded",
      reward.id,
    );

    result.reversed += 1;
    result.debitedIqd += applied;

    await recordRiskEvent({
      rewardId: reward.id,
      orderId: reward.orderId,
      referrerUserId: reward.referrerUserId,
      buyerUserId: reward.buyerUserId,
      eventType: "reward_reversed",
      metadata: {
        requestedIqd: amount,
        appliedIqd: applied,
        shortfallIqd: amount - applied,
        reason: params.reason ?? "order_refunded",
      },
    });
  }

  return result;
}

/** Refuse a reward outright — the admin's "block" button, and abuse found late. */
export async function blockReward(rewardId: string, reason: string): Promise<boolean> {
  const now = new Date().toISOString();
  const row = await d1First<Record<string, unknown>>(
    `SELECT * FROM referral_rewards WHERE id = ? LIMIT 1`,
    rewardId,
  );
  if (!row?.["id"]) return false;
  const reward = toReferralReward(row);
  if (!canTransitionReward(reward.status, "blocked")) return false;

  await d1Run(
    `UPDATE referral_rewards SET status = 'blocked', blocked_reason = ?, updated_at = ?
      WHERE id = ? AND status IN ('eligible', 'pending')`,
    reason,
    now,
    rewardId,
  );
  await recordRiskEvent({
    rewardId,
    orderId: reward.orderId,
    referrerUserId: reward.referrerUserId,
    buyerUserId: reward.buyerUserId,
    eventType: "reward_blocked",
    metadata: { reason },
  });
  return true;
}

/**
 * Rewards whose hold has expired and whose order is finished.
 *
 * Read by the scheduled job so a hold period does not need anybody to press
 * anything when it runs out.
 */
export async function dueHeldRewards(limit = 50): Promise<ReferralReward[]> {
  const now = new Date().toISOString();
  const rows = await d1All<Record<string, unknown>>(
    `SELECT r.* FROM referral_rewards r
       JOIN orders o ON o.id = r.order_id
      WHERE r.status = 'pending' AND o.status = 'completed'
        AND (r.hold_until IS NULL OR r.hold_until <= ?)
      LIMIT ?`,
    now,
    Math.max(1, Math.min(200, limit)),
  );
  return rows.filter((row) => row["id"]).map(toReferralReward);
}

/** The programme's hold length, for callers writing a reward. */
export async function referralHoldDays(): Promise<number> {
  return (await getReferralSettings()).holdDays;
}
