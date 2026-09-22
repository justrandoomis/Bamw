/**
 * Selling bananas to the shop itself, at the shop's own price.
 *
 * «بيع الموز مباشرة للنظام بسعر السوق الحالي… السعر المستخدم في التنفيذ
 * النهائي يجب أن يأتي من السيرفر لحظة تنفيذ البيع. لا تثق بالسعر أو الناتج أو
 * الرصيد القادم من Client.»
 *
 * This replaces the marketplace, and the difference is not cosmetic. A listing
 * was an offer waiting for another member to take it: a row, a lock on the
 * seller's bananas, a promotion fee, a commission, a bot pretending to be a
 * buyer. A direct sale has one counterparty — the shop — and settles at once.
 *
 * ## The price is never the browser's
 *
 * `spotPriceAt(config, now)` is a pure function of the admin's configuration
 * and the clock, so every member sees the same market at the same moment and
 * nobody can send a better one. The sheet shows a quote; this recomputes at the
 * instant of execution and RETURNS what it used, because «إذا تغير سعر السوق
 * بين فتح النافذة والتنفيذ، السعر النهائي هو سعر السيرفر وقت التنفيذ، ويجب أن
 * يعرض الرد السعر الفعلي الذي تم التنفيذ به».
 *
 * ## Why this does not write to `users.banana_balance` itself
 *
 * There are already three writers of that column and two of them bypass the
 * ledger. Becoming a fourth would make the ledger a partial record of the
 * shop's own currency. So the banana side goes through `debitBananaBalance`,
 * which is the sanctioned one: one guarded statement that cannot overdraw, its
 * ledger row in the same batch, and an idempotency key that makes a retry a
 * no-op.
 *
 * ## The two halves, and the gap between them
 *
 * Bananas leave through one module and dinars arrive through another, so they
 * cannot be one statement. The gap is handled the way `buyTickets` handles the
 * identical gap: one reference across both, the second half's failure refunds
 * the first under a key derived from it, and a refund that does not land is
 * REPORTED rather than assumed — a member told their bananas came back who
 * finds they did not has been lied to about something they owned.
 */

import { randomId } from "./crypto.server";
import { d1All, d1BatchRun, d1First, d1Run, getD1 } from "./d1.server";
import { getMarketConfig, spotPriceAt } from "./banana-market-config.server";
import { getUserBananaBalance } from "./banana-balance.server";

/** The fewest bananas a sale may be, so the ledger is not filled with dust. */
export const MIN_SELL_QUANTITY = 100;
/** And a ceiling, so a quantity cannot overflow past the balance check. */
export const MAX_SELL_QUANTITY = 100_000_000;

export interface SellReceipt {
  quantity: number;
  /** The price this sale actually executed at, in IQD per banana. */
  pricePerBanana: number;
  /** What the member was paid, in IQD. */
  proceeds: number;
  bananaBalance: number;
  walletBalance: number;
  /** True when this request had already been executed and is being echoed. */
  replay: boolean;
}

export type SellResult =
  | ({ ok: true } & SellReceipt)
  | {
      ok: false;
      reason:
        | "disabled"
        | "bad_quantity"
        | "bad_request"
        | "insufficient_bananas"
        | "no_price"
        | "in_progress"
        | "too_small"
        | "failed"
        /** Paid in bananas, no dinars, and the refund did not land either. */
        | "failed_not_refunded";
    };

let schemaReady: Promise<void> | undefined;

/**
 * The record of every direct sale.
 *
 * Its own table, created on first use — see `roulette-pool.server.ts` for why
 * nothing new goes into the bootstrap's `SCHEMA`. It is both the audit trail
 * «تسجيل السعر المستخدم، الكمية، المقابل بالدينار» and the replay key: a
 * request that has already executed is answered from this row rather than
 * executed again.
 */
