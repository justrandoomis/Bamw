/**
 * Banana Balance & Transaction Engine.
 *
 * Single source of truth for banana balance management.
 * Canonical storage is `users.banana_balance` and `users.banana_locked`.
 * All modifications are logged to `banana_transactions` with optional idempotency keys.
 */

import { d1First, d1BatchRun, d1RunChanges, d1Ready } from "./d1.server";

export interface BananaBalanceResult {
  balance: number;
  locked: number;
}

/**
 * Get user's current banana balance & locked balance from users table (canonical).
 */
export async function getUserBananaBalance(userId: string): Promise<BananaBalanceResult> {
  if (!userId) return { balance: 0, locked: 0 };
  if (!(await d1Ready())) {
    return { balance: 0, locked: 0 };
  }

  const row = await d1First<{ banana_balance: number; banana_locked: number }>(
    `SELECT banana_balance, banana_locked FROM users WHERE id = ? LIMIT 1`,
    userId,
  );

  return {
    balance: Number(row?.banana_balance ?? 0),
    locked: Number(row?.banana_locked ?? 0),
  };
}

/**
 * Credit bananas to a user with transaction logging and idempotency check.
 */
export async function creditBananaBalance(
  userId: string,
  amount: number,
  options: {
    reason: string;
    kind?: "grant" | "trade" | "reward" | "refund" | "admin";
    meta?: Record<string, unknown>;
    idempotencyKey?: string;
  },
): Promise<{ success: boolean; newBalance: number }> {
  if (amount <= 0 || !userId) {
    const current = await getUserBananaBalance(userId);
    return { success: false, newBalance: current.balance };
  }

  if (!(await d1Ready())) {
    return { success: true, newBalance: amount };
  }

  const now = new Date().toISOString();
  const txId =
    options.idempotencyKey || `tx_b_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const kind = options.kind || "grant";
  const metaJson = JSON.stringify({ reason: options.reason, ...options.meta });

  // Check idempotency if key provided
  if (options.idempotencyKey) {
    const existing = await d1First<{ id: string }>(
      `SELECT id FROM banana_transactions WHERE id = ? LIMIT 1`,
      options.idempotencyKey,
    );
    if (existing) {
      const current = await getUserBananaBalance(userId);
      return { success: true, newBalance: current.balance };
    }
  }

  await d1BatchRun([
    // 1. Canonical update in users table
    {
      sql: `UPDATE users SET banana_balance = banana_balance + ? WHERE id = ?`,
      binds: [amount, userId],
    },
    /*
      `banana_wallets` was kept "in sync for backwards compatibility" with
      nothing. Nothing in the repository has ever INSERTed a row into that
      table, and nothing reads it — so this statement, and its sibling in the
      debit below, matched zero rows on every single balance movement in the
      shop's history.

      Two statements per movement, on a Worker this repository documents
      elsewhere as CPU-bound, to keep a table in sync with a table that is
      empty. The table itself is left in place: dropping it is a schema change
      that buys nothing, and an empty unused table costs nothing to keep.
    */
    // 3. Ledger record in banana_transactions
    {
      sql: `INSERT INTO banana_transactions (id, user_id, kind, amount, meta, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      binds: [txId, userId, kind, amount, metaJson, now],
    },
  ]);

  const current = await getUserBananaBalance(userId);
  return { success: true, newBalance: current.balance };
}

/**
 * Debit bananas from a user if balance is sufficient.
 */
export async function debitBananaBalance(
  userId: string,
  amount: number,
  options: {
    reason: string;
    kind?: "spend" | "listing_fee" | "penalty" | "trade";
    meta?: Record<string, unknown>;
    idempotencyKey?: string;
  },
): Promise<{ success: boolean; newBalance: number; error?: string }> {
  if (amount <= 0 || !userId) {
    const current = await getUserBananaBalance(userId);
    return { success: false, newBalance: current.balance, error: "invalid_amount" };
  }

  if (!(await d1Ready())) {
    return { success: true, newBalance: 0 };
  }

  const current = await getUserBananaBalance(userId);
  if (current.balance < amount) {
    return { success: false, newBalance: current.balance, error: "insufficient_balance" };
  }

  const now = new Date().toISOString();
  const txId =
    options.idempotencyKey || `tx_b_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const kind = options.kind || "spend";
  const metaJson = JSON.stringify({ reason: options.reason, ...options.meta });

  /*
    The key, actually looked up.

    `creditBananaBalance` above checks its `idempotencyKey` before doing
    anything; this took the same option, used it only as the ledger row's id,
    and never asked whether that row already existed. So an
    "idempotent" debit was not one: a retried request — a double-tapped
    button, a client retry on a timeout — took the bananas a second time and
    failed on the ledger's primary key AFTER the balance had already moved.
    Every caller that passed a key believed it was protected and none of them
    were.

    Checked before the guarded UPDATE, so a replay costs a read and changes
    nothing.
  */
  if (options.idempotencyKey) {
    const existing = await d1First<{ id: string }>(
      `SELECT id FROM banana_transactions WHERE id = ? LIMIT 1`,
      options.idempotencyKey,
    );
    if (existing) {
      const already = await getUserBananaBalance(userId);
      return { success: true, newBalance: already.balance };
    }
  }

  // The balance read above can go stale before the write lands, so the debit
  // carries its own `banana_balance >= ?` guard and is applied on its own. That
  // single guarded statement is what makes overdrawing and double-spending
  // impossible under concurrent requests; the bookkeeping writes below only run
  // once it has actually applied.
  //
  // An earlier version wrote NULL into banana_balance when the guard failed.
  // The column is NOT NULL, so that aborted the whole batch and reached the
  // caller as a raw exception instead of a clean `insufficient_balance`.
  const debited = await d1RunChanges(
    `UPDATE users SET banana_balance = banana_balance - ? WHERE id = ? AND banana_balance >= ?`,
    amount,
    userId,
    amount,
  );

  if (debited !== 1) {
    const latest = await getUserBananaBalance(userId);
    return { success: false, newBalance: latest.balance, error: "insufficient_balance" };
  }

  await d1BatchRun([
    // Mirror wallet, kept in sync for backwards compatibility.
    // The debit's half of the same dead pair — see the credit above.
    // Ledger record.
    {
      sql: `INSERT INTO banana_transactions (id, user_id, kind, amount, meta, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      binds: [txId, userId, kind, -amount, metaJson, now],
    },
  ]);

  const updated = await getUserBananaBalance(userId);
  return { success: true, newBalance: updated.balance };
}

