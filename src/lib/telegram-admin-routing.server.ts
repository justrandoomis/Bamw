/**
 * Where an admin notification goes.
 *
 * ## The change
 *
 * Notifications went to one chat id — `getAdminTelegramChatId()`, a single
 * string with a hardcoded fallback — so every order, top-up and support
 * message landed in one person's private conversation with the bot. Nobody
 * else saw them, and there was no way to hand one over.
 *
 * They now go to the admin group. When the group has Forum Topics enabled each
 * kind goes to its own topic; when it does not, everything goes to the group
 * with a clear prefix so the three kinds are still separable by eye.
 *
 * ## Why the old path is kept
 *
 * `TELEGRAM_ADMIN_GROUP_ID` is a secret that has to be set, and it will not be
 * set at the moment this deploys. Until it is, notifications keep going where
 * they go today. A feature that silently stops notifying anyone the moment it
 * ships is worse than the problem it fixes.
 */

import { env } from "./env.server";
import { getAdminTelegramChatId } from "./telegram-notifications.server";

export type AdminNotificationKind = "order" | "wallet" | "support";

export interface AdminRoute {
  chatId: string;
  /** Set only when the group has a topic configured for this kind. */
  messageThreadId?: number;
  /**
   * A one-line prefix naming the kind.
   *
   * Empty when the message is going to its own topic — the topic already says
   * what it is, and repeating it wastes the first line of every card.
   */
  prefix: string;
  /** True when this is the group rather than the legacy single chat. */
  isGroup: boolean;
}

function read(name: string): string {
  const value = env(name);
  return typeof value === "string" ? value.trim() : "";
}

/** A Telegram topic id, or nothing. Group ids are negative; topics never are. */
function topicId(name: string): number | undefined {
  const raw = read(name);
  if (!/^\d{1,12}$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return parsed > 0 ? parsed : undefined;
}

const PREFIX: Record<AdminNotificationKind, string> = {
  order: "🧾 الطلبات",
  wallet: "💳 المحفظة",
  support: "💬 الدعم",
};

const TOPIC_VAR: Record<AdminNotificationKind, string> = {
  order: "TELEGRAM_ORDERS_TOPIC_ID",
  wallet: "TELEGRAM_WALLET_TOPIC_ID",
  support: "TELEGRAM_SUPPORT_TOPIC_ID",
};

/**
 * The destination for one kind of admin notification.
 *
 * Falls back to the single admin chat when no group is configured, so the
 * shop keeps being notified between this shipping and the secret being set.
 */
export function adminRoute(kind: AdminNotificationKind): AdminRoute {
  const group = read("TELEGRAM_ADMIN_GROUP_ID");
  if (!group) {
    return { chatId: getAdminTelegramChatId(), prefix: PREFIX[kind], isGroup: false };
  }
  const thread = topicId(TOPIC_VAR[kind]);
  return {
    chatId: group,
    ...(thread ? { messageThreadId: thread } : {}),
    /*
      No prefix inside a topic. The topic's own name already says which kind
      this is, and a repeated header costs the first line of every card in a
      list people scan quickly.
    */
    prefix: thread ? "" : PREFIX[kind],
    isGroup: true,
  };
}

/** The `sendTelegramMessage` options a route implies. */
export function routeOptions(route: AdminRoute): Record<string, unknown> {
  return route.messageThreadId ? { message_thread_id: route.messageThreadId } : {};
}

/** A message body with its kind prefixed, when the route needs one. */
export function withRoutePrefix(route: AdminRoute, text: string): string {
  return route.prefix ? `<b>${route.prefix}</b>\n\n${text}` : text;
}

/*
  Things that must never be sent to a group chat.

  A private conversation with one admin and a group with staff in it are not
  the same risk. Passwords, one-time codes, game-account credentials and API
  keys are all things that have at some point been pasted into an admin
  message, and a group is forwardable, searchable and joined by whoever is
  added next.
*/
const FORBIDDEN_PATTERNS: { name: string; pattern: RegExp }[] = [
  /*
    No `\b` around the Arabic alternatives. JavaScript's word boundary is
    defined on ASCII word characters, so `\bرمز` can never match — the
    position before an Arabic letter at the start of a string is not a
    boundary by that definition. The first version of this pattern had it and
    silently matched nothing, which is the worst way for a guard to fail.
  */
  { name: "password", pattern: /(?:密码|密碼|\bpassword\b|كلمة\s*المرور|باسورد)\s*[:：=]/i },
  { name: "otp", pattern: /(?:\botp\b|verification\s*code|رمز\s*التحقق)\s*[:：=]?\s*\d{4,8}/i },
  { name: "api_key", pattern: /\b(?:api[_-]?key|secret[_-]?key|bearer)\b\s*[:：=]/i },
  { name: "bot_token", pattern: /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/ },
];

/**
 * Is this message safe to put in the admin group?
 *
 * Returns the name of what it found, or nothing. The caller drops the message
 * rather than trimming it: a notification that has to be censored to be sent
 * is a notification that was assembled wrongly, and quietly sending the
 * censored half would hide that.
 */
export function findForbiddenSecret(text: string): string | undefined {
  for (const { name, pattern } of FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return undefined;
}
