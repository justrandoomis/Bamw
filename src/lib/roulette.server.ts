/**
 * The roulette spin: the server decides, and the animation only shows it.
 *
 * «السيرفر يقرر النتيجة بالكامل… Client لا يستطيع اختيار اللعبة… يجب أن تكون
 * النتيجة النهائية بصرياً مطابقة 100% لنتيجة السيرفر.»
 *
 * Built ON the wheel's ledger rather than beside it. `wheel_tickets` and
 * `wheel_ticket_ledger` already hold every member's tickets and every movement
 * of them, with a per-member idempotent grant and a guarded debit; a second
 * ticket system would mean two truths about the same balance. What changes
 * here is what a spin costs, how it is decided, and what winning produces.
 *
 * ## Four things the wheel could not do, and this must
 *
 * 1. SPEND MORE THAN ONE TICKET, ATOMICALLY. `claimTicket` hardcodes
 *    `TICKET_COST_PER_SPIN = 1`. Ten tickets taken one at a time is ten places
 *    to fail in the middle, and the owner said so: «لا تخصم 10 واحدة تلو
 *    الأخرى بطريقة يمكن أن تفشل في المنتصف». One guarded UPDATE, or nothing.
 *
 * 2. REFUSE A REPEAT. The wheel's spin request carries no body at all —
 *    `body: "{}"` — so a double click, a retry and two tabs are three spins
 *    and three charges. Here a spin is claimed by `(user_id, request_id)`
 *    under a unique index, inside the same batch that takes the tickets, so a
 *    repeat cannot take them twice.
 *
 * 3. CHOOSE A BUCKET BEFORE A GAME. See `roulette-odds.ts` — the whole reason
 *    it exists.
 *
 * 4. NOT CREATE AN ORDER. A win writes a prize entitlement and stops.
 *    «الفوز لا يجب أن ينشئ الطلب فوراً… الجائزة تبقى في الألعاب القابلة
 *    للاستيراد حتى يضغط المستخدم استيراد.»
 *
 * ## The order of operations, and why it is this order
 *
 * CLAIM AND CHARGE TOGETHER, RESULT AFTERWARDS. One D1 batch takes the tickets
 * and writes the spin row; a duplicate request breaks the unique index, the
 * batch rolls back, and the member is charged nothing. Only then is the draw
 * made and the row settled.
 *
 * That leaves exactly one window — charged, not yet settled — and it is
 * deliberate. A spin caught in it is RESUMABLE: the same request id finds its
 * own row still `claiming` and finishes the draw rather than charging again.
 * The alternative, drawing first and charging after, has a worse window: a
 * prize decided and never paid for.
 */

import { randomId } from "./crypto.server";
import { d1All, d1BatchRun, d1First, d1Run, d1RunChanges, getD1 } from "./d1.server";
import {
  LOSE,
  MAX_TICKETS_PER_SPIN,
  PRIZE_BUCKETS,
  pickBucket,
  resolveOdds,
  validTicketCount,
  type BucketKey,
  type ResolvedOdds,
} from "./roulette-odds";
import { populationOf, pickFromBucket, type PoolGame } from "./roulette-pool.server";
import { ensureWheelSchema, getTicketBalance } from "./wheel.server";

/** The prize's own life, from won to imported. */
export type PrizeStatus = "available" | "claiming" | "claimed" | "expired";

export interface RoulettePrize {
  id: string;
  userId: string;
  spinId: string;
  productId: string;
  productTitle: string;
  productImage: string | null;
  productPrice: number;
  bucket: string;
  status: PrizeStatus;
  wonAt: string;
  claimedAt: string | null;
  orderId: string | null;
  threadId: string | null;
}

export type SpinResult =
  | {
      ok: true;
      spinId: string;
      tickets: number;
      won: false;
      ticketsLeft: number;
      odds: ResolvedOdds;
      replay: boolean;
    }
  | {
      ok: true;
      spinId: string;
      tickets: number;
      won: true;
      prize: RoulettePrize;
      ticketsLeft: number;
      odds: ResolvedOdds;
      replay: boolean;
    }
  | {
      ok: false;
      reason: "bad_tickets" | "bad_request" | "no_tickets" | "empty_pool" | "failed";
      ticketsLeft: number;
    };

