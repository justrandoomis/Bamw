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

import { d1First, d1Run } from "./d1.server";
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
async function ensureLedger(): Promise<void> {
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
  ledgerReady = true;
}

export interface ReviewReward {
  code: string;
  amountIqd: number;
  expiresAt: string;
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
  if (!userId || !orderId) return null;

  try {
    await ensureLedger();

    const existing = await d1First<{ coupon_code: string; amount_iqd: number; expires_at: string }>(
      `SELECT coupon_code, amount_iqd, expires_at FROM review_rewards WHERE order_id = ?`,
      orderId,
    );
    if (existing?.coupon_code) {
      return {
        code: existing.coupon_code,
        amountIqd: Number(existing.amount_iqd) || REWARD_AMOUNT_IQD,
        expiresAt: String(existing.expires_at),
      };
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
        await d1Run(
          `INSERT INTO coupons (
             id, code, discount_type, discount_value, start_at, expiration_at,
             usage_limit, per_user_limit, eligible_products, eligible_categories,
             eligible_users, min_order_amount, max_discount_amount, is_active,
             only_digital_products, is_stackable, once_per_user_lifetime, created_at
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          `cpn_${code}`,
          code,
          "fixed",
          REWARD_AMOUNT_IQD,
          issuedAt,
          expiresAt,
          /* One use in total, by one member: the one who earned it. */
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

        await d1Run(
          `INSERT INTO review_rewards (order_id, user_id, coupon_code, amount_iqd, expires_at, issued_at)
           VALUES (?,?,?,?,?,?)`,
          orderId,
          userId,
          code,
          REWARD_AMOUNT_IQD,
          expiresAt,
          issuedAt,
        );

        return { code, amountIqd: REWARD_AMOUNT_IQD, expiresAt };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        /*
          A clash on `review_rewards.order_id` means another path minted one
          between the read above and this write — return that one rather than
          trying again with a new code.
        */
        if (/review_rewards/i.test(message)) {
          const raced = await d1First<{ coupon_code: string; expires_at: string }>(
            `SELECT coupon_code, expires_at FROM review_rewards WHERE order_id = ?`,
            orderId,
          );
          if (raced?.coupon_code) {
            return {
              code: raced.coupon_code,
              amountIqd: REWARD_AMOUNT_IQD,
              expiresAt: String(raced.expires_at),
            };
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
  try {
    const userId = String(order.userId ?? "");
    if (!userId) return false;

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

    const reward = await issueReviewReward(order, options);

    const lines = [
      "🎉 <b>تم اكتمال طلبك بنجاح!</b>",
      "",
      `🔖 <b>رقم الطلب:</b> <code>${escapeHtml(String(order.code ?? ""))}</code>`,
      "",
      "⭐ <b>قيّم تجربتك واحصل على مكافأتك</b>",
      "",
      "1️⃣ اضغط الزر بالأسفل لفتح طلبك.",
      "2️⃣ اختر عدد النجوم من بطاقة التقييم في المحادثة.",
      "3️⃣ اكتب رأيك بالخدمة (اختياري) ثم أرسل.",
    ];

    if (reward) {
      lines.push(
        "",
        "🎁 <b>كود خصم خاص بك</b>",
        `<code>${escapeHtml(reward.code)}</code>`,
        `بقيمة <b>${reward.amountIqd.toLocaleString()} د.ع</b> على طلبك القادم.`,
        `صالح حتى <b>${shortDate(reward.expiresAt)}</b> — ${REWARD_VALID_DAYS} أيام من الآن.`,
        "الكود مخصص لحسابك وحده ويُستخدم مرة واحدة.",
      );
    }

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

    return res.ok;
  } catch (error) {
    console.warn("[review-reward:invite_failed]", {
      orderId: order?.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
