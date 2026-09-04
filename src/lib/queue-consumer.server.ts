/**
 * Cloudflare Queue consumer for notification and maintenance work.
 *
 * Messages are acknowledged only after their handler succeeds. A D1 ledger
 * makes retries idempotent across Worker isolates.
 */

import { d1First, d1Run } from "./db.server";
import { publishEnv } from "./env.server";
import {
  processAutoScheduledTasks,
  processBotTrading,
  processDigitalDeliveryMaintenance,
} from "./scheduled-jobs.server";
import {
  notifyAdminCustomerMessage,
  notifyAdminDiscTrade,
  notifyAdminGameRequest,
  notifyAdminNewOrder,
  notifyAdminUsedListing,
  notifyAdminWalletTopUp,
  notifyUserAdminMessage,
  notifyUserOrderStatus,
} from "./telegram-notifications.server";
import { sendTelegramMessage } from "./telegram.server";

export interface CloudflareQueueMessage<T = any> {
  readonly id: string;
  readonly body: T;
  readonly attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface CloudflareMessageBatch<T = any> {
  readonly queue: string;
  readonly messages: readonly CloudflareQueueMessage<T>[];
}

let queueTableReady = false;

async function ensureQueueTable() {
  if (queueTableReady) return;
  await d1Run(`
    CREATE TABLE IF NOT EXISTS processed_queue_messages (
      id TEXT PRIMARY KEY,
      queue_name TEXT,
      message_type TEXT,
      attempts INTEGER DEFAULT 1,
      processed_at TEXT NOT NULL
    )
  `);
  queueTableReady = true;
}

async function wasProcessed(id: string): Promise<boolean> {
  await ensureQueueTable();
  return Boolean(
    await d1First<{ id: string }>("SELECT id FROM processed_queue_messages WHERE id = ?", id),
  );
}

async function markProcessed(
  id: string,
  queueName: string,
  messageType: string,
  attempts: number,
) {
  await ensureQueueTable();
  await d1Run(
    `INSERT OR REPLACE INTO processed_queue_messages
       (id, queue_name, message_type, attempts, processed_at)
     VALUES (?, ?, ?, ?, ?)`,
    id,
    queueName,
    messageType,
    attempts,
    new Date().toISOString(),
  );
}

function envelopeOf(body: any): { type: string; payload: any; dedupeKey?: string } {
  let envelope = body;
  if (typeof body === "string") {
    try {
      envelope = JSON.parse(body);
    } catch {
      envelope = { type: "raw_text", payload: body };
    }
  }

  return {
    type: envelope?.type || envelope?.action || envelope?.event || "unknown",
    payload: envelope?.payload !== undefined ? envelope.payload : envelope,
    dedupeKey: envelope?.dedupeKey || envelope?.id,
  };
}

/**
 * Turn a notification that did not send into a thrown error.
 *
 * The queue was built to retry a failed notification, and it never retried
 * one: the notify functions swallow their failures and return `{ ok: false }`,
 * so `dispatch` returned normally, the message was marked processed and
 * acknowledged, and a Telegram timeout or a 429 lost the notification for
 * good on the first attempt. Every notification this queue exists to protect
 * was unprotected.
 *
 * A skipped notification is not a failure — nothing was due — so it passes.
 */
async function mustDeliver(
  what: string,
  send: Promise<{ ok: boolean; skipped?: boolean }>,
): Promise<void> {
  const result = await send;
  if (result.ok || result.skipped) return;
  throw new Error(`${what} was not delivered`);
}

async function dispatch(type: string, payload: any, queueName: string): Promise<void> {
  switch (type) {
    case "telegram_admin_new_order":
    case "notify_admin_order":
      if (!payload?.order || !payload?.user) throw new Error("Missing order or user");
      await mustDeliver("the new-order notification", notifyAdminNewOrder(payload));
      return;

    case "telegram_admin_customer_message":
    case "notify_admin_message":
      if (!payload?.thread || !payload?.message || !payload?.user) {
        throw new Error("Missing thread, message, or user");
      }
      await mustDeliver("the customer-message notification", notifyAdminCustomerMessage(payload));
      return;

    case "telegram_admin_wallet_topup":
    case "notify_admin_topup":
      if (!payload?.requestId || !payload?.amount || !payload?.user) {
        throw new Error("Missing wallet top-up fields");
      }
      await mustDeliver("the wallet top-up notification", notifyAdminWalletTopUp(payload));
      return;

    case "telegram_admin_game_request":
      if (!payload?.request || !payload?.user) throw new Error("Missing game request fields");
      await mustDeliver("the game-request notification", notifyAdminGameRequest(payload));
      return;

    case "telegram_admin_disc_trade":
      if (!payload?.tradeId || !payload?.gameName || !payload?.user) {
        throw new Error("Missing disc trade fields");
      }
      await mustDeliver("the disc-trade notification", notifyAdminDiscTrade(payload));
      return;

    case "telegram_admin_used_listing":
      if (!payload?.listingId || !payload?.title || !payload?.user) {
        throw new Error("Missing used listing fields");
      }
      await mustDeliver("the used-listing notification", notifyAdminUsedListing(payload));
      return;

    case "telegram_user_admin_message":
      if (!payload?.userId || !payload?.threadId || !payload?.messageText) {
        throw new Error("Missing user message fields");
      }
      await notifyUserAdminMessage(payload);
      return;

    case "telegram_user_order_status":
      if (!payload?.userId || !payload?.order) throw new Error("Missing order status fields");
      await notifyUserOrderStatus(payload);
      return;

    case "telegram_send_raw":
      if (!payload?.chatId || !payload?.text) throw new Error("Missing Telegram fields");
      await sendTelegramMessage(payload.chatId, payload.text, payload.options);
      return;

    case "scheduled_tasks":
    case "process_auto_scheduled_tasks":
      await processAutoScheduledTasks();
      return;

    case "digital_delivery_maintenance":
    case "process_digital_delivery":
    case "auto_complete_delivery":
      // Current delivery architecture owns OTP and per-item completion rules.
      await processDigitalDeliveryMaintenance(payload?.now);
      return;

    case "process_bot_trading":
      await processBotTrading();
      return;

    case "chat_queue_process":
    case "process_inactivity_and_queue": {
      const { processInactivityAndQueue } = await import("./chat-queue.server");
      await processInactivityAndQueue();
      return;
    }

    default:
      console.log(`[queue:${queueName}] acknowledged unsupported message type '${type}'`);
  }
}

export async function handleQueueBatch(batch: CloudflareMessageBatch, env: any): Promise<void> {
  if (env) publishEnv(env);
  const queueName = batch.queue || "default";

  for (const message of batch.messages) {
    const attempts = message.attempts || 1;
    const envelope = envelopeOf(message.body);
    const dedupeKey = envelope.dedupeKey || message.id;

    try {
      if (await wasProcessed(dedupeKey)) {
        message.ack();
        continue;
      }

      await dispatch(envelope.type, envelope.payload, queueName);
      await markProcessed(dedupeKey, queueName, envelope.type, attempts);
      message.ack();
    } catch (error) {
      console.error(`[queue:${queueName}] message ${message.id} failed`, error);
      if (attempts < 5) {
        message.retry({ delaySeconds: Math.min(300, 5 * 2 ** attempts) });
      } else {
        message.ack();
      }
    }
  }
}
