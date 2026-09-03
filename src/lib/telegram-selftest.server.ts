/**
 * `/selftest` — prove where each kind of notification actually lands.
 *
 * Binding four topics is easy to get almost right: a wrong thread id, a
 * binding written into a second chat, a topic deleted and recreated. None of
 * those show up until a real top-up or a real order goes to the wrong place,
 * which is the worst moment to find out.
 *
 * The alternative — making a real top-up request, a real order and a real
 * support message to watch where they go — changes a balance, an order and a
 * customer's history to test a routing table. That is not a test, it is four
 * rows of damage.
 *
 * So this sends one plainly-labelled message per kind, through
 * `sendAdminNotification`, which is the same function every real notification
 * goes through. Nothing else is touched: no order, no wallet, no product, no
 * conversation.
 */

import type { AdminNotificationKind } from "./telegram-admin-routing.server";
import { isTelegramAdmin } from "./telegram-admin.server";
import { sendAdminNotification } from "./telegram-notifications.server";
import { sendTelegramMessage } from "./telegram.server";

const KINDS: AdminNotificationKind[] = ["wallet", "general", "support", "order"];

/** What the operator sees in the group beside each kind. */
const TOPIC_NAME: Record<AdminNotificationKind, string> = {
  wallet: "Wallet",
  general: "General",
  support: "Chat",
  order: "Order",
};

export interface SelfTestOutcome {
  handled: boolean;
  reason: "not_a_command" | "not_a_group" | "not_an_admin" | "sent";
  /** Which kinds reached Telegram, in the order they were tried. */
  delivered?: AdminNotificationKind[];
}

/** `/selftest`, with the `@BotName` suffix Telegram appends in groups. */
export function isSelfTestCommand(text: unknown): boolean {
  if (typeof text !== "string") return false;
  return /^\/selftest(@[A-Za-z0-9_]{1,32})?$/.test(text.trim());
}

/**
 * Send one test notification per kind and report back where they went.
 *
 * Unlike `/bind_*` this stays available after setup is finished: it changes no
 * routing and creates no data, and a topic that was deleted and remade months
 * later is exactly the case worth being able to re-check.
 */
export async function handleSelfTestCommand(message: unknown): Promise<SelfTestOutcome> {
  const msg = message as
    | {
        text?: unknown;
        chat?: { id?: unknown; type?: string };
        from?: { id?: unknown; is_bot?: boolean };
        message_thread_id?: unknown;
      }
    | undefined;

  if (!isSelfTestCommand(msg?.text)) return { handled: false, reason: "not_a_command" };

  const type = msg?.chat?.type;
  if (type !== "group" && type !== "supergroup") return { handled: true, reason: "not_a_group" };

  /* Silent for anyone it does not belong to, like the binding commands. */
  if (!msg?.from || msg.from.is_bot || !isTelegramAdmin(msg.from.id)) {
    return { handled: true, reason: "not_an_admin" };
  }

  const stamp = new Date().toISOString().slice(11, 19);
  const delivered: AdminNotificationKind[] = [];
  const lines: string[] = [];

  for (const kind of KINDS) {
    const result = await sendAdminNotification(
      kind,
      `🧪 <b>رسالة اختبار</b> — ${TOPIC_NAME[kind]}\n` +
        `أُرسلت في ${stamp} للتأكد من وصول إشعارات هذا النوع إلى هذا الموضوع.\n` +
        `لا علاقة لها بأي طلب أو رصيد أو محادثة.`,
    );
    if (result.ok) delivered.push(kind);
    lines.push(`${result.ok ? "✅" : "❌"} ${TOPIC_NAME[kind]}`);
  }

  /*
    The summary goes back to the topic the command came from, so the operator
    reads the result in one place and then checks that four messages arrived in
    four different topics — which is the part only a human can confirm.
  */
  const thread = Number(msg.message_thread_id);
  await sendTelegramMessage(
    String(msg.chat!.id),
    `نتيجة الاختبار:\n\n${lines.join("\n")}\n\n` +
      `تحقّق الآن أن كل رسالة وصلت إلى موضوعها الصحيح.`,
    {
      parse_mode: "HTML",
      ...(Number.isSafeInteger(thread) && thread > 0 ? { message_thread_id: thread } : {}),
    },
  );

  return { handled: true, reason: "sent", delivered };
}
