/**
 * Replying to a customer from Telegram.
 *
 * An admin reads a support card in the Chat topic and answers it the way anyone
 * answers a message in Telegram: by replying to it. That reply becomes a
 * message in the customer's conversation on the site, and appears there without
 * a refresh.
 *
 * The rule that makes this safe is the one that makes it useful: **a reply, and
 * nothing else.** `reply_to_message.message_id` is the only thing in an update
 * that says which customer is being answered. A message typed into the topic
 * without replying to anything has no addressee, so it goes nowhere at all —
 * not to a guess, not to the last customer, not to everyone. Admins talk to
 * each other in that topic and none of it should reach a customer.
 *
 * Three more rules:
 *
 *   - **Only an operator.** Being in the group is not authority; the sender's
 *     own Telegram id has to be an operator's.
 *   - **Only the bound group.** A reply in some other group the bot is in is
 *     not an instruction from this shop.
 *   - **Once.** Telegram retries an update whenever the webhook is slow to
 *     answer 200, which is exactly when the handler is slow because it is
 *     doing the work. The update id is claimed before the message is written.
 */

import { appendMessage } from "./db.server";
import { d1First, d1Run } from "./d1.server";
import { isAdminGroupMessage } from "./telegram-admin.server";
import { boundGroupId } from "./telegram-bindings.server";
import { env } from "./env.server";

export interface SupportLink {
  telegramChatId: string;
  telegramMessageId: number;
  conversationId: string;
  userId: string;
  orderId?: string;
}

export type ReplyOutcome =
  | "posted"
  | "not_a_reply"
  | "not_an_admin"
  | "not_the_admin_group"
  | "unknown_message"
  | "empty"
  | "duplicate";

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Remember which conversation a support card in the group is about. */
export async function rememberSupportLink(link: SupportLink): Promise<void> {
  await d1Run(
    `INSERT INTO telegram_support_links
       (telegram_chat_id, telegram_message_id, conversation_id, user_id, order_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(telegram_chat_id, telegram_message_id) DO UPDATE SET
       conversation_id = excluded.conversation_id,
       user_id = excluded.user_id,
       order_id = excluded.order_id`,
    link.telegramChatId,
    link.telegramMessageId,
    link.conversationId,
    link.userId,
    link.orderId ?? null,
    new Date().toISOString(),
  );
}

/** The conversation a group message belongs to, or null. */
export async function readSupportLink(
  chatId: string | number,
  messageId: number,
): Promise<SupportLink | null> {
  const row = await d1First<Record<string, unknown>>(
    `SELECT * FROM telegram_support_links
      WHERE telegram_chat_id = ? AND telegram_message_id = ? LIMIT 1`,
    String(chatId),
    messageId,
  );
  if (!row?.["conversation_id"]) return null;
  return {
    telegramChatId: text(row["telegram_chat_id"]),
    telegramMessageId: Number(row["telegram_message_id"]),
    conversationId: text(row["conversation_id"]),
    userId: text(row["user_id"]),
    ...(row["order_id"] ? { orderId: text(row["order_id"]) } : {}),
  };
}

/**
 * Claim an update id, returning false if it was already claimed.
 *
 * The INSERT is the claim: a primary key collision is another delivery of the
 * same update, and losing that race means someone else is already handling it.
 * Checking first and inserting after would leave a window wide enough for two
 * retries to both pass the check.
 */
export async function claimUpdate(updateId: unknown, kind: string): Promise<boolean> {
  const id = text(updateId).trim();
  /*
    No id, no protection — but also no reason to refuse the work. An update
    without one is not a retry of anything, because a retry is identified by
    the id it repeats.
  */
  if (!id) return true;
  try {
    await d1Run(
      "INSERT INTO telegram_processed_updates (update_id, kind, processed_at) VALUES (?, ?, ?)",
      id,
      kind,
      new Date().toISOString(),
    );
    return true;
  } catch {
    return false;
  }
}

/** What the admin actually typed, with the caption of an attachment counted. */
export function replyText(message: unknown): string {
  const msg = message as { text?: unknown; caption?: unknown } | undefined;
  const body = text(msg?.text).trim() || text(msg?.caption).trim();
  return body;
}

/**
 * Handle a message in the admin group as a reply to a customer, if it is one.
 *
 * Every refusal is silent. The group is where admins talk to each other, and a
 * bot that answers "this was not a reply" to every remark is a bot somebody
 * removes.
 */
export async function handleAdminGroupReply(
  message: unknown,
  updateId?: unknown,
): Promise<ReplyOutcome> {
  const msg = message as
    | {
        chat?: { id?: unknown; type?: string };
        from?: { id?: unknown; is_bot?: boolean; first_name?: unknown };
        reply_to_message?: { message_id?: unknown };
        text?: unknown;
        caption?: unknown;
      }
    | undefined;

  const repliedTo = Number(msg?.reply_to_message?.message_id);
  if (!Number.isSafeInteger(repliedTo) || repliedTo <= 0) return "not_a_reply";

  const group = await boundGroupId();
  if (!group || String(msg?.chat?.id ?? "") !== group) return "not_the_admin_group";
  if (!isAdminGroupMessage(msg, group)) return "not_an_admin";

  const link = await readSupportLink(group, repliedTo);
  if (!link) return "unknown_message";

  const { attachmentOf, storeTelegramAttachment } = await import("./telegram-attachments.server");
  const attachment = attachmentOf(msg);
  const body = replyText(msg);

  /* Text or a file. A reply that is neither has nothing to deliver. */
  if (!body && !attachment) return "empty";

  if (!(await claimUpdate(updateId, "support_reply"))) return "duplicate";

  let imageUrl = "";
  if (attachment) {
    const stored = await storeTelegramAttachment({
      fileId: attachment.fileId,
      declaredSize: attachment.declaredSize,
      conversationId: link.conversationId,
      botToken: env("TELEGRAM_BOT_TOKEN") || "",
    });
    if (stored.ok && stored.url) {
      imageUrl = stored.url;
    } else {
      /*
        Logged, not surfaced. The admin is in Telegram and the customer is on
        the site; an error in either place would be a message from the shop
        about the shop's own plumbing. The text still goes through, which is
        the part the customer was waiting for.
      */
      console.warn("[telegram:attachment_refused]", {
        conversationId: link.conversationId,
        refusal: stored.refusal,
      });
      if (!body) return "empty";
    }
  }

  /*
    `appendMessage` broadcasts `message.created` through the realtime durable
    object itself, so the customer's open tab shows the reply without a reload.
    Broadcasting again here would deliver it twice.
  */
  await appendMessage(link.conversationId, {
    threadId: link.conversationId,
    senderRole: "admin",
    kind: imageUrl ? "image" : "text",
    body: {
      ...(body ? { text: body } : {}),
      /*
        The shop's own path, never Telegram's. Telegram's file URL carries the
        bot token in it and expires, so putting one in a customer's
        conversation would leak the bot and then rot.
      */
      ...(imageUrl ? { imageUrl } : {}),
    },
    senderName: text(msg?.from?.first_name) || "الإدارة",
  });

  return "posted";
}