let schemaReady: Promise<void> | undefined;

/**
 * The roulette's own columns and its prize table.
 *
 * Created lazily, and NOT in the bootstrap's `SCHEMA`, for the reason
 * `wheel.server.ts` records at length: bumping `RUNTIME_SCHEMA_VERSION` makes
 * every isolate re-run the whole bootstrap and doing it once took the
 * storefront down. The owner named the same trap — «لا تكرر مشكلة
 * RUNTIME_SCHEMA_VERSION القديمة المذكورة في الكود».
 *
 * `wheel_spins` is extended rather than replaced. Every spin a member has ever
 * made is in it, coupons and all, and «احتفظ بها للتدقيق ما لم توجد ضرورة
 * حقيقية لحذفها». The new columns are added with `ALTER TABLE … ADD COLUMN`
 * whose failure is swallowed, which is this repository's established idiom for
 * exactly this: the second isolate to run it finds the column already there.
 */
export function ensureRouletteSchema(): Promise<void> {
  if (!getD1()) return Promise.resolve();
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensureWheelSchema();

      /*
        What a spin now costs, chose and ran on.

        Written out one statement at a time rather than looped over a list of
        column definitions, and that is not a style choice. `schema-coverage.test.ts`
        builds the database's shape by reading `CREATE TABLE` and `ALTER TABLE …
        ADD COLUMN` out of the source text, and cross-checks every INSERT and
        UPDATE in the repository against it — the guard that exists because
        several features were dead in production writing to columns no schema
        ever added. SQL assembled from a variable is invisible to it. A loop
        here would have bought four lines and switched that guard off for this
        table.
      */
      await d1Run(`ALTER TABLE wheel_spins ADD COLUMN tickets INTEGER NOT NULL DEFAULT 1`).catch(
        () => undefined,
      );
      await d1Run(`ALTER TABLE wheel_spins ADD COLUMN bucket TEXT`).catch(() => undefined);
      await d1Run(`ALTER TABLE wheel_spins ADD COLUMN odds_snapshot TEXT`).catch(() => undefined);
      await d1Run(`ALTER TABLE wheel_spins ADD COLUMN request_id TEXT`).catch(() => undefined);
      await d1Run(
        `ALTER TABLE wheel_spins ADD COLUMN status TEXT NOT NULL DEFAULT 'settled'`,
      ).catch(() => undefined);
      await d1Run(`ALTER TABLE wheel_spins ADD COLUMN settled_at TEXT`).catch(() => undefined);
      await d1Run(`ALTER TABLE wheel_spins ADD COLUMN prize_id TEXT`).catch(() => undefined);

      /*
        THE INDEX THAT MAKES A DOUBLE CLICK HARMLESS.

        Per MEMBER and request, not per request — the same lesson
        `wheel_ticket_ledger_user_ref_idx` records: a bare unique on the
        reference means one member's request id silently refuses everybody
        else's. Partial, so every spin written before this (all of which have a
        null request id) stays legal.
      */
      await d1Run(
        `CREATE UNIQUE INDEX IF NOT EXISTS wheel_spins_user_request_idx
           ON wheel_spins (user_id, request_id) WHERE request_id IS NOT NULL`,
      );

      await d1Run(`
        CREATE TABLE IF NOT EXISTS roulette_prizes (
          id            TEXT PRIMARY KEY,
          user_id       TEXT NOT NULL,
          spin_id       TEXT NOT NULL,
          product_id    TEXT NOT NULL,
          product_title TEXT NOT NULL DEFAULT '',
          product_image TEXT,
          product_price REAL NOT NULL DEFAULT 0,
          bucket        TEXT NOT NULL DEFAULT '',
          status        TEXT NOT NULL DEFAULT 'available',
          won_at        TEXT NOT NULL,
          claimed_at    TEXT,
          order_id      TEXT,
          thread_id     TEXT
        )
      `);
      /*
        One prize per spin, and one order per prize — the owner's two
        structural requirements, as constraints rather than as code that
        remembers to check. «ضع UNIQUE constraints المناسبة لمنع أكثر من Prize
        لنفس Spin، وأكثر من Order لنفس Prize.»
      */
      await d1Run(
        `CREATE UNIQUE INDEX IF NOT EXISTS roulette_prizes_spin_idx ON roulette_prizes (spin_id)`,
      );
      await d1Run(
        `CREATE UNIQUE INDEX IF NOT EXISTS roulette_prizes_order_idx
           ON roulette_prizes (order_id) WHERE order_id IS NOT NULL`,
      );
      await d1Run(
        `CREATE INDEX IF NOT EXISTS roulette_prizes_user_idx
           ON roulette_prizes (user_id, status, won_at DESC)`,
      );
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  return schemaReady;
}

