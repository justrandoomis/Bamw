/**
 * Turning a prize into a real order — when the member asks, and only once.
 *
 * «عند الضغط على استيراد: لا تضف اللعبة للسلة، لا تذهب إلى Checkout، لا تخصم
 * Wallet، لا تطلب Payment. بدلاً من ذلك أنشئ Order مباشرة باستخدام نظام
 * الطلبات الحقيقي الحالي، ثم أنشئ/اربط Order Thread، ثم افتح محادثة الطلب.»
 *
 * The order body already exists and is not rewritten: `createWheelGiftOrder`
 * builds exactly the order the owner described — zero to the member, the real
 * supplier cost against it so the shop's loss is honest, `isGift`, the
 * `wheel_prize` source, a thread, and the delivery records that put it in the
 * admin's ordinary preparation queue. What changes is WHEN it is called. The
 * wheel called it at the moment of the win; here nothing is created until the
 * member presses «استيراد».
 *
 * ## Why one order per prize is a database fact, not a careful function
 *
 * The owner listed four ways to ask twice: a double click, a network retry,
 * two windows, a manipulated id. Code that checks a status and then writes is
 * wrong for all four, because the check and the write are not one instruction.
 *
 * So there are three locks, and they are independent:
 *
 *  1. THE CLAIM. `UPDATE … SET status='claiming' WHERE id=? AND user_id=? AND
 *     status='available'` — one guarded statement. Exactly one caller sees it
 *     change a row; everyone else sees zero and takes the read path.
 *  2. THE ORDER'S OWN ID, derived from the prize. `saveOrder` upserts on `id`,
 *     so a retry that gets past the claim overwrites its own order rather than
 *     minting a second.
 *  3. `orders.idempotency_key`, which carries a UNIQUE index in this schema.
 *     Two orders for one prize is refused by the database whatever the code
 *     above it believes.
 *
 * ## What the client is never asked
 *
 * The product. «لا يقبل productId من Client كحقيقة، يستخدم product_id المخزن
 * داخل Prize.» The browser sends a prize id and nothing else that matters; the
 * title, the picture, the price and the product all come off the stored row —
 * a snapshot taken when the spin happened, so a catalogue edited afterwards
 * cannot change what somebody won.
 */

import { d1First, d1RunChanges, getD1 } from "./d1.server";
import { readPrize, ensureRouletteSchema, type RoulettePrize } from "./roulette.server";

export type ImportResult =
  | { ok: true; orderId: string; threadId: string; prize: RoulettePrize; alreadyImported: boolean }
  | {
      ok: false;
      reason: "not_found" | "not_yours" | "already_claiming" | "expired" | "failed";
    };

/**
 * The order id and idempotency key a prize will always produce.
 *
 * Deterministic on purpose. Everything about this import can be retried, and a
 * retry that mints a new id is a retry that mints a new order — so the id is a
 * function of the prize rather than of the moment.
 */
export function orderIdForPrize(prizeId: string): string {
  return `ord_prz_${String(prizeId).replace(/^przw_?/, "")}`;
}
export function threadIdForPrize(prizeId: string): string {
  return `thr_prz_${String(prizeId).replace(/^przw_?/, "")}`;
}
export function idempotencyKeyForPrize(prizeId: string): string {
  return `roulette_prize:${prizeId}`;
}

/**
 * Import one prize, as the member who owns it.
 *
 * `userId` is the session's, never the body's. A prize id belonging to
 * somebody else returns `not_yours` and touches nothing — «استيراد جائزة
 * مستخدم آخر» is on the owner's list of things to test, and the answer is that
 * the claim's own WHERE clause names the member.
 */
