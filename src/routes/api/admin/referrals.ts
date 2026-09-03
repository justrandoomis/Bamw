import { createFileRoute } from "@tanstack/react-router";

import { d1All, d1First, d1Run } from "@/lib/d1.server";
import { createAuditLog, getOrder, getStore, updateStore } from "@/lib/db.server";
import { body, guard, json } from "@/lib/http.server";
import { requireAdmin } from "@/lib/session.server";
import { DEFAULT_REFERRAL_SETTINGS, readReferralSettings, REFERRAL_SETTINGS_KEY } from "@/lib/referral/config";
import { bpsToPercent, percentToBps, toIqd } from "@/lib/referral/money";
import {
  toReferralReward,
  toReferralRiskEvent,
  type ReferralRewardRow,
} from "@/lib/referral/rows";
import { approveRewardsForOrder, blockReward, reverseRewardsForOrder } from "@/lib/referral/rewards.server";
import type { CategoryType } from "@/lib/productSection";

/**
 * The admin's view of the referral programme.
 *
 * Reads the whole trail for one referral — the two members, the order and the
 * game, the money, the anti-abuse verdict and every risk event behind it — and
 * offers the four manual actions: approve, block, reverse, and take somebody
 * out of the programme. Each one writes an admin audit entry, because a
 * manual override of an automatic decision is exactly the thing that has to be
 * attributable later.
 */

/**
 * A reward row joined to the two members and the order.
 *
 * Extends the mapper's own row type rather than a bare record, so the joined
 * columns are named and the reward's own columns keep the shape
 * `toReferralReward` expects.
 */
type RewardListRow = ReferralRewardRow &
  Record<string, unknown> & {
    referrer_name?: unknown;
    buyer_name?: unknown;
    order_code?: unknown;
  };

const LIST_SQL = `
  SELECT r.*,
         referrer.name AS referrer_name, referrer.username AS referrer_username,
         buyer.name AS buyer_name, buyer.username AS buyer_username,
         o.code AS order_code, o.status AS order_status,
         a.device_hash AS attribution_device_hash, a.ip_hash AS attribution_ip_hash,
         a.blocked_reason AS attribution_blocked_reason
    FROM referral_rewards r
    LEFT JOIN users referrer ON referrer.id = r.referrer_user_id
    LEFT JOIN users buyer ON buyer.id = r.buyer_user_id
    LEFT JOIN orders o ON o.id = r.order_id
    LEFT JOIN referral_attributions a ON a.id = r.attribution_id
`;

/**
 * One row for the table.
 *
 * The hashes travel as booleans — "device match: yes" — and never as values.
 * An admin needs to know that two people were on one device; nobody needs the
 * identifier itself, and a screen that renders it is a screen that leaks it
 * into a screenshot.
 */
function toAdminRow(row: RewardListRow) {
  const reward = toReferralReward(row);
  const attributionDevice = row["attribution_device_hash"];
  const attributionIp = row["attribution_ip_hash"];
  const verdict = reward.riskVerdict ?? "";
  return {
    ...reward,
    referrerName: String(row.referrer_name ?? ""),
    referrerUsername: String(row["referrer_username"] ?? ""),
    buyerName: String(row.buyer_name ?? ""),
    buyerUsername: String(row["buyer_username"] ?? ""),
    orderCode: String(row.order_code ?? ""),
    orderStatus: String(row["order_status"] ?? ""),
    deviceMatch: verdict.includes("same_device"),
    ipMatch: verdict.includes("same_ip"),
    hasDeviceRecord: Boolean(attributionDevice),
    hasIpRecord: Boolean(attributionIp),
    /*
      The reward's own reason, or the attribution's when the refusal happened
      before there was a reward. `String(x) ?? null` would have made an absent
      reason an empty string, which the admin table would then render as a
      blank "blocked because" cell rather than as nothing at all.
    */
    blockedReason:
      reward.blockedReason || (row["attribution_blocked_reason"]
        ? String(row["attribution_blocked_reason"])
        : null),
  };
}

/**
 * Refusals that never became a reward.
 *
 * The customer is told one sentence and the reason goes to
 * `referral_risk_events` — which the reward table could not show, because a
 * refused code never becomes an order and so never becomes a reward row. That
 * left the only record of a refusal in a table nothing displayed, and the
 * owner with no way to answer "why did my link not work?".
 *
 * `reward_id IS NULL` is the whole filter: an event attached to a reward is
 * already visible on that reward's own trail.
 */