/** A unit in [0,1) from the platform's CSPRNG. */
function cryptoUnit(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] / 2 ** 32;
}

const prizeFromRow = (row: Record<string, unknown>): RoulettePrize => ({
  id: String(row["id"] ?? ""),
  userId: String(row["user_id"] ?? ""),
  spinId: String(row["spin_id"] ?? ""),
  productId: String(row["product_id"] ?? ""),
  productTitle: String(row["product_title"] ?? ""),
  productImage: row["product_image"] ? String(row["product_image"]) : null,
  productPrice: Number(row["product_price"]) || 0,
  bucket: String(row["bucket"] ?? ""),
  status: (String(row["status"] ?? "available") as PrizeStatus) ?? "available",
  wonAt: String(row["won_at"] ?? ""),
  claimedAt: row["claimed_at"] ? String(row["claimed_at"]) : null,
  orderId: row["order_id"] ? String(row["order_id"]) : null,
  threadId: row["thread_id"] ? String(row["thread_id"]) : null,
});

/** Every prize a member holds, newest first. */
export async function listPrizes(userId: string, limit = 50): Promise<RoulettePrize[]> {
  if (!userId || !getD1()) return [];
  await ensureRouletteSchema();
  const rows = await d1All<Record<string, unknown>>(
    `SELECT * FROM roulette_prizes WHERE user_id = ? ORDER BY won_at DESC LIMIT ?`,
    userId,
    Math.max(1, Math.min(200, Math.floor(limit))),
  ).catch(() => []);
  return (rows ?? []).map(prizeFromRow);
}

/** One prize, by id — with the owner checked by the caller, never here. */
export async function readPrize(prizeId: string): Promise<RoulettePrize | null> {
  if (!prizeId || !getD1()) return null;
  await ensureRouletteSchema();
  const row = await d1First<Record<string, unknown>>(
    `SELECT * FROM roulette_prizes WHERE id = ?`,
    prizeId,
  ).catch(() => undefined);
  /*
    `d1First` answers with a truthy empty object when there is no binding, so
    the ROW is judged by a field it must have rather than by existing.
  */
  if (!row || !row["id"]) return null;
  return prizeFromRow(row);
}

/**
 * A spin that was already made under this request id, or null.
 *
 * Returned to a repeat caller unchanged: «Duplicate request لا ينشئ طلبين»,
 * and the same for a spin — a retried request must show the member the result
 * they already have, not a new one they did not pay for.
 */
async function readSpinByRequest(
  userId: string,
  requestId: string,
): Promise<Record<string, unknown> | null> {
  const row = await d1First<Record<string, unknown>>(
    `SELECT * FROM wheel_spins WHERE user_id = ? AND request_id = ?`,
    userId,
    requestId,
  ).catch(() => undefined);
  if (!row || !row["id"]) return null;
  return row;
}