export async function importPrize(input: {
  userId: string;
  prizeId: string;
  now?: string;
}): Promise<ImportResult> {
  const userId = String(input.userId ?? "");
  const prizeId = String(input.prizeId ?? "").trim();
  if (!userId || !prizeId || !getD1()) return { ok: false, reason: "not_found" };

  await ensureRouletteSchema();
  const now = input.now ?? new Date().toISOString();

  const before = await readPrize(prizeId);
  if (!before) return { ok: false, reason: "not_found" };
  /*
    Ownership answered before anything else, and with the same message a
    missing prize would get downstream — a member probing ids learns only that
    it is not theirs to take.
  */
  if (before.userId !== userId) return { ok: false, reason: "not_yours" };
  if (before.status === "expired") return { ok: false, reason: "expired" };

  /* Already imported: hand back the order that exists rather than making one. */
  if (before.status === "claimed" && before.orderId) {
    return {
      ok: true,
      orderId: before.orderId,
      threadId: before.threadId ?? threadIdForPrize(prizeId),
      prize: before,
      alreadyImported: true,
    };
  }

  /*
    THE CLAIM. One statement, and only one caller can win it. A second click
    lands here and changes nothing, which is what tells it to go and read.
  */
  const claimed = await d1RunChanges(
    `UPDATE roulette_prizes SET status = 'claiming', claimed_at = ?
      WHERE id = ? AND user_id = ? AND status = 'available'`,
    now,
    prizeId,
    userId,
  ).catch(() => 0);

  if (claimed !== 1) {
    /*
      Somebody else is mid-import, or finished while this request was reading.
      Both are answered from the row rather than guessed at: a finished import
      is a success with its order, an in-flight one is told to wait — never a
      second order.
    */
    const current = await readPrize(prizeId);
    if (current?.status === "claimed" && current.orderId) {
      return {
        ok: true,
        orderId: current.orderId,
        threadId: current.threadId ?? threadIdForPrize(prizeId),
        prize: current,
        alreadyImported: true,
      };
    }
    return { ok: false, reason: "already_claiming" };
  }

  const orderId = orderIdForPrize(prizeId);
  const threadId = threadIdForPrize(prizeId);

  try {
    const { createWheelGiftOrder } = await import("./wheel-gift-order.server");
    const created = await createWheelGiftOrder({
      userId,
      /* The stored product, never the caller's. */
      productId: before.productId,
      title: before.productTitle,
      price: before.productPrice,
      spinId: before.spinId,
      now,
      orderId,
      threadId,
      idempotencyKey: idempotencyKeyForPrize(prizeId),
    });
    if (!created) throw new Error("ROULETTE_IMPORT_NO_ORDER");

    /*
      Linked last, and named: the prize goes to `claimed` only from `claiming`,
      so a stale writer cannot move a prize that has since been settled by
      somebody else.
    */
    const linked = await d1RunChanges(
      `UPDATE roulette_prizes SET status = 'claimed', order_id = ?, thread_id = ?, claimed_at = ?
        WHERE id = ? AND status = 'claiming'`,
      created.orderId,
      created.threadId,
      now,
      prizeId,
    ).catch(() => 0);

    if (linked !== 1) {
      /*
        The row moved under us. The order is real and idempotent — same id,
        same key — so the member is not short a prize; the row is read back and
        whatever it says is the truth reported.
      */
      const current = await readPrize(prizeId);
      if (current?.orderId) {
        return {
          ok: true,
          orderId: current.orderId,
          threadId: current.threadId ?? created.threadId,
          prize: current,
          alreadyImported: true,
        };
      }
    }

    const after = (await readPrize(prizeId)) ?? {
      ...before,
      status: "claimed" as const,
      orderId: created.orderId,
      threadId: created.threadId,
      claimedAt: now,
    };
    return {
      ok: true,
      orderId: created.orderId,
      threadId: created.threadId,
      prize: after,
      alreadyImported: false,
    };
  } catch (error) {
    /*
      THE PRIZE GOES BACK.

      «أي عملية تفشل في المنتصف يجب ألا تترك… لعبة مجانية أو جائزة مكررة» — and
      the other half of that sentence is that it must not leave a member
      holding a prize they can never import. The claim is released to
      `available` only from `claiming`, so a release cannot undo somebody
      else's completed import, and the order id it would have used is
      deterministic — so if an order WAS created before the failure, the retry
      writes the same row rather than a second one.
    */
    await d1RunChanges(
      `UPDATE roulette_prizes SET status = 'available', claimed_at = NULL
        WHERE id = ? AND status = 'claiming'`,
      prizeId,
    ).catch(() => 0);
    console.error("[roulette:import_failed]", {
      prizeId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "failed" };
  }
}

/**
 * Whether an order already exists for this prize, read from the orders table.
 *
 * Used by the tests and by the admin's audit search, and deliberately asking
 * the ORDERS table rather than the prize row: the prize row is what the import
 * writes, so proving "exactly one order" by reading it would be proving the
 * code against itself.
 */
export async function countOrdersForPrize(prizeId: string): Promise<number> {
  if (!getD1()) return 0;
  const row = await d1First<{ n?: number }>(
    `SELECT count(*) AS n FROM orders WHERE idempotency_key = ?`,
    idempotencyKeyForPrize(prizeId),
  ).catch(() => undefined);
  return Number(row?.n ?? 0) || 0;
}