/**
 * The same debit, made safe against two requests arriving at the same instant.
 *
 * ## What the ordinary debit cannot do
 *
 * `debitBananaBalance` looks its idempotency key up and then, if it is absent,
 * debits. Two statements, and between them a window. Sequentially that window
 * never opens and the key works exactly as advertised; concurrently BOTH
 * requests find the key absent, BOTH pass the guarded `banana_balance >= ?`
 * update — which is individually correct and has no idea another copy of
 * itself is running — and the second one's ledger insert then fails on the
 * primary key. The member has paid twice and one of the payments has no record.
 *
 * That is not hypothetical: it is what a concurrent-sell test produced, as a
 * raw `UNIQUE constraint failed: banana_transactions.id` thrown out of a batch
 * after the balance had already moved twice.
 *
 * ## How this closes it
 *
 * The LEDGER ROW IS THE CLAIM, and the debit is chained behind it:
 *
 *   1. insert the ledger row, whose id is the idempotency key. Two requests
 *      race here and exactly one wins — the primary key decides, not a read;
 *   2. debit, guarded on sufficiency AND on `changes() = 1`, so only the
 *      winner's debit runs;
 *   3. delete the claim again `WHERE changes() = 0` — the case where the
 *      claim was won but the balance was too low, which must not leave a
 *      ledger row for money that never moved.
 *
 * One batch, three statements, and no step depends on a transaction rolling
 * back. The loser of the race is told it is a replay, which is the truth: the
 * work its key names has been done, once.
 *
 * Kept as a separate function rather than replacing the original, because
 * every existing caller's behaviour is pinned by tests written against the
 * sequential path, and the difference only matters where a caller can really
 * be raced. New money paths use this one.
 */
export async function debitBananaBalanceAtomic(
  userId: string,
  amount: number,
  options: {
    reason: string;
    kind?: "spend" | "listing_fee" | "penalty" | "trade";
    meta?: Record<string, unknown>;
    /** Required here, unlike the original: without it there is nothing to claim. */
    idempotencyKey: string;
  },
): Promise<{ success: boolean; newBalance: number; error?: string; replay?: boolean }> {
  if (!userId || !(amount > 0) || !Number.isFinite(amount)) {
    const current = await getUserBananaBalance(userId);
    return { success: false, newBalance: current.balance, error: "invalid_amount" };
  }
  const txId = String(options.idempotencyKey ?? "");
  if (!txId) {
    const current = await getUserBananaBalance(userId);
    return { success: false, newBalance: current.balance, error: "invalid_amount" };
  }
  if (!(await d1Ready())) return { success: true, newBalance: 0 };

  const now = new Date().toISOString();
  const kind = options.kind || "spend";
  const metaJson = JSON.stringify({ reason: options.reason, ...options.meta });

  let claimRefused = false;
  try {
    await d1BatchRun([
      {
        sql: `INSERT INTO banana_transactions (id, user_id, kind, amount, meta, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        binds: [txId, userId, kind, -amount, metaJson, now],
      },
      {
        sql: `UPDATE users SET banana_balance = banana_balance - ?
               WHERE id = ? AND banana_balance >= ? AND changes() = 1`,
        binds: [amount, userId, amount],
      },
      {
        /*
          The claim, given back when the debit did not apply. `changes()` here
          is the UPDATE's, so this deletes exactly when the balance was too
          low — and never when the money moved.
        */
        sql: `DELETE FROM banana_transactions WHERE id = ? AND changes() = 0`,
        binds: [txId],
      },
    ]);
  } catch {
    /* The primary key refused the claim: somebody else's copy of this got there. */
    claimRefused = true;
  }

  const landed = await d1First<{ id?: string }>(
    `SELECT id FROM banana_transactions WHERE id = ? LIMIT 1`,
    txId,
  ).catch(() => undefined);
  const balance = (await getUserBananaBalance(userId)).balance;

  if (landed?.id) {
    /*
      The row is there. Either this call wrote it or an identical one did, and
      in both cases the amount has been taken exactly once — which is what the
      caller needs to know.
    */
    return { success: true, newBalance: balance, replay: claimRefused };
  }
  return { success: false, newBalance: balance, error: "insufficient_balance" };
}
