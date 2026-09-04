/**
 * A durable trace of admin notifications that did not arrive.
 *
 * ## Why this exists
 *
 * A top-up notification was attempted at 07:16 and never appeared in the
 * group. Everything needed to explain that was logged — `callTelegram` prints
 * Telegram's own `error_code` and `description` — and all of it was gone by
 * the time anyone asked, because a Worker's console output lives in a log
 * stream nobody was tailing. The question "why did that one not arrive" could
 * only be answered by being lucky enough to be watching when it happened
 * again.
 *
 * So a failure now leaves a row. It is the difference between a shop owner
 * saying "notifications don't work" and being able to answer "Telegram
 * refused it with 'chat not found' at 07:16" without reproducing anything.
 *
 * ## What is stored, and what is not
 *
 * The kind, whether it succeeded, and Telegram's own status, error code and
 * description. Never the message body: an admin notification names a
 * customer, their phone and what they bought, and a diagnostics table is
 * exactly the kind of place that data should not accumulate. The route is
 * recorded as a fingerprint, not a chat id, for the same reason — it answers
 * "was this the group or the old private chat" without storing either.
 *
 * The module is deliberately not called anything with "delivery" in it. In
 * this codebase that word means handing a customer their purchased account,
 * and a test guards that path against growing modules nobody has audited.
 * This is about a Telegram message that did not send.
 *
 * ## Why the table is created lazily
 *
 * The schema bootstrap runs on a version bump, and bumping it is what wedged
 * production once already. A diagnostics table that only the failure path
 * touches does not justify that risk, and `queue-consumer.server.ts` already
 * establishes the pattern of a `CREATE TABLE IF NOT EXISTS` guarded by a
 * module-level flag.
 */

import { d1Run } from "./d1.server";

let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await d1Run(`
    CREATE TABLE IF NOT EXISTS telegram_send_failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      route TEXT,
      status INTEGER,
      error_code INTEGER,
      description TEXT,
      failed_at TEXT NOT NULL
    )
  `);
  tableReady = true;
}

export interface SendFailure {
  kind: string;
  /** A fingerprint of the destination, never the chat id itself. */
  route?: string;
  status?: number;
  errorCode?: number;
  description?: string;
  now?: string;
}

/**
 * Record one failed admin notification.
 *
 * Never throws. This is a note about a failure; it must not become a second
 * one, and it must never be the reason an order or a top-up is reported as
 * broken.
 */
export async function recordSendFailure(failure: SendFailure): Promise<void> {
  try {
    await ensureTable();
    await d1Run(
      `INSERT INTO telegram_send_failures
         (kind, route, status, error_code, description, failed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      failure.kind,
      failure.route ?? null,
      Number.isFinite(failure.status) ? Number(failure.status) : null,
      Number.isFinite(failure.errorCode) ? Number(failure.errorCode) : null,
      /*
        Telegram's descriptions are short and fixed — "Bad Request: chat not
        found". The cap is only so that an unexpected upstream cannot write an
        unbounded string into a diagnostics table.
      */
      failure.description ? String(failure.description).slice(0, 300) : null,
      failure.now ?? new Date().toISOString(),
    );

    /*
      Keep the newest hundred. The table answers "what went wrong recently";
      an unbounded log of failures would grow without anyone deciding to keep
      it, and D1 rows are not free.
    */
    await d1Run(
      `DELETE FROM telegram_send_failures
        WHERE id <= (SELECT MAX(id) - 100 FROM telegram_send_failures)`,
    );
  } catch (error) {
    console.warn("[telegram:send_log_failed]", {
      kind: failure.kind,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
