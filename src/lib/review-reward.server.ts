/**
 * The thank-you a finished order sends: rate the order, keep the code.
 *
 * ## What was here before
 *
 * A `review_request` card in the website chat, and nothing else. No Telegram
 * message went out when an order finished — the digital-delivery path, which
 * is the shop's main product, contains no notification call at all — so a
 * customer who never reopened the site never learned the order was done, let
 * alone that they were being asked to rate it.
 *
 * The reward did not exist. One function in the repository minted a coupon,
 * `approveReview`, and nothing imported it; it was keyed to an admin approving
 * a review rather than to an order finishing, and it read `review.userId` off
 * a raw snake_case D1 row, so the coupon it would have written was bound to
 * `undefined` — usable by anyone who learned the code.
 *
 * ## What this does
 *
 * On completion, once per order: mint a code worth {@link REWARD_AMOUNT_IQD}
 * that only this customer can use, expires {@link REWARD_VALID_DAYS} days
 * later, and can be spent once. Then tell them, in Telegram, with the steps
 * and a button that opens the order.
 *
 * The coupon engine already supported every part of that — `discount_type`
 * `fixed`, `eligible_users`, `expiration_at`, `usage_limit` — and
 * `checkCoupon` refuses a member who is not in `eligible_users`. Nothing had
 * ever written such a row automatically.
 *
 * Never throws. A reward is a thank-you for an order that is already finished;
 * it must not be able to fail the completion that earned it.
 */

import { d1First, d1Run, d1RunChanges, ensureCouponsSchema } from "./d1.server";
import { getUserTelegramChatId } from "./telegram-notifications.server";
import { escapeHtml, sendTelegramMessage, telegramMiniAppDeepLink } from "./telegram.server";
import type { Order } from "./types";
import { memberAllowsNotification } from "./notification-preferences.server";

/** What the code is worth, in Iraqi dinars. */
export const REWARD_AMOUNT_IQD = 1000;

/** How long the customer has to spend it. */
export const REWARD_VALID_DAYS = 7;

/**
 * Characters a code is drawn from: unambiguous in a screenshot or read aloud.
 * The same alphabet the referral codes use — no O/0, no I/1.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

/**
 * A fresh code, from the platform's CSPRNG.
 *
 * `Math.random()` is what the dead implementation used, with no retry against
 * a UNIQUE column. Two customers finishing an order in the same second is not
 * a rare event in a shop.
 */
function mintCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "REV-";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

let ledgerReady = false;

/**
 * One reward per order, recorded.
 *
 * Created lazily rather than through a schema-version bump: bumping it is what
 * wedged production once, and this table is touched only when an order
 * finishes. `queue-consumer.server.ts` establishes the same pattern.
 *
 * `order_id` is the primary key, so a second completion of the same order
 * cannot mint a second code however many paths call in.
 */
export async function ensureReviewRewardSchema(): Promise<void> {
  if (ledgerReady) return;
  await d1Run(`
    CREATE TABLE IF NOT EXISTS review_rewards (
      order_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      coupon_code TEXT NOT NULL,
      amount_iqd REAL NOT NULL,
      expires_at TEXT NOT NULL,
      issued_at TEXT NOT NULL
    )
  `);
  await d1Run(
    `CREATE UNIQUE INDEX IF NOT EXISTS review_rewards_coupon_code_idx
     ON review_rewards (coupon_code)`,
  );
  await d1Run(
    `CREATE INDEX IF NOT EXISTS review_rewards_user_idx
     ON review_rewards (user_id, issued_at DESC)`,
  );
  await d1Run(`
    CREATE TABLE IF NOT EXISTS review_reward_notifications (
      order_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      attempted_at TEXT NOT NULL,
      sent_at TEXT
    )
  `);
  /*
    The weekly gate.

    One row per customer, not one per reward: the rule is about the customer's
    week, and a table that grows with every code issued would have to be
    aggregated to answer the only question anyone asks of it.

    `prev_issued_at` is what makes a failed mint recoverable. The claim is
    taken before the coupon is written, so if the coupon write then fails the
    customer would be locked out for a week having received nothing; the
    rollback restores the previous timestamp rather than deleting the row, and
    is guarded on the code so a concurrent winner is never rolled back.

    Mirrored here as well as in the migration for the reason this file already
    documents: a database that never received the migration must self-heal.
    Deliberately without bumping any schema version — that is what wedged
    production once.
  */
  await d1Run(`
    CREATE TABLE IF NOT EXISTS review_reward_cooldowns (
      user_id          TEXT PRIMARY KEY,
      last_issued_at   TEXT NOT NULL,
      prev_issued_at   TEXT,
      last_coupon_code TEXT,
      last_order_id    TEXT
    )
  `);
  /*
    Which orders have already been invited to review, so that the three
    triggers — the customer confirming, the thirty-minute timer, and the admin
    completing by hand — send exactly one invitation between them.

    NOT `review_reward_notifications`: production rows there already read
    'sent' for every order completed since that table shipped, so reusing it
    would silently suppress the new invitation for all of them.
  */
  await d1Run(`
    CREATE TABLE IF NOT EXISTS order_review_prompts (
      order_id       TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL,
      prompted_at    TEXT NOT NULL,
      trigger_source TEXT NOT NULL
    )
  `);
  ledgerReady = true;
}