export interface SpinInput {
  userId: string;
  /** 1–10. Anything else is refused before a ticket moves. */
  tickets: unknown;
  /** The member's own idempotency key for this press of the button. */
  requestId: string;
  /** The pool, built on the server from the catalogue. Never from a browser. */
  games: readonly PoolGame[];
  priceBoundary?: number;
  now?: string;
  /**
   * The draws, injected for tests.
   *
   * TWO of them, named, rather than one function called twice. The wheel's
   * `randomUnit` is consumed once for the lose/win decision and again for the
   * winner, so a test injecting a constant silently drives both from the same
   * number — which makes a test that looks like it pins the outcome pin
   * nothing. Two names cannot be confused for one.
   */
  drawBucket?: () => number;
  drawGame?: () => number;
}

/**
 * Spend tickets, decide the outcome, and record everything about it.
 */
export async function spinRoulette(input: SpinInput): Promise<SpinResult> {
  const userId = String(input.userId ?? "");
  const requestId = String(input.requestId ?? "").trim();
  const tickets = validTicketCount(input.tickets);

  if (!userId) return { ok: false, reason: "bad_request", ticketsLeft: 0 };
  if (tickets === null) {
    return { ok: false, reason: "bad_tickets", ticketsLeft: await getTicketBalance(userId) };
  }
  if (!requestId || requestId.length > 100) {
    return { ok: false, reason: "bad_request", ticketsLeft: await getTicketBalance(userId) };
  }

  await ensureRouletteSchema();
  const now = input.now ?? new Date().toISOString();

  /* A repeat of a spin that already settled: hand back what it decided. */
  const existing = await readSpinByRequest(userId, requestId);
  if (existing && String(existing["status"] ?? "settled") === "settled") {
    return describeSettled(existing, userId, true);
  }

  const population = populationOf(input.games);
  const empty = PRIZE_BUCKETS.every((key) => (population[key] ?? 0) === 0);
  if (empty) {
    /*
      Nothing can be won. Refused BEFORE the tickets move, because charging ten
      tickets for a certainty is the one outcome no amount of correct
      bookkeeping afterwards would excuse.
    */
    return { ok: false, reason: "empty_pool", ticketsLeft: await getTicketBalance(userId) };
  }

  const odds = resolveOdds(tickets, population, input.priceBoundary);

  /*
    THE CLAIM FIRST, THEN THE CHARGE, AND THE LEDGER AS THE PROOF.

    Statement order carries the meaning, and this order was chosen by a test
    rather than by taste. The first version charged first and claimed second,
    relying on the batch rolling back when the unique index refused a duplicate.
    Two requests fired at the same instant then took four tickets EACH while
    producing one spin — so the design rested on a rollback that the harness,
    and therefore possibly some transport, did not perform.

    Correctness must not rest on it. So:

      1. write the spin row. A member who has already spun under this request id
         breaks `wheel_spins_user_request_idx` here, and nothing after it runs —
         no rollback required, because the charge has not happened yet;
      2. take the tickets, guarded on there being enough;
      3. the ledger line, chained on `changes()`, so it can never record a
         charge that did not happen — which makes it the EVIDENCE that one did.

    That evidence is what closes the new window. A claim can now exist with no
    charge behind it (statement 2 refusing for want of tickets), and a spin
    nobody paid for must never be drawn. So the ledger is asked, not assumed.
  */
  const spinId = randomId("spin");
  const chargeReference = `spin:${spinId}`;
  let batchFailed = false;
  try {
    await d1BatchRun([
      {
        sql: `INSERT INTO wheel_spins
                (id, user_id, product_id, product_title, product_price, weight_label,
                 coupon_code, expires_at, created_at, tickets, bucket, odds_snapshot,
                 request_id, status)
              VALUES (?, ?, '', '', 0, '', NULL, NULL, ?, ?, NULL, ?, ?, 'claiming')`,
        binds: [spinId, userId, now, tickets, JSON.stringify(odds), requestId],
      },
      {
        sql: `UPDATE wheel_tickets SET balance = balance - ?, updated_at = ?
               WHERE user_id = ? AND balance >= ?`,
        binds: [tickets, now, userId, tickets],
      },
      {
        sql: `INSERT INTO wheel_ticket_ledger (id, user_id, delta, reason, reference_id, created_at)
              SELECT ?, ?, ?, 'roulette_spin', ?, ? WHERE changes() = 1`,
        binds: [randomId("wtl"), userId, -tickets, chargeReference, now],
      },
    ]);
  } catch {
    /*
      The unique index refused the claim: this member has pressed the button
      twice under one request id. No ticket moved, because the charge is
      downstream of the statement that failed.
    */
    batchFailed = true;
  }

  const claimed = await readSpinByRequest(userId, requestId);
  if (!claimed) {
    return {
      ok: false,
      reason: batchFailed ? "failed" : "no_tickets",
      ticketsLeft: await getTicketBalance(userId).catch(() => 0),
    };
  }
  if (String(claimed["status"] ?? "") === "settled") {
    /* Another request won the race and finished it. Show the member that one. */
    return describeSettled(claimed, userId, true);
  }

  /*
    WAS IT PAID FOR?

    The ledger row is written only when the debit changed a row, so its
    presence is the one fact that distinguishes "claimed and charged" from
    "claimed and refused for want of tickets". A claim with no charge behind it
    is deleted — it is this request's own row, still `claiming`, and nobody
    else can be looking at it — and the member is told they have not got the
    tickets rather than being handed a free draw.
  */
  const claimedId = String(claimed["id"] ?? spinId);
  const paid = await d1First<{ n?: number }>(
    `SELECT count(*) AS n FROM wheel_ticket_ledger
      WHERE user_id = ? AND reference_id = ? AND delta < 0`,
    userId,
    `spin:${claimedId}`,
  ).catch(() => undefined);
  if (Number(paid?.n ?? 0) === 0) {
    await d1RunChanges(
      `DELETE FROM wheel_spins WHERE id = ? AND status = 'claiming'`,
      claimedId,
    ).catch(() => 0);
    return { ok: false, reason: "no_tickets", ticketsLeft: await getTicketBalance(userId).catch(() => 0) };
  }

  /*
    Charged, claimed, not yet decided — the one window this design leaves open,
    and the point at which a resumed spin re-enters. The row's own id is used
    from here, not the one minted above, because a resumed spin is finishing
    somebody else's claim.
  */
  const liveSpinId = String(claimed["id"] ?? spinId);
  const liveTickets = Number(claimed["tickets"]) || tickets;
  const liveOdds = parseSnapshot(claimed["odds_snapshot"]) ?? odds;

  const bucket = pickBucket(liveOdds.probabilities, input.drawBucket ?? cryptoUnit);
  if (bucket === LOSE) {
    await settleLoss(liveSpinId, now);
    return {
      ok: true,
      spinId: liveSpinId,
      tickets: liveTickets,
      won: false,
      ticketsLeft: await getTicketBalance(userId).catch(() => 0),
      odds: liveOdds,
      replay: false,
    };
  }

  const winner = pickFromBucket(input.games, bucket, input.drawGame ?? cryptoUnit);
  if (!winner) {
    /*
      The bucket won and has nothing in it. `resolveOdds` sets an empty
      bucket's probability to zero so this is unreachable for a snapshot built
      from the same pool — but a resumed spin carries a snapshot from BEFORE
      the catalogue changed, and a game can be hidden between the two. Settled
      as a loss rather than paid out of a bucket nobody was offered, and the
      tickets are NOT refunded because the spin genuinely happened.
    */
    console.warn("[roulette:bucket_emptied_between_claim_and_draw]", {
      spinId: liveSpinId,
      bucket,
    });
    await settleLoss(liveSpinId, now, bucket);
    return {
      ok: true,
      spinId: liveSpinId,
      tickets: liveTickets,
      won: false,
      ticketsLeft: await getTicketBalance(userId).catch(() => 0),
      odds: liveOdds,
      replay: false,
    };
  }

  /*
    THE WIN, AND WHAT IT DOES NOT DO.

    It writes an entitlement. No order, no coupon, no delivery slot, nothing
    the shop has to honour until the member asks for it — «الفوز ينشئ Prize
    entitlement مملوكاً للمستخدم».

    Both statements in one batch, the prize chained on the settle, so a spin
    can never be marked settled without its prize nor carry two. The settle
    names the status it expects to find, so two requests racing to finish the
    same claim produce one winner and one no-op.
  */
  const prizeId = randomId("przw");
  await d1BatchRun([
    {
      sql: `UPDATE wheel_spins
               SET status = 'settled', settled_at = ?, bucket = ?, product_id = ?,
                   product_title = ?, product_price = ?, weight_label = ?, prize_id = ?
             WHERE id = ? AND status = 'claiming'`,
      binds: [
        now,
        bucket,
        winner.id,
        winner.title,
        winner.price,
        bucket,
        prizeId,
        liveSpinId,
      ],
    },
    {
      sql: `INSERT INTO roulette_prizes
              (id, user_id, spin_id, product_id, product_title, product_image,
               product_price, bucket, status, won_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'available', ? WHERE changes() = 1`,
      binds: [
        prizeId,
        userId,
        liveSpinId,
        winner.id,
        winner.title,
        winner.squareImage,
        winner.price,
        bucket,
        now,
      ],
    },
  ]);

  const prize = await readPrizeBySpin(liveSpinId);
  if (!prize) {
    /*
      The settle lost its race and another request recorded the outcome. Read
      whatever it decided rather than reporting this one's draw, so the member
      is never shown two different results for one spin.
    */
    const settled = await readSpinByRequest(userId, requestId);
    if (settled) return describeSettled(settled, userId, true);
    return { ok: false, reason: "failed", ticketsLeft: await getTicketBalance(userId).catch(() => 0) };
  }

  return {
    ok: true,
    spinId: liveSpinId,
    tickets: liveTickets,
    won: true,
    prize,
    ticketsLeft: await getTicketBalance(userId).catch(() => 0),
    odds: liveOdds,
    replay: false,
  };
}