const REFUSAL_EVENT_TYPES = [
  "capture_blocked",
  "bind_blocked",
  "checkout_not_applicable",
  "checkout_limit_blocked",
] as const;

const REFUSALS_SQL = `
  SELECT e.id, e.event_type, e.risk_score, e.metadata, e.created_at,
         e.order_id, e.attribution_id,
         e.referrer_user_id, e.buyer_user_id,
         referrer.name AS referrer_name, referrer.username AS referrer_username,
         buyer.name AS buyer_name, buyer.username AS buyer_username,
         o.code AS order_code
    FROM referral_risk_events e
    LEFT JOIN users referrer ON referrer.id = e.referrer_user_id
    LEFT JOIN users buyer ON buyer.id = e.buyer_user_id
    LEFT JOIN orders o ON o.id = e.order_id
   WHERE e.reward_id IS NULL
     AND e.event_type IN (${REFUSAL_EVENT_TYPES.map((type) => `'${type}'`).join(", ")})
   ORDER BY e.created_at DESC
   LIMIT ?
`;

/**
 * One refused attempt, with nothing identifying in it.
 *
 * The hashes are dropped exactly as they are on the reward trail, and the
 * reasons come out of the metadata JSON: `reasons` when an anti-abuse check
 * refused it, `verdict` when the purchase itself was never eligible — an
 * accessory, a marketplace listing, or a selection that is not an offline
 * account. Both are needed, because those two refusals arrive by different
 * routes and read identically to the customer.
 */
function toRefusalRow(row: Record<string, unknown>) {
  const event = toReferralRiskEvent(row);
  const metadata = event.metadata ?? {};
  const listed = Array.isArray(metadata["reasons"])
    ? (metadata["reasons"] as unknown[]).map((value) => String(value)).filter(Boolean)
    : [];
  const verdict = String(metadata["verdict"] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    id: event.id,
    eventType: event.eventType,
    riskScore: event.riskScore,
    createdAt: event.createdAt,
    orderId: event.orderId ?? null,
    orderCode: String(row["order_code"] ?? ""),
    referrerName: String(row["referrer_name"] ?? ""),
    referrerUsername: String(row["referrer_username"] ?? ""),
    buyerName: String(row["buyer_name"] ?? ""),
    buyerUsername: String(row["buyer_username"] ?? ""),
    stage: String(metadata["stage"] ?? ""),
    // Deduplicated: a reason can be cited by both the check list and the
    // verdict string, and showing it twice reads as two separate refusals.
    reasons: Array.from(new Set([...listed, ...verdict])),
  };
}