export interface ReviewReward {
  code: string;
  amountIqd: number;
  expiresAt: string;
}

interface RewardRow {
  user_id: string;
  coupon_code: string;
  amount_iqd: number;
  expires_at: string;
  issued_at?: string;
}

const couponIdForOrder = (orderId: string) => `cpn_review_${orderId}`;

async function ensureRewardCoupon(
  orderId: string,
  userId: string,
  reward: ReviewReward,
  issuedAt: string,
): Promise<void> {
  /*
    The ledger is the durable entitlement; the coupon is its redeemable view.
    If a Worker died between the two writes, any later read/submission repairs
    the coupon with exactly the same code instead of minting a second reward.
  */
  const couponId = couponIdForOrder(orderId);
  const repairedLegacyCoupon = await d1RunChanges(
    `UPDATE coupons SET
       discount_type = 'fixed', discount_value = ?, start_at = ?, expiration_at = ?,
       usage_limit = 1, per_user_limit = 1, eligible_products = '[]',
       eligible_categories = '[]', eligible_users = ?, min_order_amount = 0,
       max_discount_amount = NULL, only_digital_products = 0, is_stackable = 0,
       once_per_user_lifetime = 0
     WHERE code = ? AND id IN (?, ?)`,
    reward.amountIqd,
    issuedAt,
    reward.expiresAt,
    JSON.stringify([userId]),
    reward.code,
    couponId,
    `cpn_${reward.code}`,
  );
  if (repairedLegacyCoupon === 1) return;

  await d1Run(
    `INSERT INTO coupons (
       id, code, discount_type, discount_value, start_at, expiration_at,
       usage_limit, per_user_limit, eligible_products, eligible_categories,
       eligible_users, min_order_amount, max_discount_amount, is_active,
       only_digital_products, is_stackable, once_per_user_lifetime, created_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       code = excluded.code,
       discount_type = 'fixed',
       discount_value = excluded.discount_value,
       start_at = excluded.start_at,
       expiration_at = excluded.expiration_at,
       usage_limit = 1,
       per_user_limit = 1,
       eligible_products = '[]',
       eligible_categories = '[]',
       eligible_users = excluded.eligible_users,
       min_order_amount = 0,
       max_discount_amount = NULL,
       only_digital_products = 0,
       is_stackable = 0,
       once_per_user_lifetime = 0`,
    couponId,
    reward.code,
    "fixed",
    reward.amountIqd,
    issuedAt,
    reward.expiresAt,
    1,
    1,
    "[]",
    "[]",
    JSON.stringify([userId]),
    0,
    null,
    1,
    0,
    0,
    0,
    issuedAt,
  );
}

async function readReward(orderId: string): Promise<RewardRow | undefined> {
  return d1First<RewardRow>(
    `SELECT user_id, coupon_code, amount_iqd, expires_at, issued_at
     FROM review_rewards WHERE order_id = ?`,
    orderId,
  );
}