async function settleLoss(spinId: string, now: string, bucket = LOSE as string): Promise<void> {
  await d1RunChanges(
    `UPDATE wheel_spins SET status = 'settled', settled_at = ?, bucket = ?, weight_label = ?
      WHERE id = ? AND status = 'claiming'`,
    now,
    bucket,
    "حظ أوفر",
    spinId,
  ).catch(() => 0);
}

async function readPrizeBySpin(spinId: string): Promise<RoulettePrize | null> {
  const row = await d1First<Record<string, unknown>>(
    `SELECT * FROM roulette_prizes WHERE spin_id = ?`,
    spinId,
  ).catch(() => undefined);
  if (!row || !row["id"]) return null;
  return prizeFromRow(row);
}

function parseSnapshot(raw: unknown): ResolvedOdds | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as ResolvedOdds;
    if (!parsed || typeof parsed !== "object" || !parsed.probabilities) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** A settled spin, described to its owner exactly as it was recorded. */
async function describeSettled(
  row: Record<string, unknown>,
  userId: string,
  replay: boolean,
): Promise<SpinResult> {
  const spinId = String(row["id"] ?? "");
  const tickets = Number(row["tickets"]) || 1;
  const odds = parseSnapshot(row["odds_snapshot"]) ?? {
    probabilities: {} as Record<BucketKey, number>,
    emptied: [],
    tickets,
    priceBoundary: 0,
  };
  const ticketsLeft = await getTicketBalance(userId).catch(() => 0);
  const prize = await readPrizeBySpin(spinId);
  if (!prize) {
    return { ok: true, spinId, tickets, won: false, ticketsLeft, odds, replay };
  }
  return { ok: true, spinId, tickets, won: true, prize, ticketsLeft, odds, replay };
}

/** What the ticket selector offers: one to ten, never more. */
export const TICKET_CHOICES: readonly number[] = Array.from(
  { length: MAX_TICKETS_PER_SPIN },
  (_, i) => i + 1,
);
