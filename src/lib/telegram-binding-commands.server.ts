/**
 * `/bind_wallet`, `/bind_general`, `/bind_chat`, `/bind_order`.
 *
 * Sent by an operator inside the topic they name. The update already carries
 * `chat.id` and `message_thread_id`, so the setup is four messages and no
 * numbers change hands — and each one is proven by where it was sent from
 * rather than typed from a bot API console and hoped for.
 *
 * Three rules the commands keep:
 *
 *   - **Only an operator, and only in a group.** A member typing `/bind_wallet`
 *     gets nothing at all — not an error, not a refusal — so the commands leave
 *     no trace for anyone they do not belong to.
 *   - **They stop working once setup is done.** Four bindings, all in one chat,
 *     and the commands are closed. Leaving them open would let anyone who later
 *     becomes an operator move the shop's wallet traffic to a topic of their
 *     choosing, quietly.
 *   - **Re-binding is allowed while setup is unfinished**, because that is how
 *     a mistake gets corrected without a database console.
 */

import {
  BINDING_KINDS,
  bindTopic,
  bindingCommand,
  bindingSummary,
  bindingsComplete,
  readBindings,
} from "./telegram-bindings.server";
import { isTelegramAdmin } from "./telegram-admin.server";
import { sendTelegramMessage } from "./telegram.server";

export interface BindingCommandOutcome {
  /** Whether this update was a binding command at all. */
  handled: boolean;
  /** What happened, for the log — never shown to a group. */
  reason:
    | "not_a_command"
    | "not_an_admin"
    | "not_a_group"
    | "already_complete"
    | "bound";
}

/**
 * Whether setup may still accept a binding, given what is already bound.
 *
 * Split out so the rule can be tested without a database: "complete" is four
 * kinds in one chat, and once complete the commands are closed for good.
 */
export function bindingsAcceptCommands(
  bindings: Map<string, { chatId: string }>,
): boolean {
  const known = new Map(
    [...bindings].filter(([kind]) => (BINDING_KINDS as readonly string[]).includes(kind)),
  ) as Parameters<typeof bindingsComplete>[0];
  return !bindingsComplete(known);
}

/**
 * Handle a binding command if this message is one.
 *
 * Returns `handled: true` for any `/bind_*`, whether or not it was allowed, so
 * the caller stops processing it as ordinary text. The distinction lives in
 * `reason`, which is logged and never sent to the chat.
 */
export async function handleBindingCommand(message: unknown): Promise<BindingCommandOutcome> {
  const msg = message as
    | {
        text?: unknown;
        chat?: { id?: unknown; type?: string };
        from?: { id?: unknown; is_bot?: boolean };
        message_thread_id?: unknown;
      }
    | undefined;

  const kind = bindingCommand(msg?.text);
  if (!kind) return { handled: false, reason: "not_a_command" };

  const type = msg?.chat?.type;
  if (type !== "group" && type !== "supergroup") {
    return { handled: true, reason: "not_a_group" };
  }
  if (!msg?.from || msg.from.is_bot || !isTelegramAdmin(msg.from.id)) {
    return { handled: true, reason: "not_an_admin" };
  }

  const bindings = await readBindings();
  if (!bindingsAcceptCommands(bindings)) {
    return { handled: true, reason: "already_complete" };
  }

  const thread = Number(msg.message_thread_id);
  await bindTopic({
    kind,
    chatId: String(msg.chat!.id),
    messageThreadId: Number.isSafeInteger(thread) && thread > 0 ? thread : null,
    boundBy: String(msg.from.id),
  });

  /*
    Read back rather than mutating the map in memory: the reply says what is
    actually stored, so a write that silently failed shows as an unticked box
    instead of a tick nobody can trust.
  */
  const after = await readBindings();
  const done = bindingsComplete(after);
  const body = done
    ? `✅ اكتمل الربط.\n\n${bindingSummary(after)}\n\nأوامر الربط أُغلقت الآن.`
    : `✅ تم الربط.\n\n${bindingSummary(after)}`;

  await sendTelegramMessage(String(msg.chat!.id), body, {
    ...(Number.isSafeInteger(thread) && thread > 0 ? { message_thread_id: thread } : {}),
  });

  return { handled: true, reason: "bound" };
}
