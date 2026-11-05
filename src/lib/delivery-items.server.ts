/**
 * Per-item delivery rows in D1: the source of truth for what an admin has
 * prepared and how far each order line has got.
 *
 * The delivery tool used to hold all of this in React state. A refresh, a
 * closed tab, or a second admin opening the same order lost everything typed
 * so far, and there was no way to answer "which of these four games has
 * actually been sent?" except by reading timestamps scattered across the order
 * items. One row per order line, written as the admin types, answers both.
 *
 * Passwords are encrypted at rest with the same helper the order items use, and
 * nothing in this module logs a credential — only ids and statuses.
 */
import { decryptSecretValue, encryptSecretValue, randomId } from "./crypto.server";
import { d1All, d1First, d1Ready, d1Run, d1RunChanges } from "./d1.server";
import {
  advanceDeliveryStatus,
  draftStatus,
  isDraftSendable,
  normalizeDeliveryStatus,
  type DeliveryItemStatus,
} from "./delivery-items";
import { joinShared, SCHEMA_WAIT_MS, trackShared } from "./shared-wait.server";

const TABLE = `CREATE TABLE IF NOT EXISTS delivery_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  product_id TEXT,
  username TEXT,
  password_enc TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  needs_mapping INTEGER NOT NULL DEFAULT 0,
  send_key TEXT,
  draft_updated_at TEXT,
  sent_at TEXT,
  proof_received_at TEXT,
  otp_sent_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

let ready: Promise<void> | undefined;

async function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await d1Run(TABLE);
      // One row per order line — the constraint the whole model rests on.
      await d1Run(
        `CREATE UNIQUE INDEX IF NOT EXISTS delivery_items_item_idx
         ON delivery_items (order_id, item_id)`,
      );
      await d1Run(
        `CREATE INDEX IF NOT EXISTS delivery_items_order_idx
         ON delivery_items (order_id, status)`,
      );
      /*
        The idempotency key for sending. A retried request carrying the same
        key cannot send the same credentials twice.
      */
      await d1Run(
        `CREATE UNIQUE INDEX IF NOT EXISTS delivery_items_send_key_idx
         ON delivery_items (send_key) WHERE send_key IS NOT NULL`,
      );
    })().catch((error) => {
      ready = undefined;
      throw error;
    });
    trackShared(ready);
    return ready;
  }
  const shared = ready;
  return joinShared(shared, {
    label: "delivery-items-schema",
    waitMs: SCHEMA_WAIT_MS,
    restart: () => {
      if (ready === shared) ready = undefined;
      return ensureSchema();
    },
  });
}

interface DeliveryItemRow {
  id: string;
  order_id: string;
  item_id: string;
  product_id: string | null;
  username: string | null;
  password_enc: string | null;
  status: string;
  needs_mapping: number;
  send_key: string | null;
  draft_updated_at: string | null;
  sent_at: string | null;
  proof_received_at: string | null;
  otp_sent_at: string | null;
  completed_at: string | null;
}

export interface DeliveryItem {
  id: string;
  orderId: string;
  itemId: string;
  productId: string | null;
  username: string;
  /** Only ever populated for staff, and never logged. */
  password: string;
  status: DeliveryItemStatus;
  needsMapping: boolean;
  draftUpdatedAt: string | null;
  sentAt: string | null;
  proofReceivedAt: string | null;
  otpSentAt: string | null;
  completedAt: string | null;
}

async function toDeliveryItem(row: DeliveryItemRow): Promise<DeliveryItem> {
  let password = "";
  if (row.password_enc) {
    try {
      password = (await decryptSecretValue(row.password_enc)) ?? "";
    } catch {
      // A password that cannot be decrypted is one the admin retypes; it must
      // not take the row — or the whole list — down.
      password = "";
    }
  }
  return {
    id: row.id,
    orderId: row.order_id,
    itemId: row.item_id,
    productId: row.product_id,
    username: row.username ?? "",
    password,
    status: normalizeDeliveryStatus(row.status),
    needsMapping: Number(row.needs_mapping) === 1,
    draftUpdatedAt: row.draft_updated_at,
    sentAt: row.sent_at,
    proofReceivedAt: row.proof_received_at,
    otpSentAt: row.otp_sent_at,
    completedAt: row.completed_at,
  };
}

/** Everything prepared for one order, oldest line first. */
export async function listDeliveryItems(orderId: string): Promise<DeliveryItem[]> {
  if (!orderId || !(await d1Ready())) return [];
  await ensureSchema();
  const rows = await d1All<DeliveryItemRow>(
    `SELECT * FROM delivery_items WHERE order_id = ? ORDER BY created_at ASC`,
    orderId,
  );
  return Promise.all(rows.map(toDeliveryItem));
}

export interface SaveDraftInput {
  orderId: string;
  itemId: string;
  productId?: string | null;
  username?: string | null;
  password?: string | null;
  needsMapping?: boolean;
}

/**
 * Write what the admin has typed so far.
 *
 * Upsert on (order_id, item_id), so autosaving on every keystroke converges on
 * one row per line rather than a pile of drafts. A row that has already been
 * sent keeps its status: the draft fields are still updated (an admin may be
 * correcting a typo for their own reference) but nothing moves backwards.
 */
export async function saveDeliveryDraft(input: SaveDraftInput): Promise<DeliveryItem | null> {
  const orderId = String(input.orderId ?? "").trim();
  const itemId = String(input.itemId ?? "").trim();
  if (!orderId || !itemId || !(await d1Ready())) return null;
  await ensureSchema();

  const now = new Date().toISOString();
  const username = String(input.username ?? "").trim();
  const password = String(input.password ?? "");
  const needsMapping = input.needsMapping ? 1 : 0;
  const passwordEnc = password ? await encryptSecretValue(password) : null;

  const existing = await d1First<DeliveryItemRow>(
    `SELECT * FROM delivery_items WHERE order_id = ? AND item_id = ?`,
    orderId,
    itemId,
  );

  const nextStatus = existing
    ? advanceDeliveryStatus(
        normalizeDeliveryStatus(existing.status),
        draftStatus({ itemId, username, password, needsMapping: Boolean(needsMapping) }),
      )
    : draftStatus({ itemId, username, password, needsMapping: Boolean(needsMapping) });

  await d1Run(
    `INSERT INTO delivery_items (
       id, order_id, item_id, product_id, username, password_enc, status, needs_mapping,
       draft_updated_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(order_id, item_id) DO UPDATE SET
       product_id = excluded.product_id,
       username = excluded.username,
       password_enc = COALESCE(excluded.password_enc, delivery_items.password_enc),
       status = excluded.status,
       needs_mapping = excluded.needs_mapping,
       draft_updated_at = excluded.draft_updated_at,
       updated_at = excluded.updated_at`,
    existing?.id ?? randomId("dli"),
    orderId,
    itemId,
    input.productId === undefined || input.productId === null ? null : String(input.productId),
    username,
    passwordEnc,
    nextStatus,
    needsMapping,
    now,
    now,
    now,
  );

  const saved = await d1First<DeliveryItemRow>(
    `SELECT * FROM delivery_items WHERE order_id = ? AND item_id = ?`,
    orderId,
    itemId,
  );
  return saved ? await toDeliveryItem(saved) : null;
}

export interface SendResult {
  ok: boolean;
  item?: DeliveryItem;
  /** Set when the send was refused, so the caller can say why. */
  reason?: "not_found" | "incomplete" | "already_sent";
  /** True when this exact send had already been recorded. */
  duplicate?: boolean;
}

/**
 * Record that a line's credentials went out.
 *
 * `sendKey` makes it idempotent: a retried request, a double-clicked button or
 * a reconnecting client that replays its last action carries the same key and
 * the second attempt is recognised rather than sending the customer a second
 * copy of their account.
 */
export async function markDeliverySent(
  orderId: string,
  itemId: string,
  sendKey?: string,
): Promise<SendResult> {
  if (!(await d1Ready())) return { ok: false, reason: "not_found" };
  await ensureSchema();

  const row = await d1First<DeliveryItemRow>(
    `SELECT * FROM delivery_items WHERE order_id = ? AND item_id = ?`,
    orderId,
    itemId,
  );
  if (!row) return { ok: false, reason: "not_found" };

  const item = await toDeliveryItem(row);
  if (!isDraftSendable(item)) return { ok: false, reason: "incomplete", item };

  /*
    Sent once, and only once.

    `sent_at` is the fact; the key is only how a retry recognises itself. An
    earlier version guarded on the key alone, so a *different* key arriving
    after the line was already sent — a stale replay, a second tab — rotated
    the stored key, and the original request retrying after that would have
    counted as new. Anything arriving for a line that has already gone out is a
    duplicate, whatever key it carries.
  */
  if (row.sent_at) {
    return { ok: true, item, duplicate: true };
  }

  const now = new Date().toISOString();
  const changes = await d1RunChanges(
    `UPDATE delivery_items
     SET status = ?, sent_at = ?, send_key = COALESCE(send_key, ?), updated_at = ?
     WHERE order_id = ? AND item_id = ? AND sent_at IS NULL`,
    advanceDeliveryStatus(item.status, "sent"),
    now,
    sendKey ?? null,
    now,
    orderId,
    itemId,
  );
  // Lost the race to a concurrent send: that one is the send, this is a retry.
  if (changes === 0) return { ok: true, item, duplicate: true };

  const saved = await d1First<DeliveryItemRow>(
    `SELECT * FROM delivery_items WHERE order_id = ? AND item_id = ?`,
    orderId,
    itemId,
  );
  return { ok: true, ...(saved ? { item: await toDeliveryItem(saved) } : {}) };
}

/** Move a line forward. Never backward — see `advanceDeliveryStatus`. */
async function stamp(
  orderId: string,
  itemId: string,
  event: "proof_received" | "otp_sent" | "completed",
  column: "proof_received_at" | "otp_sent_at" | "completed_at",
): Promise<DeliveryItem | null> {
  if (!(await d1Ready())) return null;
  await ensureSchema();
  const row = await d1First<DeliveryItemRow>(
    `SELECT * FROM delivery_items WHERE order_id = ? AND item_id = ?`,
    orderId,
    itemId,
  );
  if (!row) return null;

  const now = new Date().toISOString();
  const next = advanceDeliveryStatus(normalizeDeliveryStatus(row.status), event);
  await d1Run(
    `UPDATE delivery_items SET status = ?, ${column} = COALESCE(${column}, ?), updated_at = ?
     WHERE order_id = ? AND item_id = ?`,
    next,
    now,
    now,
    orderId,
    itemId,
  );
  const saved = await d1First<DeliveryItemRow>(
    `SELECT * FROM delivery_items WHERE order_id = ? AND item_id = ?`,
    orderId,
    itemId,
  );
  return saved ? await toDeliveryItem(saved) : null;
}

export const markDeliveryProofReceived = (orderId: string, itemId: string) =>
  stamp(orderId, itemId, "proof_received", "proof_received_at");

export const markDeliveryOtpSent = (orderId: string, itemId: string) =>
  stamp(orderId, itemId, "otp_sent", "otp_sent_at");

export const markDeliveryItemCompleted = (orderId: string, itemId: string) =>
  stamp(orderId, itemId, "completed", "completed_at");