async function claimInvitation(
  orderId: string,
  now: string,
): Promise<"send" | "already_sent" | "busy"> {
  const inserted = await d1RunChanges(
    `INSERT OR IGNORE INTO review_reward_notifications
       (order_id, status, attempted_at, sent_at)
     VALUES (?, 'sending', ?, NULL)`,
    orderId,
    now,
  );
  if (inserted === 1) return "send";

  const existing = await d1First<{ status: string; attempted_at: string }>(
    `SELECT status, attempted_at FROM review_reward_notifications WHERE order_id = ?`,
    orderId,
  );
  if (existing?.status === "sent") return "already_sent";

  // A crashed Worker can leave a claim behind. Reclaim only after ten minutes;
  // ordinary retries during the same completion stay silent.
  const retryBefore = new Date(Date.parse(now) - 10 * 60 * 1000).toISOString();
  const reclaimed = await d1RunChanges(
    `UPDATE review_reward_notifications
     SET status = 'sending', attempted_at = ?, sent_at = NULL
     WHERE order_id = ? AND status != 'sent' AND attempted_at <= ?`,
    now,
    orderId,
    retryBefore,
  );
  return reclaimed === 1 ? "send" : "busy";
}

async function releaseInvitationClaim(orderId: string, attemptedAt: string): Promise<void> {
  await d1Run(
    `DELETE FROM review_reward_notifications
     WHERE order_id = ? AND status = 'sending' AND attempted_at = ?`,
    orderId,
    attemptedAt,
  );
}

/**
 * The reward for this order, minting it if this is the first time.
 *
 * Returns the existing one on a repeat call, so a customer who somehow
 * completes twice is told about the same code rather than given a second.
 */
