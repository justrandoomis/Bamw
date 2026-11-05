import { encryptSecretValue, decryptSecretValue, randomId } from "./crypto.server";
import { d1All, d1First, d1Run, d1RunChanges } from "./d1.server";
import { joinShared, SCHEMA_WAIT_MS, trackShared } from "./shared-wait.server";

/**
 * Bulk-prepared account credentials, released to the buyer one at a time.
 *
 * An order line can carry `quantity: 3` — three accounts of the same game — but
 * an OrderItem only has room for a single `deliveryEmail`/`deliveryPasswordEnc`
 * pair. Staff therefore had to sit with the buyer and type each account in as
 * the previous one was finished.
 *
 * Accounts are now staged as a batch up front and released in sequence: the
 * next one is sent only once the buyer has finished registering the one before
 * it, so the buyer is never handed several accounts at once and staff never
 * have to be present for the hand-off.
 */
export interface StagedAccount {
  email: string;
  password?: string;
}

export interface BatchEntry {
  id: string;
  seq: number;
  email: string;
  status: "staged" | "sent" | "registered";
  sent_at: string | null;
  registered_at: string | null;
}

export interface BatchProgress {
  total: number;
  staged: number;
  sent: number;
  registered: number;
  /** The account currently with the buyer, if any. */
  current?: BatchEntry;
  next?: BatchEntry;
  entries: BatchEntry[];
}

const TABLE = `CREATE TABLE IF NOT EXISTS order_account_batch (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  email TEXT NOT NULL,
  password_enc TEXT,
  status TEXT NOT NULL DEFAULT 'staged',
  sent_at TEXT,
  registered_at TEXT,
  created_at TEXT NOT NULL
)`;

let ready: Promise<void> | undefined;

async function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await d1Run(TABLE);
      await d1Run(
        `CREATE UNIQUE INDEX IF NOT EXISTS order_account_batch_seq_idx
         ON order_account_batch (order_id, item_id, seq)`,
      );
      await d1Run(
        `CREATE INDEX IF NOT EXISTS order_account_batch_item_idx
         ON order_account_batch (order_id, item_id, status)`,
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
    label: "account-batch-schema",
    waitMs: SCHEMA_WAIT_MS,
    restart: () => {
      if (ready === shared) ready = undefined;
      return ensureSchema();
    },
  });
}

/**
 * Stage a batch of accounts for one order line.
 *
 * Appends after whatever is already staged, so staff can top a batch up without
 * disturbing accounts already sent.
 */
export async function stageAccountBatch(
  orderId: string,
  itemId: string,
  accounts: StagedAccount[],
): Promise<number> {
  await ensureSchema();
  const clean = accounts
    .map((entry) => ({ email: String(entry.email ?? "").trim(), password: entry.password }))
    .filter((entry) => entry.email.length > 0);
  if (!clean.length) return 0;

  const highest = await d1First<{ seq: number | null }>(
    `SELECT MAX(seq) AS seq FROM order_account_batch WHERE order_id = ? AND item_id = ?`,
    orderId,
    itemId,
  );
  let seq = Number(highest?.seq ?? 0);
  const now = new Date().toISOString();

  for (const entry of clean) {
    seq += 1;
    await d1Run(
      `INSERT INTO order_account_batch (id, order_id, item_id, seq, email, password_enc, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'staged', ?)`,
      randomId("oab"),
      orderId,
      itemId,
      seq,
      entry.email,
      entry.password ? await encryptSecretValue(entry.password) : null,
      now,
    );
  }
  return clean.length;
}

/**
 * Claim the next staged account for delivery.
 *
 * The claim is a guarded UPDATE, so two staff members pressing "send" at the
 * same moment cannot hand the buyer two different accounts: exactly one of them
 * sees `changes() = 1` and the other is told there is nothing to release.
 * Returns the credentials to deliver, or undefined when the batch is exhausted
 * or an account is already awaiting registration.
 */
export async function claimNextAccount(
  orderId: string,
  itemId: string,
): Promise<{ seq: number; email: string; password?: string } | undefined> {
  await ensureSchema();

  // Never run ahead of the buyer: one outstanding account at a time.
  const outstanding = await d1First<{ id: string }>(
    `SELECT id FROM order_account_batch
     WHERE order_id = ? AND item_id = ? AND status = 'sent' LIMIT 1`,
    orderId,
    itemId,
  );
  if (outstanding) return undefined;

  const candidate = await d1First<{
    id: string;
    seq: number;
    email: string;
    password_enc: string | null;
  }>(
    `SELECT id, seq, email, password_enc FROM order_account_batch
     WHERE order_id = ? AND item_id = ? AND status = 'staged'
     ORDER BY seq ASC LIMIT 1`,
    orderId,
    itemId,
  );
  if (!candidate) return undefined;

  const claimed = await d1RunChanges(
    `UPDATE order_account_batch SET status = 'sent', sent_at = ?
     WHERE id = ? AND status = 'staged'`,
    new Date().toISOString(),
    candidate.id,
  );
  if (claimed !== 1) return undefined;

  let password: string | undefined;
  if (candidate.password_enc) {
    try {
      password = await decryptSecretValue(candidate.password_enc);
    } catch {
      password = undefined;
    }
  }
  return { seq: candidate.seq, email: candidate.email, ...(password ? { password } : {}) };
}

/**
 * Mark the outstanding account as registered by the buyer.
 *
 * Returns true when something was actually closed out, so the caller knows
 * whether releasing the next one is warranted.
 */
export async function markAccountRegistered(orderId: string, itemId: string): Promise<boolean> {
  await ensureSchema();
  const changed = await d1RunChanges(
    `UPDATE order_account_batch SET status = 'registered', registered_at = ?
     WHERE id = (
       SELECT id FROM order_account_batch
       WHERE order_id = ? AND item_id = ? AND status = 'sent'
       ORDER BY seq ASC LIMIT 1
     )`,
    new Date().toISOString(),
    orderId,
    itemId,
  );
  return changed === 1;
}

export async function getBatchProgress(orderId: string, itemId: string): Promise<BatchProgress> {
  await ensureSchema();
  const rows = await d1All<BatchEntry & { password_enc?: string }>(
    `SELECT id, seq, email, status, sent_at, registered_at FROM order_account_batch
     WHERE order_id = ? AND item_id = ? ORDER BY seq ASC`,
    orderId,
    itemId,
  );
  const entries = rows.map(({ id, seq, email, status, sent_at, registered_at }) => ({
    id,
    seq: Number(seq),
    email,
    status,
    sent_at: sent_at ?? null,
    registered_at: registered_at ?? null,
  }));
  const current = entries.find((entry) => entry.status === "sent");
  const next = entries.find((entry) => entry.status === "staged");
  return {
    total: entries.length,
    staged: entries.filter((entry) => entry.status === "staged").length,
    sent: entries.filter((entry) => entry.status === "sent").length,
    registered: entries.filter((entry) => entry.status === "registered").length,
    ...(current ? { current } : {}),
    ...(next ? { next } : {}),
    entries,
  };
}