export const Route = createFileRoute("/api/admin/referrals")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          await requireAdmin(request);
          const url = new URL(request.url);
          const search = (url.searchParams.get("q") ?? "").trim();
          const status = (url.searchParams.get("status") ?? "").trim();
          const rewardId = (url.searchParams.get("reward") ?? "").trim();
          const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 50)));

          const store = await getStore();
          const settings = readReferralSettings(store?.settings);
          const settingsForForm = {
            ...settings,
            buyerPercent: bpsToPercent(settings.buyerPercentBps),
            referrerPercent: bpsToPercent(settings.referrerPercentBps),
          };

          /* One referral in full: the row, and every event behind it. */
          if (rewardId) {
            const row = await d1First<RewardListRow>(`${LIST_SQL} WHERE r.id = ? LIMIT 1`, rewardId);
            if (!row?.["id"]) return json({ error: "not_found" }, { status: 404 });
            const reward = toAdminRow(row);
            const events = await d1All<Record<string, unknown>>(
              `SELECT * FROM referral_risk_events
                WHERE reward_id = ? OR attribution_id = ? OR order_id = ?
                ORDER BY created_at DESC LIMIT 100`,
              rewardId,
              reward.attributionId,
              reward.orderId,
            );
            const walletTx = reward.walletTransactionId
              ? await d1First<Record<string, unknown>>(
                  `SELECT id, kind, amount, description, created_at FROM wallet_transactions WHERE id = ?`,
                  reward.walletTransactionId,
                )
              : undefined;
            /*
              The event trail without its hashes.

              They are HMACs rather than addresses or device strings, so they
              are not the customer's data — but they are of no use to an admin
              either: the screen shows "device match: yes". Sending them would
              put them in a browser, a screenshot and a support ticket for
              nothing, so they stop here.
            */
            const trail = events.map(toReferralRiskEvent).map((event) => {
              const { deviceHash: _device, ipHash: _ip, ...rest } = event;
              return rest;
            });

            return json({
              reward,
              events: trail,
              walletTransaction: walletTx?.["id"] ? walletTx : null,
              settings: settingsForForm,
            });
          }

          const clauses: string[] = [];
          const params: unknown[] = [];
          if (status) {
            clauses.push("r.status = ?");
            params.push(status);
          }
          if (search) {
            clauses.push(
              `(r.referral_code = ? OR r.order_id = ? OR o.code = ? OR
                lower(referrer.username) = ? OR lower(buyer.username) = ?)`,
            );
            const upper = search.toUpperCase();
            const lower = search.toLowerCase().replace(/^@+/, "");
            params.push(upper, search, upper, lower, lower);
          }
          const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
          const rows = await d1All<RewardListRow>(
            `${LIST_SQL}${where} ORDER BY r.created_at DESC LIMIT ?`,
            ...params,
            limit,
          );

          const totals = await d1First<Record<string, unknown>>(
            `SELECT
               COUNT(*) AS total,
               COALESCE(SUM(CASE WHEN status = 'pending' THEN referrer_reward_iqd ELSE 0 END), 0) AS pending_iqd,
               COALESCE(SUM(CASE WHEN status = 'approved' THEN referrer_reward_iqd - reversed_amount_iqd ELSE 0 END), 0) AS approved_iqd,
               COALESCE(SUM(reversed_amount_iqd), 0) AS reversed_iqd,
               COALESCE(SUM(buyer_discount_iqd), 0) AS discount_iqd
             FROM referral_rewards`,
          );

          const blocked = await d1All<Record<string, unknown>>(
            `SELECT b.user_id, b.reason, b.created_at, u.name, u.username
               FROM referral_blocklist b LEFT JOIN users u ON u.id = b.user_id
              ORDER BY b.created_at DESC LIMIT 100`,
          );

          /*
            The refusals that produced no reward row.

            Unfiltered by the search box on purpose: the point of this list is
            the question "why is nobody's code working?", which is asked with
            nothing to search by.
          */
          const refusals = await d1All<Record<string, unknown>>(REFUSALS_SQL, limit);

          return json({
            rewards: rows.filter((row) => row["id"]).map(toAdminRow),
            totals: {
              total: Number(totals?.["total"] ?? 0),
              pendingIqd: Number(totals?.["pending_iqd"] ?? 0),
              approvedIqd: Number(totals?.["approved_iqd"] ?? 0),
              reversedIqd: Number(totals?.["reversed_iqd"] ?? 0),
              discountIqd: Number(totals?.["discount_iqd"] ?? 0),
            },
            blocked: blocked.map((row) => ({
              userId: String(row["user_id"] ?? ""),
              name: String(row["name"] ?? ""),
              username: String(row["username"] ?? ""),
              reason: String(row["reason"] ?? ""),
              createdAt: String(row["created_at"] ?? ""),
            })),
            refusals: refusals.filter((row) => row["id"]).map(toRefusalRow),
            settings: settingsForForm,
          });
        }),

      POST: async ({ request }) =>
        guard(async () => {
          const admin = await requireAdmin(request);
          const data = await body<{
            action?: string;
            rewardId?: string;
            userId?: string;
            code?: string;
            reason?: string;
            isActive?: boolean;
            settings?: Record<string, unknown>;
          }>(request);
          const action = String(data.action ?? "");
          const reason = String(data.reason ?? "").slice(0, 240) || "admin_manual";

          /** Every manual override is attributable. */
          const audit = (entity: string, entityId: string, details: unknown) =>
            createAuditLog(admin.id, `referral_${action}`, entity, entityId, null, null, details).catch(
              () => undefined,
            );

          switch (action) {
            case "approve": {
              const rewardId = String(data.rewardId ?? "");
              const row = await d1First<Record<string, unknown>>(
                `SELECT * FROM referral_rewards WHERE id = ?`,
                rewardId,
              );
              if (!row?.["id"]) return json({ error: "not_found" }, { status: 404 });
              const reward = toReferralReward(row);
              const order = await getOrder(reward.orderId);
              if (!order) return json({ error: "order_not_found" }, { status: 404 });
              /*
                Clearing the hold is what "approve now" means — the automatic
                pass refuses a reward whose hold has not expired, and an admin
                pressing the button is deciding it has.
              */
              await d1Run(`UPDATE referral_rewards SET hold_until = NULL WHERE id = ?`, rewardId);
              const result = await approveRewardsForOrder(order);
              await audit("referral_reward", rewardId, { ...result, reason });
              return json({ ok: result.approved > 0, ...result });
            }

            case "block": {
              const rewardId = String(data.rewardId ?? "");
              const ok = await blockReward(rewardId, reason);
              await audit("referral_reward", rewardId, { reason });
              return json({ ok });
            }

            case "reverse": {
              const rewardId = String(data.rewardId ?? "");
              const row = await d1First<Record<string, unknown>>(
                `SELECT * FROM referral_rewards WHERE id = ?`,
                rewardId,
              );
              if (!row?.["id"]) return json({ error: "not_found" }, { status: 404 });
              const reward = toReferralReward(row);
              const order = await getOrder(reward.orderId);
              const result = await reverseRewardsForOrder({
                order: { id: reward.orderId, code: order?.code ?? reward.orderId },
                reason,
              });
              await audit("referral_reward", rewardId, { ...result, reason });
              return json({ ok: result.reversed > 0, ...result });
            }

            case "set_code_active": {
              const code = String(data.code ?? "").trim().toUpperCase();
              const isActive = data.isActive !== false;
              await d1Run(
                `UPDATE referral_codes SET is_active = ?, blocked_reason = ?, updated_at = ? WHERE code = ?`,
                isActive ? 1 : 0,
                isActive ? null : reason,
                new Date().toISOString(),
                code,
              );
              await audit("referral_code", code, { isActive, reason });
              return json({ ok: true });
            }

            case "block_user": {
              const userId = String(data.userId ?? "");
              if (!userId) return json({ error: "user_required" }, { status: 400 });
              await d1Run(
                `INSERT INTO referral_blocklist (user_id, reason, blocked_by, created_at)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason, blocked_by = excluded.blocked_by`,
                userId,
                reason,
                admin.id,
                new Date().toISOString(),
              );
              await audit("user", userId, { reason });
              return json({ ok: true });
            }

            case "unblock_user": {
              const userId = String(data.userId ?? "");
              if (!userId) return json({ error: "user_required" }, { status: 400 });
              await d1Run(`DELETE FROM referral_blocklist WHERE user_id = ?`, userId);
              await audit("user", userId, { reason });
              return json({ ok: true });
            }

            /*
              The programme's settings live in the store document with every
              other admin setting, so the existing save path carries them and
              there is no second place for them to drift out of step.
            */
            case "save_settings": {
              const incoming = (data.settings ?? {}) as Record<string, unknown>;
              const next = {
                enabled: incoming["enabled"] !== false,
                buyerPercentBps:
                  percentToBps(incoming["buyerPercent"]) ?? DEFAULT_REFERRAL_SETTINGS.buyerPercentBps,
                referrerPercentBps:
                  percentToBps(incoming["referrerPercent"]) ??
                  DEFAULT_REFERRAL_SETTINGS.referrerPercentBps,
                maxRewardIqd: toIqd(incoming["maxRewardIqd"]),
                linkTtlDays: Math.max(1, Math.min(365, Number(incoming["linkTtlDays"]) || 30)),
                eligibleCategories: Array.isArray(incoming["eligibleCategories"])
                  ? (incoming["eligibleCategories"] as CategoryType[])
                  : DEFAULT_REFERRAL_SETTINGS.eligibleCategories,
                firstPurchaseOnly: incoming["firstPurchaseOnly"] !== false,
                stackWithCoupon: incoming["stackWithCoupon"] === true,
                holdDays: Math.max(0, Math.min(90, Number(incoming["holdDays"]) || 0)),
                dailyInviteLimit: Math.max(0, Number(incoming["dailyInviteLimit"]) || 0),
                dailyRewardCapIqd: toIqd(incoming["dailyRewardCapIqd"]),
                monthlyRewardCapIqd: toIqd(incoming["monthlyRewardCapIqd"]),
                blockSameIp: incoming["blockSameIp"] !== false,
              };
              await updateStore((prev) => ({
                ...prev,
                settings: { ...(prev.settings ?? {}), [REFERRAL_SETTINGS_KEY]: next },
              }));
              await audit("referral_settings", REFERRAL_SETTINGS_KEY, next);
              return json({ ok: true, settings: next });
            }

            default:
              return json({ error: "unknown_action" }, { status: 400 });
          }
        }),
    },
  },
});
