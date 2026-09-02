/**
 * What each side is told, and what they are not.
 *
 * The referrer learns that *someone* used their link and, later, what it
 * earned. They never learn who: not a name, not a handle, not a game, not an
 * order — the friend's purchase is the friend's business. The buyer learns
 * only what applies to their own order.
 *
 * A refusal is always the same sentence, whatever caught it. Naming the check
 * would tell somebody trying it on exactly which signal to change.
 */

import { createNotification, findUserById } from "../db.server";
import type { Order } from "../types";
import { REFERRAL_REFUSAL_MESSAGE } from "./service.server";
import { rewardsForOrder } from "./rewards.server";

/** Send to Telegram if the member has linked it. Never throws. */
async function telegram(userId: string, text: string): Promise<void> {
  try {
    const { getUserTelegramChatId } = await import("../telegram-notifications.server");
    const chatId = await getUserTelegramChatId(userId);
    if (!chatId) return;
    const { sendTelegramMessage } = await import("../telegram.server");
    await sendTelegramMessage(chatId, text, { parse_mode: "HTML" });
  } catch (error) {
    console.warn("[referral:telegram_notify_failed]", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** In-app notification plus Telegram, both best-effort. */
async function notify(userId: string, title: string, body: string, link?: string): Promise<void> {
  if (!userId) return;
  try {
    await createNotification(userId, title, body, link, "referral");
  } catch (error) {
    console.warn("[referral:notification_failed]", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  await telegram(userId, `<b>${title}</b>\n${body}`);
}

/**
 * Someone opened the link.
 *
 * Deliberately vague: "a friend" and nothing else. The referrer is told their
 * link is working, not who is using it.
 */
export async function notifyReferralUsed(referrerUserId: string): Promise<void> {
  await notify(
    referrerUserId,
    "تم استخدام رابط دعوتك",
    "فتح أحد أصدقائك رابط الدعوة الخاص بك. ستحصل على مكافأتك عند إكمال أول عملية شراء مؤهلة.",
    "/refer",
  );
}

/** The order was paid: the reward exists but is not yet theirs. */
export async function notifyReferralPending(order: Order): Promise<void> {
  const referrerUserId = order.referral?.referrerUserId;
  if (!referrerUserId) return;
  const amount = Number(order.referral?.referrerRewardIqd ?? 0);
  await notify(
    referrerUserId,
    "مكافأتك قيد المراجعة",
    `تم دفع طلب عبر رابط دعوتك. مكافأتك ${amount.toLocaleString("en-US")} د.ع قيد المراجعة وستُضاف بعد إكمال الطلب.`,
    "/refer",
  );
}

/** The order completed and the money is in the wallet. */
export async function notifyReferralApproved(order: Order): Promise<void> {
  const rewards = await rewardsForOrder(order.id).catch(() => []);
  for (const reward of rewards) {
    if (reward.status !== "approved") continue;
    await notify(
      reward.referrerUserId,
      "تمت إضافة مكافأة الإحالة إلى محفظتك",
      `أُضيفت ${reward.referrerRewardIqd.toLocaleString("en-US")} د.ع إلى رصيد محفظتك كمكافأة إحالة.`,
      "/wallet",
    );
  }
}

/** The order was cancelled or refunded. */
export async function notifyReferralReversed(order: Pick<Order, "id">): Promise<void> {
  const rewards = await rewardsForOrder(order.id).catch(() => []);
  for (const reward of rewards) {
    if (reward.status !== "reversed" && reward.reversedAmountIqd <= 0) continue;
    await notify(
      reward.referrerUserId,
      "أُلغيت مكافأة الإحالة",
      "أُلغيت مكافأة الإحالة لأن الطلب لم يكتمل أو تم استرجاعه.",
      "/refer",
    );
  }
}

/** The buyer's confirmation that a code applied, with the amount. */
export function referralAppliedMessage(params: {
  referrerAlias: string;
  buyerDiscountIqd: number;
  productTitle?: string;
}): string {
  const amount = params.buyerDiscountIqd.toLocaleString("en-US");
  return params.productTitle
    ? `تم تطبيق إحالة @${params.referrerAlias} — خصم ${amount} د.ع على ${params.productTitle}.`
    : `تم تطبيق إحالة @${params.referrerAlias} — خصم ${amount} د.ع.`;
}

/** The one refusal sentence, re-exported so callers need one import. */
export const referralRefusalMessage = REFERRAL_REFUSAL_MESSAGE;

/** Tell the buyer their own order carried a referral discount. */
export async function notifyBuyerReferralApplied(order: Order): Promise<void> {
  const referral = order.referral;
  if (!referral || referral.buyerDiscountIqd <= 0) return;
  const buyer = await findUserById(order.userId).catch(() => undefined);
  if (!buyer) return;
  await notify(
    order.userId,
    "تم تطبيق خصم الإحالة",
    `حصلت على خصم ${referral.buyerDiscountIqd.toLocaleString("en-US")} د.ع على طلبك ${order.code}.`,
    `/orders/${order.id}`,
  );
}
