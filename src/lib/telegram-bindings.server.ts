/**
 * Where each kind of admin notification goes, learned from the group itself.
 *
 * The alternative was asking the owner to read four topic ids out of Telegram
 * and paste them into four secrets. A `message_thread_id` is not something
 * Telegram shows anyone — you get it by inspecting an update — so that request
 * is really "go and use a bot API console", and the id that comes back is
 * unverifiable: a typo binds the wallet topic to the order topic and nothing
 * says so until money lands in the wrong place.
 *
 * So the group tells us instead. An authorised admin sends `/bind_wallet` in
 * the Wallet topic and the update carries `chat.id` and `message_thread_id`
 * already — the two numbers, from the one place they cannot be wrong, proven by
 * the person sending them.
 *
 * The bindings live in D1 rather than in secrets because they are discovered at
 * runtime and a secret cannot be written from inside the Worker. Environment
 * variables still win when set, so a deployment can be pinned by configuration
 * if it ever needs to be.
 */

import { d1All, d1First, d1Run } from "./d1.server";
import { env } from "./env.server";

/**
 * The four topics, and the fifth thing they all share.
 *
 * `support` is the Chat topic. It is named for what it carries rather than for
 * the tab it sits in, because the code that routes a human-support message
 * should not have to know what the group calls that topic this month.
 */
export type BindingKind = "wallet" | "general" | "support" | "order";

export const BINDING_KINDS: readonly BindingKind[] = ["wallet", "general", "support", "order"];

/** `/bind_chat` binds `support`: the tab is called Chat, the traffic is support. */
const COMMAND_KIND: Record<string, BindingKind> = {
  bind_wallet: "wallet",
  bind_general: "general",
  bind_chat: "support",
  bind_order: "order",
};

export interface TopicBinding {
  kind: BindingKind;
  chatId: string;
  messageThreadId: number | null;
  boundBy: string;
  boundAt: string;
}

const ENV_TOPIC: Record<BindingKind, string> = {
  wallet: "TELEGRAM_WALLET_TOPIC_ID",
  general: "TELEGRAM_GENERAL_TOPIC_ID",
  support: "TELEGRAM_SUPPORT_TOPIC_ID",
  order: "TELEGRAM_ORDERS_TOPIC_ID",
};

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function toBinding(row: Record<string, unknown>): TopicBinding | null {
  const kind = text(row["kind"]) as BindingKind;
  if (!BINDING_KINDS.includes(kind)) return null;
  const chatId = text(row["chat_id"]).trim();
  if (!chatId) return null;
  const thread = Number(row["message_thread_id"]);
  return {
    kind,
    chatId,
    messageThreadId: Number.isSafeInteger(thread) && thread > 0 ? thread : null,
    boundBy: text(row["bound_by"]),
    boundAt: text(row["bound_at"]),
  };
}

/** Every binding the group has taught us, by kind. */
export async function readBindings(): Promise<Map<BindingKind, TopicBinding>> {
  const out = new Map<BindingKind, TopicBinding>();
  try {
    const rows = await d1All<Record<string, unknown>>("SELECT * FROM telegram_topic_bindings");
    for (const row of rows) {
      const binding = toBinding(row);
      if (binding) out.set(binding.kind, binding);
    }
  } catch {
    /*
      Before the table exists — a first deploy, a stale schema — there are no
      bindings, which is the same answer as an empty table. Routing falls back
      to the environment and then to the private chat, so the shop is never
      left unnotified because a lookup failed.
    */
  }
  return out;
}

/**
 * The environment's own answer, when it has one.
 *
 * Read separately from the D1 bindings so the precedence is stated once, here,
 * rather than implied by the order two callers happen to check things in.
 */
export function envBinding(kind: BindingKind): { chatId: string; messageThreadId: number | null } | null {
  const group = (env("TELEGRAM_ADMIN_GROUP_ID") || "").trim();
  if (!group) return null;
  const raw = (env(ENV_TOPIC[kind]) || "").trim();
  const thread = /^\d{1,12}$/.test(raw) ? Number(raw) : 0;
  return { chatId: group, messageThreadId: thread > 0 ? thread : null };
}

/**
 * Record where this kind belongs.
 *
 * One row per kind, replaced outright: re-sending `/bind_wallet` in a different
 * topic moves the wallet traffic there, which is the only sane reading of the
 * command and the only way to correct a mistake without a database console.
 */
export async function bindTopic(input: {
  kind: BindingKind;
  chatId: string | number;
  messageThreadId?: number | null;
  boundBy: string | number;
  now?: string;
}): Promise<void> {
  const now = input.now ?? new Date().toISOString();
  const thread = Number(input.messageThreadId);
  await d1Run(
    `INSERT INTO telegram_topic_bindings (kind, chat_id, message_thread_id, bound_by, bound_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(kind) DO UPDATE SET
       chat_id = excluded.chat_id,
       message_thread_id = excluded.message_thread_id,
       bound_by = excluded.bound_by,
       bound_at = excluded.bound_at`,
    input.kind,
    String(input.chatId),
    Number.isSafeInteger(thread) && thread > 0 ? thread : null,
    String(input.boundBy),
    now,
  );
}

/**
 * Is setup finished?
 *
 * All four kinds bound, and all four to the same group. The second half
 * matters: four topics in two different chats is a half-finished setup that
 * would otherwise look complete and send half the notifications somewhere
 * nobody is reading.
 */
export function bindingsComplete(bindings: Map<BindingKind, TopicBinding>): boolean {
  if (BINDING_KINDS.some((kind) => !bindings.has(kind))) return false;
  const chats = new Set([...bindings.values()].map((binding) => binding.chatId));
  return chats.size === 1;
}

/**
 * The binding command this message is, if it is one.
 *
 * Matched on the whole word so `/bind_walletx` is not `/bind_wallet`, and with
 * the `@BotName` suffix Telegram appends in groups allowed for.
 */
export function bindingCommand(messageText: unknown): BindingKind | null {
  const match = String(messageText ?? "")
    .trim()
    .match(/^\/(bind_wallet|bind_general|bind_chat|bind_order)(?:@[A-Za-z0-9_]+)?$/i);
  if (!match) return null;
  return COMMAND_KIND[match[1]!.toLowerCase()] ?? null;
}

/** The group every binding points at, or "" while none is bound. */
export async function boundGroupId(): Promise<string> {
  const fromEnv = (env("TELEGRAM_ADMIN_GROUP_ID") || "").trim();
  if (fromEnv) return fromEnv;
  const bindings = await readBindings();
  const chats = new Set([...bindings.values()].map((binding) => binding.chatId));
  /*
    One chat or nothing. While the four are split across two chats there is no
    single admin group, and answering with either of them would authorise a
    chat the owner has not finished setting up.
  */
  return chats.size === 1 ? [...chats][0]! : "";
}

/** A short, readable summary for the reply the bot posts after a bind. */
export function bindingSummary(bindings: Map<BindingKind, TopicBinding>): string {
  const label: Record<BindingKind, string> = {
    wallet: "المحفظة",
    general: "عام",
    support: "الدعم (Chat)",
    order: "الطلبات",
  };
  return BINDING_KINDS.map(
    (kind) => `${bindings.has(kind) ? "✅" : "⬜️"} ${label[kind]}`,
  ).join("\n");
}