export async function issueReviewReward(
  order: Order,
  options: { now?: string } = {},
): Promise<ReviewReward | null> {
  const userId = String(order.userId ?? "");
  const orderId = String(order.id ?? "");
  if (!userId || !orderId || order.status !== "completed") return null;

  try {
    await Promise.all([ensureReviewRewardSchema(), ensureCouponsSchema()]);

    const existing = await readReward(orderId);
    if (existing?.coupon_code) {
      const reward = {
        code: existing.coupon_code,
        amountIqd: Number(existing.amount_iqd) || REWARD_AMOUNT_IQD,
        expiresAt: String(existing.expires_at),
      };
      await ensureRewardCoupon(
        orderId,
        String(existing.user_id || userId),
        reward,
        String(existing.issued_at || options.now || new Date().toISOString()),
      );
      return reward;
    }

    const issuedAt = options.now ?? new Date().toISOString();
    const expiresAt = new Date(
      Date.parse(issuedAt) + REWARD_VALID_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    /*
      `coupons.code` is UNIQUE. Three attempts, because a collision is a
      one-in-a-trillion draw and a fourth would say the CSPRNG is broken rather
      than unlucky.
    */
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = mintCode();
      try {
        const inserted = await d1RunChanges(
          `INSERT OR IGNORE INTO review_rewards
             (order_id, user_id, coupon_code, amount_iqd, expires_at, issued_at)
           VALUES (?,?,?,?,?,?)`,
          orderId,
          userId,
          code,
          REWARD_AMOUNT_IQD,
          expiresAt,
          issuedAt,
        );
        const winner = await readReward(orderId);
        if (!winner?.coupon_code) continue;
        const reward = {
          code: winner.coupon_code,
          amountIqd: Number(winner.amount_iqd) || REWARD_AMOUNT_IQD,
          expiresAt: String(winner.expires_at),
        };
        try {
          await ensureRewardCoupon(
            orderId,
            String(winner.user_id || userId),
            reward,
            String(winner.issued_at || issuedAt),
          );
          return reward;
        } catch (error) {
          /* A fantastically unlikely code collision can be retried safely only
             by the request that inserted this entitlement. A concurrent loser
             must leave the winner's row alone and retry by reading it. */
          if (inserted === 1 && winner.coupon_code === code) {
            await d1Run(
              `DELETE FROM review_rewards WHERE order_id = ? AND coupon_code = ?`,
              orderId,
              code,
            ).catch(() => undefined);
          }
          throw error;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        /*
          A clash on `review_rewards.order_id` means another path minted one
          between the read above and this write — return that one rather than
          trying again with a new code.
        */
        if (/review_rewards/i.test(message)) {
          const raced = await readReward(orderId);
          if (raced?.coupon_code) {
            const reward = {
              code: raced.coupon_code,
              amountIqd: Number(raced.amount_iqd) || REWARD_AMOUNT_IQD,
              expiresAt: String(raced.expires_at),
            };
            await ensureRewardCoupon(
              orderId,
              String(raced.user_id || userId),
              reward,
              String(raced.issued_at || issuedAt),
            );
            return reward;
          }
        }
        if (attempt === 2) throw error;
      }
    }
    return null;
  } catch (error) {
    console.warn("[review-reward:issue_failed]", {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** How the expiry reads to a customer: a date, not a timestamp. */
function shortDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

/**
 * Tell the customer their order is done, how to rate it, and what they earned.
 *
 * The steps are numbered because "rate your order" on its own is an
 * instruction with nowhere to go — the rating card lives inside the order's
 * conversation, and a customer who has closed the app needs to be told how to
 * get back to it.
 */
export async function sendReviewInvitation(
  order: Order,
  options: { now?: string } = {},
): Promise<boolean> {
  let invitationAttemptedAt = "";
  try {
    const userId = String(order.userId ?? "");
    if (!userId) return false;

    /*
      No coupon is minted here any more.

      This used to mint one on completion, unconditionally, once per order. The
      owner's rule is that the code is earned: the customer rates the order,
      comments on the shop's Instagram post, sends a screenshot of their own
      comment as proof, an admin approves it, and only then is a code issued —
      at most one per customer per week, not one per order.

      So this function is now purely an invitation.
    */
    const chatId = await getUserTelegramChatId(userId);
    if (!chatId) return false;

    /*
      Filed under orders, not promotions.

      The message carries a discount code, but what it is *for* is telling the
      customer their order is complete and how to rate it. A member who
      switched promotional messages off would otherwise stop being told their
      orders had finished, which is not what that switch says it does.
    */
    if (!(await memberAllowsNotification(userId, "orders"))) return false;

    invitationAttemptedAt = options.now ?? new Date().toISOString();
    const claim = await claimInvitation(String(order.id ?? ""), invitationAttemptedAt);
    if (claim === "already_sent") return true;
    if (claim === "busy") return false;

    /*
      The steps describe the popup, because that is where the code is earned.
      No code appears in this message: there is none to show yet.
    */
    const lines = [
      "🎉 <b>تم اكتمال طلبك بنجاح!</b>",
      "",
      `🔖 <b>رقم الطلب:</b> <code>${escapeHtml(String(order.code ?? ""))}</code>`,
      "",
      `⭐ <b>يرجى التقييم للحصول على كود خصم ${REWARD_AMOUNT_IQD.toLocaleString()} دينار</b>`,
      "",
      "1️⃣ اضغط الزر بالأسفل لفتح طلبك.",
      "2️⃣ اكتب رأيك بتسليم المنتجات وأرفق صورة أو مقطعاً.",
      "3️⃣ علّق على منشور الإنستغرام المثبّت، وأرفق صورة تعليقك.",
      "4️⃣ بعد موافقة الإدارة يصلك الكود.",
    ];

    const res = await sendTelegramMessage(chatId, lines.join("\n"), {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "⭐ قيّم طلبك الآن",
              url: telegramMiniAppDeepLink(`order_${order.id}`),
            },
          ],
        ],
      },
    });

    if (res.ok) {
      await d1Run(
        `UPDATE review_reward_notifications
         SET status = 'sent', sent_at = ?
         WHERE order_id = ? AND status = 'sending' AND attempted_at = ?`,
        invitationAttemptedAt,
        order.id,
        invitationAttemptedAt,
      );
      return true;
    }
    await releaseInvitationClaim(String(order.id ?? ""), invitationAttemptedAt);
    return false;
  } catch (error) {
    if (invitationAttemptedAt && order?.id) {
      await releaseInvitationClaim(String(order.id), invitationAttemptedAt).catch(() => undefined);
    }
    console.warn("[review-reward:invite_failed]", {
      orderId: order?.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
