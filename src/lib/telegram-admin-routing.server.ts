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

export type AdminNotificationKind = "order" | "wallet" | "support" | "general";

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
  general: "📢 عام",
};

/**
 * The destination for one kind of admin notification.
 *
 * Three answers in order, and the order is the point:
 *
 *   1. what the group taught us, via `/bind_*`;
 *   2. what the environment says, so a deployment can be pinned;
 *   3. the single admin chat, so the shop keeps being notified while neither
 *      of the first two has an answer yet.
 *
 * The binding wins over the environment because it is the one a person proved
 * by sending a message from inside the topic. A stale `TELEGRAM_*_TOPIC_ID`
 * left over from an earlier group would otherwise quietly outrank it.
 */
export async function adminRoute(kind: AdminNotificationKind): Promise<AdminRoute> {
  const { readBindings, envBinding } = await import("./telegram-bindings.server");

  const bindings = await readBindings();
  const bound = bindings.get(kind);
  const from = bound
    ? { chatId: bound.chatId, messageThreadId: bound.messageThreadId }
    : envBinding(kind);

  if (!from?.chatId) {
    return { chatId: getAdminTelegramChatId(), prefix: PREFIX[kind], isGroup: false };
  }

  return {
    chatId: from.chatId,
    ...(from.messageThreadId ? { messageThreadId: from.messageThreadId } : {}),
    /*
      No prefix inside a topic. The topic's own name already says which kind
      this is, and a repeated header costs the first line of every card in a
      list people scan quickly.
    */
    prefix: from.messageThreadId ? "" : PREFIX[kind],
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
 * The same text with anything that looks like a secret taken out.
 *
 * ## Why this exists beside the guard below
 *
 * {@link findForbiddenSecret} drops the whole notification, and that is right
 * for a body the shop composed: one that has to be censored to be sent was
 * assembled wrongly, and sending the censored half would hide that.
 *
 * It is wrong for a customer's own words. Those are interpolated into the
 * support and escalation cards, so a member who writes "كلمة المرور: 1234" in
 * a message asking for help tripped the guard, and the *entire* notification
 * was dropped — the admin was never told that customer had written in at all.
 * A member typing about a password is not a bug in the shop's code; it is a
 * customer needing help, and silently losing them is the worst outcome
 * available.
 *
 * So untrusted text is scrubbed on the way in, at the boundary where it
 * enters, and the guard keeps its drop semantics for everything the shop
 * writes itself.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const { pattern } of FORBIDDEN_PATTERNS) {
    /*
      Rebuilt as a global so every occurrence goes, not just the first. The
      shared patterns are not global — `findForbiddenSecret` only needs to know
      whether one exists — and reusing a `/g` regex across calls would carry
      `lastIndex` between them.
    */
    out = out.replace(new RegExp(pattern.source, `${pattern.flags}g`), "«محذوف»");
  }
  return out;
}

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
