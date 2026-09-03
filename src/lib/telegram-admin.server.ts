import { constantTimeEqual } from "./security.server";
import { env } from "./env.server";

/**
 * Who the bot answers to.
 *
 * The bot has two entirely different behaviours — a member's bot and an
 * operator's console — and the only thing separating them is this check. It is
 * deliberately the single place that decides, so no handler can invent its own
 * looser rule, and it reads the sender's own Telegram id: never the chat id,
 * which in a group is not the person who pressed the button.
 *
 * `TELEGRAM_ADMIN_CHAT_ID` may name several operators, comma separated. It
 * falls back to the store owner's id so a fresh deployment is never left with
 * an unowned bot.
 */
const DEFAULT_ADMIN_ID = "6404042791";

export function telegramAdminIds(): string[] {
  const configured = (env("TELEGRAM_ADMIN_CHAT_ID") || "").trim();
  const ids = (configured || DEFAULT_ADMIN_ID)
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter((value) => /^-?\d{5,20}$/.test(value));
  return ids.length > 0 ? ids : [DEFAULT_ADMIN_ID];
}

/** Constant-time so a wrong id cannot be discovered by timing the bot. */
export function isTelegramAdmin(telegramUserId: unknown): boolean {
  // Only a primitive id is considered: an object or array that happens to
  // stringify to the right digits is not an identity.
  if (typeof telegramUserId !== "string" && typeof telegramUserId !== "number") return false;
  if (typeof telegramUserId === "number" && !Number.isSafeInteger(telegramUserId)) return false;
  const candidate = String(telegramUserId).trim();
  if (!/^-?\d{5,20}$/.test(candidate)) return false;
  let matched = false;
  for (const id of telegramAdminIds()) {
    // No early exit: every id is compared so the work does not depend on which
    // one matches.
    if (constantTimeEqual(candidate, id)) matched = true;
  }
  return matched;
}

/**
 * An administrative action must come from the operator personally, in their own
 * private chat with the bot. A forwarded message, a group where the operator is
 * a member, or a channel post are all rejected: none of them prove the sender.
 */
export function isAdminPrivateMessage(message: unknown): boolean {
  const msg = message as
    | { chat?: { id?: unknown; type?: string }; from?: { id?: unknown; is_bot?: boolean } }
    | undefined;
  if (!msg?.from || msg.from.is_bot) return false;
  if (msg.chat?.type !== "private") return false;
  if (String(msg.chat?.id ?? "") !== String(msg.from.id ?? "")) return false;
  return isTelegramAdmin(msg.from.id);
}

/**
 * The same rule for an inline button press. `callback_query.from` is the person
 * who tapped, which is not necessarily the person the message was sent to — an
 * operator's message forwarded into a group would otherwise let anyone there
 * press "approve".
 *
 * `adminGroupId` widens it to exactly one group and no other. Without it this
 * refused every press outside a private chat, which was correct while the
 * notifications went to a private chat and becomes a silent outage the moment
 * they go to the group: every "approve" on a top-up would answer "هذا الزر لم
 * يعد متاحاً" and no top-up would ever be credited again.
 *
 * Being in the group is still not authority. The presser's own Telegram id has
 * to be an operator's, which is what stops anyone the owner adds to the group
 * from approving payments.
 */
export function isAdminCallback(callback: unknown, adminGroupId?: string): boolean {
  const query = callback as
    | {
        from?: { id?: unknown; is_bot?: boolean };
        message?: { chat?: { id?: unknown; type?: string } };
      }
    | undefined;
  if (!query?.from || query.from.is_bot) return false;
  const chat = query.message?.chat;
  if (chat && chat.type !== "private" && !isAdminGroupChat(chat, adminGroupId)) return false;
  return isTelegramAdmin(query.from.id);
}

/** Is this chat the one group the shop has bound its admin topics to? */
export function isAdminGroupChat(
  chat: { id?: unknown; type?: string } | undefined,
  adminGroupId?: string,
): boolean {
  const wanted = String(adminGroupId ?? "").trim();
  if (!wanted) return false;
  if (chat?.type !== "group" && chat?.type !== "supergroup") return false;
  return String(chat?.id ?? "").trim() === wanted;
}

/**
 * An operator acting in the admin group.
 *
 * The private-chat rule cannot be reused here: it demands `chat.id === from.id`,
 * which is what proves a private chat belongs to its sender and is never true
 * in a group. What proves it here instead is that the chat is the one bound
 * group and the sender is an operator.
 */
export function isAdminGroupMessage(message: unknown, adminGroupId?: string): boolean {
  const msg = message as
    | { chat?: { id?: unknown; type?: string }; from?: { id?: unknown; is_bot?: boolean } }
    | undefined;
  if (!msg?.from || msg.from.is_bot) return false;
  if (!isAdminGroupChat(msg.chat, adminGroupId)) return false;
  return isTelegramAdmin(msg.from.id);
}

/** An operator acting anywhere the bot accepts administration: private, or the group. */
export function isAdminActor(message: unknown, adminGroupId?: string): boolean {
  return isAdminPrivateMessage(message) || isAdminGroupMessage(message, adminGroupId);
}
