/**
 * Where each kind of admin Telegram notification is delivered.
 *
 * Shared by the router (telegram-admin-routing.server.ts) and the admin screen
 * that edits it, so the two can never disagree about the default.
 *
 * Orders went to the group's «الطلبات» topic. Telegram accepted every one of
 * them — the failure log holds no order failures at all — and the owner still
 * did not receive them: a card in a group topic is not a message to a person.
 * He asked for them «by bot not group», one message per order he can answer.
 * So orders default to his private chat with the bot; the other kinds keep the
 * group the operators bound, until `settings.telegramDelivery` says otherwise.
 */

export type TelegramNoticeKind = "order" | "wallet" | "support" | "general";
export type AdminDelivery = "private" | "group";

export const TELEGRAM_NOTICE_KINDS: readonly TelegramNoticeKind[] = [
  "order",
  "wallet",
  "support",
  "general",
];

export const DEFAULT_DELIVERY: Readonly<Record<TelegramNoticeKind, AdminDelivery>> = {
  order: "private",
  wallet: "group",
  support: "group",
  general: "group",
};

export const TELEGRAM_NOTICE_LABELS: Readonly<Record<TelegramNoticeKind, string>> = {
  order: "الطلبات الجديدة",
  wallet: "طلبات شحن المحفظة",
  support: "رسائل الزبائن",
  general: "إشعارات عامة",
};

export function deliveryFor(
  kind: TelegramNoticeKind,
  settings: Record<string, unknown> | null | undefined,
): AdminDelivery {
  const chosen = (settings?.["telegramDelivery"] as Record<string, unknown> | undefined)?.[kind];
  return chosen === "private" || chosen === "group" ? chosen : DEFAULT_DELIVERY[kind];
}

/** Every kind's delivery, defaults filled in — what the admin screen shows and saves. */
export function deliverySettings(
  settings: Record<string, unknown> | null | undefined,
): Record<TelegramNoticeKind, AdminDelivery> {
  return {
    order: deliveryFor("order", settings),
    wallet: deliveryFor("wallet", settings),
    support: deliveryFor("support", settings),
    general: deliveryFor("general", settings),
  };
}