export function ensureBananaSellSchema(): Promise<void> {
  if (!getD1()) return Promise.resolve();
  if (!schemaReady) {
    schemaReady = (async () => {
      await d1Run(`
        CREATE TABLE IF NOT EXISTS banana_direct_sales (
          id               TEXT PRIMARY KEY,
          user_id          TEXT NOT NULL,
          request_id       TEXT NOT NULL,
          quantity         INTEGER NOT NULL,
          price_per_banana REAL NOT NULL,
          proceeds_iqd     REAL NOT NULL,
          status           TEXT NOT NULL DEFAULT 'settled',
          created_at       TEXT NOT NULL
        )
      `);
      /*
        Per MEMBER and request. The same lesson the ticket ledger's index
        records: a bare unique on the request id would mean one member's
        "sell-1" silently refuses everybody else's.
      */
      await d1Run(
        `CREATE UNIQUE INDEX IF NOT EXISTS banana_direct_sales_user_request_idx
           ON banana_direct_sales (user_id, request_id)`,
      );
      await d1Run(
        `CREATE INDEX IF NOT EXISTS banana_direct_sales_user_idx
           ON banana_direct_sales (user_id, created_at DESC)`,
      );
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  return schemaReady;
}

/** A quantity this will actually execute, or null. */
export function validSellQuantity(raw: unknown): number | null {
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string" && /^\s*\d+\s*$/.test(raw)) n = Number(raw);
  else return null;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n <= 0 || n > MAX_SELL_QUANTITY) return null;
  return n;
}

/**
 * What a quantity is worth right now, for the sheet to show before it is sold.
 *
 * A QUOTE, and named one. It is what the member sees while they choose, and it
 * is explicitly not what they are paid — `sellBananas` recomputes at execution.
 */
export async function quoteSale(quantity: number, at: number = Date.now()) {
  const config = await getMarketConfig();
  const price = spotPriceAt(config, at);
  const qty = validSellQuantity(quantity) ?? 0;
  return {
    pricePerBanana: price,
    quantity: qty,
    proceeds: Math.floor(qty * price),
    enabled: config.directSellEnabled !== false,
    minQuantity: MIN_SELL_QUANTITY,
  };
}

/** A sale already executed under this request, or null. */
async function readSale(userId: string, requestId: string) {
  const row = await d1First<Record<string, unknown>>(
    `SELECT * FROM banana_direct_sales WHERE user_id = ? AND request_id = ?`,
    userId,
    requestId,
  ).catch(() => undefined);
  if (!row || !row["id"]) return null;
  return row;
}

export async function sellBananas(input: {
  userId: string;
  quantity: unknown;
  requestId: string;
  now?: string;
}): Promise<SellResult> {
  const userId = String(input.userId ?? "");
  const requestId = String(input.requestId ?? "")
    .replace(/[^\w-]/g, "")
    .slice(0, 64);
  const quantity = validSellQuantity(input.quantity);

  if (!userId || !getD1()) return { ok: false, reason: "failed" };
  if (!requestId) return { ok: false, reason: "bad_request" };
  if (quantity === null) return { ok: false, reason: "bad_quantity" };
  if (quantity < MIN_SELL_QUANTITY) return { ok: false, reason: "too_small" };

  await ensureBananaSellSchema();
  const nowIso = input.now ?? new Date().toISOString();
  const at = Date.parse(nowIso) || Date.now();

  const config = await getMarketConfig();
  /*
    The switch the owner asked for: «تعطيل/تفعيل البيع المباشر عند الحاجة».
    Checked before anything is read about the member, so a closed market costs
    nothing to refuse.
  */
  if (config.directSellEnabled === false) return { ok: false, reason: "disabled" };

  /* Already done. Echo it, with the price it really executed at. */
  const already = await readSale(userId, requestId);
  if (already && String(already["status"] ?? "settled") === "settled") {
    return {
      ok: true,
      quantity: Number(already["quantity"]) || 0,
      pricePerBanana: Number(already["price_per_banana"]) || 0,
      proceeds: Number(already["proceeds_iqd"]) || 0,
      bananaBalance: (await getUserBananaBalance(userId).catch(() => ({ balance: 0 }))).balance,
      walletBalance: await readWallet(userId),
      replay: true,
    };
  }

  /*
    THE PRICE, AT THIS INSTANT, ON THE SERVER. Not the one the sheet quoted and
    not one that arrived in the request.
  */
  const pricePerBanana = spotPriceAt(config, at);
  if (!(pricePerBanana > 0)) return { ok: false, reason: "no_price" };

  /*
    Floored, not rounded. A member is never paid a fraction of a dinar, and
    rounding up would let a large number of tiny sales mint money out of the
    rounding — which is why there is a minimum quantity as well.
  */
  const proceeds = Math.floor(quantity * pricePerBanana);
  if (!(proceeds > 0)) return { ok: false, reason: "too_small" };

  /*
    THE SALE ROW IS THE CLAIM, AND IT IS WRITTEN BEFORE ANY MONEY MOVES.

    The first version claimed nothing and leaned on the debit's own idempotency
    key. Two requests fired at the same instant then did this: the winner
    debited and paid, the loser's debit came back "already done — replay", and
    the loser CARRIED ON to credit the wallet a second time. The member ended
    with twice the dinars, and when the loser's sale row finally collided it
    refunded the bananas too. Both halves wrong, from one missing claim.

    So the claim comes first and it is the row itself. Exactly one request can
    insert it; everybody else is told what happened rather than doing it again.
  */
  const saleId = randomId("bds");
  let claimRefused = false;
  try {
    await d1Run(
      `INSERT INTO banana_direct_sales
         (id, user_id, request_id, quantity, price_per_banana, proceeds_iqd, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'claiming', ?)`,
      saleId,
      userId,
      requestId,
      quantity,
      pricePerBanana,
      proceeds,
      nowIso,
    );
  } catch {
    claimRefused = true;
  }
  if (claimRefused) {
    const winner = await readSale(userId, requestId);
    if (winner && String(winner["status"] ?? "settled") === "settled") {
      return {
        ok: true,
        quantity: Number(winner["quantity"]) || 0,
        pricePerBanana: Number(winner["price_per_banana"]) || 0,
        proceeds: Number(winner["proceeds_iqd"]) || 0,
        bananaBalance: (await getUserBananaBalance(userId).catch(() => ({ balance: 0 }))).balance,
        walletBalance: await readWallet(userId),
        replay: true,
      };
    }
    /*
      The winner is still settling. Saying "done" would be a guess about money,
      and saying "failed" would invite a retry that cannot succeed — so the
      caller is told plainly to look again.
    */
    return { ok: false, reason: "in_progress" };
  }

  const reference = `bsell_${userId}_${requestId}`;
  const walletTxId = `wtx_bds_${saleId}`;

  /*
    The ATOMIC debit, not the ordinary one.

    `debitBananaBalance` checks its idempotency key and then debits — two
    statements with a window between them that only opens under a real race,
    where both copies pass the check, both debit, and the second's ledger row
    fails on the primary key with the balance already down twice.
  */
  const { debitBananaBalanceAtomic, creditBananaBalance } = await import(
    "./banana-balance.server"
  );
  const paid = await debitBananaBalanceAtomic(userId, quantity, {
    reason: `بيع ${quantity} موزة للسوق`,
    kind: "spend",
    idempotencyKey: reference,
    meta: { pricePerBanana, proceeds, requestId },
  });
  if (!paid.success) {
    /* Nothing moved, so the claim is given back and the id can be reused. */
    await d1Run(
      `DELETE FROM banana_direct_sales WHERE id = ? AND status = 'claiming'`,
      saleId,
    ).catch(() => undefined);
    return {
      ok: false,
      reason: paid.error === "insufficient_balance" ? "insufficient_bananas" : "failed",
    };
  }

  try {
    /*
      The dinars, the statement that explains them, and the settle — one batch,
      chained. The wallet row's id is derived from the sale, so a retry of this
      batch cannot pay twice: the primary key refuses the second one.
    */
    await d1BatchRun([
      {
        sql: `UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?`,
        binds: [proceeds, userId],
      },
      {
        /*
          «كشف المحفظة» renders this table. Money that arrives with no row here
          is money the member cannot explain — the same complaint as a purchase
          that is not deducted, from the other direction.
        */
        sql: `INSERT INTO wallet_transactions (id, user_id, kind, amount, description, order_id, created_at)
              SELECT ?, ?, 'payout', ?, ?, '', ? WHERE changes() = 1`,
        binds: [
          walletTxId,
          userId,
          proceeds,
          `بيع ${quantity} موزة بسعر ${pricePerBanana}`.slice(0, 180),
          nowIso,
        ],
      },
      {
        sql: `UPDATE banana_direct_sales SET status = 'settled'
               WHERE id = ? AND status = 'claiming' AND changes() = 1`,
        binds: [saleId],
      },
    ]);
  } catch {
    /* Reported by the verification below, which asks rather than assumes. */
  }

  /*
    DID THE MONEY ARRIVE? Asked, not assumed.

    On the REST transport an error can come out of reading the response after
    the write has already run, so "it threw" does not mean "it did not happen".
    The wallet row is the evidence: it exists only when the credit applied, and
    its id is derived from this sale so it cannot belong to another.
  */
  const creditLanded = await d1First<{ id?: string }>(
    `SELECT id FROM wallet_transactions WHERE id = ? LIMIT 1`,
    walletTxId,
  ).catch(() => undefined);

  if (creditLanded?.id) {
    /* Settle the row if the batch did not get that far; the money is right. */
    await d1Run(
      `UPDATE banana_direct_sales SET status = 'settled' WHERE id = ? AND status = 'claiming'`,
      saleId,
    ).catch(() => undefined);
    return {
      ok: true,
      quantity,
      pricePerBanana,
      proceeds,
      bananaBalance: paid.newBalance,
      walletBalance: await readWallet(userId),
      replay: false,
    };
  }

  /*
    Bananas taken and no dinars paid. They go back under a key derived from the
    sale's own, so a retry of the refund cannot double it — and whether the
    refund landed is reported rather than claimed.
  */
  await d1Run(
    `DELETE FROM banana_direct_sales WHERE id = ? AND status = 'claiming'`,
    saleId,
  ).catch(() => undefined);
  const refunded = await creditBananaBalance(userId, quantity, {
    reason: "تعذّر إتمام البيع — إعادة الموز",
    kind: "refund",
    idempotencyKey: `${reference}:refund`,
  }).catch(() => ({ success: false, newBalance: 0 }));
  return { ok: false, reason: refunded.success ? "failed" : "failed_not_refunded" };
}

async function readWallet(userId: string): Promise<number> {
  const row = await d1First<{ wallet_balance?: number }>(
    `SELECT wallet_balance FROM users WHERE id = ?`,
    userId,
  ).catch(() => undefined);
  return Number(row?.wallet_balance ?? 0) || 0;
}

/** A member's own sales, for the history strip on the market page. */
export async function recentSales(userId: string, limit = 20) {
  if (!userId || !getD1()) return [];
  await ensureBananaSellSchema();
  const list = await d1All<Record<string, unknown>>(
    `SELECT quantity, price_per_banana, proceeds_iqd, created_at
       FROM banana_direct_sales WHERE user_id = ? AND status = 'settled'
      ORDER BY created_at DESC LIMIT ?`,
    userId,
    Math.max(1, Math.min(100, Math.floor(limit))),
  ).catch(() => []);
  return (list ?? []).map((row) => ({
    quantity: Number(row["quantity"]) || 0,
    pricePerBanana: Number(row["price_per_banana"]) || 0,
    proceeds: Number(row["proceeds_iqd"]) || 0,
    at: String(row["created_at"] ?? ""),
  }));
}
