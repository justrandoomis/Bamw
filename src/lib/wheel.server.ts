/**
 * عجلة الحظ — a ticket buys one spin, and a spin wins a game.
 *
 * ## The rules the owner set
 *
 * Tickets are bought with bananas and nothing else, through the redemption
 * screen, or granted by an admin. One ticket is one spin. The prize is a game
 * from the shop, and the odds are deliberately uneven: «حصة الألعاب الضعيفة
 * أكبر ... والألعاب الغالية تكون فرصتها صعبة نوعا ما» — the cheap games come up
 * often, the expensive ones almost never.
 *
 * ## Where the odds come from
 *
 * Price, and only price. The obvious second signal would be popularity, and
 * the owner named it — but `product_index.sales` is 0 for every one of the
 * 1,714 products in production, so a popularity term would be arithmetic over
 * a column that has never been written. Weighting by a number that does not
 * exist is not weighting; price is what the catalogue actually knows, and it
 * happens to line up with what was asked for. 984 of the visible games are at
 * or below 5,000 IQD, which is exactly the «الألعاب الرخيصة ذات الخمسة آلاف
 * دينار» bucket.
 *
 * ## Where the winner is decided
 *
 * Here, on the server, from a candidate list the server built. The client is
 * told the answer and animates the wheel to it. A wheel that picked its own
 * winner would be a free-games button for anyone who opens dev tools, and no
 * amount of animation would change that.
 *
 * ## What a spin costs if something breaks
 *
 * Nothing. The ticket is claimed with a guarded UPDATE, and every failure
 * after that point gives it back. The same is true of buying one: the bananas
 * are refunded if the tickets cannot be credited. This module was written
 * against a redemption path that did the opposite — it debited and then threw
 * on a NOT NULL column, losing the member's bananas with no record — so the
 * order of operations here is deliberate rather than incidental.
 */

import { d1All, d1First, d1Run, d1RunChanges, getD1 } from "./d1.server";
import { randomId } from "./crypto.server";

/** One spin, one ticket. */
export const TICKET_COST_PER_SPIN = 1;

/** How long a won game stays claimable. */
export const PRIZE_VALID_DAYS = 14;

/**
 * The odds, as a table rather than a formula.
 *
 * A formula (1/price, say) hides its own behaviour: nobody reading it can say
 * what the chance of a 40,000 dinar game is without doing the arithmetic over
 * the whole catalogue. These are five numbers, and the ratio between any two
 * of them is the answer to "how much rarer is that one".
 *
 * Against the live catalogue (984 games at or below 5,000; 540 to 10,000; 184
 * to 20,000; 2 to 40,000; 1 above) this comes out at roughly 85% of spins
 * landing in the cheapest tier and about one spin in a hundred thousand
 * landing on the most expensive game in the shop.
 */
export const PRIZE_WEIGHTS: ReadonlyArray<{ upTo: number; weight: number; label: string }> = [
  { upTo: 5_000, weight: 100, label: "≤ 5,000" },
  { upTo: 10_000, weight: 30, label: "5,001 – 10,000" },
  { upTo: 20_000, weight: 8, label: "10,001 – 20,000" },
  { upTo: 40_000, weight: 2, label: "20,001 – 40,000" },
  { upTo: Number.POSITIVE_INFINITY, weight: 1, label: "> 40,000" },
];

export function weightForPrice(price: number): { weight: number; label: string } {
  const value = Number.isFinite(price) ? price : Number.POSITIVE_INFINITY;
  for (const tier of PRIZE_WEIGHTS) {
    if (value <= tier.upTo) return { weight: tier.weight, label: tier.label };
  }
  const last = PRIZE_WEIGHTS[PRIZE_WEIGHTS.length - 1]!;
  return { weight: last.weight, label: last.label };
}

let schemaReady: Promise<void> | undefined;

/**
 * The wheel's own tables, created on first use.
 *
 * Deliberately not added to the bootstrap's `SCHEMA` behind
 * `RUNTIME_SCHEMA_VERSION`: bumping that number makes every isolate re-run the
 * whole bootstrap, and doing so once took the storefront down. Creating three
 * tables here costs one round trip on the first wheel request of an isolate's
 * life and cannot affect a request that never touches the wheel.
 */
export function ensureWheelSchema(): Promise<void> {
  if (!getD1()) return Promise.resolve();
  if (!schemaReady) {
    schemaReady = (async () => {
      await d1Run(`
        CREATE TABLE IF NOT EXISTS wheel_tickets (
          user_id    TEXT PRIMARY KEY,
          balance    INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        )
      `);
      /*
        Every movement, so a member asking "where did my ticket go" has an
        answer and an admin granting one leaves a trace. `reference_id` is what
        makes a grant idempotent: a purchase that is retried carries the same
        reference and inserts nothing the second time.
      */
      await d1Run(`
        CREATE TABLE IF NOT EXISTS wheel_ticket_ledger (
          id           TEXT PRIMARY KEY,
          user_id      TEXT NOT NULL,
          delta        INTEGER NOT NULL,
          reason       TEXT NOT NULL,
          reference_id TEXT,
          created_at   TEXT NOT NULL
        )
      `);
      /*
        Unique per MEMBER and reference, not per reference.

        The first version was `UNIQUE (reference_id)` across the whole table,
        which reads as "this grant happens once" and means "this grant happens
        once in the shop". One campaign reference handed to fifty members
        would grant the first and silently refuse the other forty-nine, each
        of them reported back as "already granted".

        The old index is dropped rather than left beside the new one: it is
        the constraint, so leaving it in place would leave the bug in place.
      */
      await d1Run(`DROP INDEX IF EXISTS wheel_ticket_ledger_ref_idx`).catch(() => undefined);
      await d1Run(
        `CREATE UNIQUE INDEX IF NOT EXISTS wheel_ticket_ledger_user_ref_idx
           ON wheel_ticket_ledger (user_id, reference_id) WHERE reference_id IS NOT NULL`,
      );
      await d1Run(
        `CREATE INDEX IF NOT EXISTS wheel_ticket_ledger_user_idx
           ON wheel_ticket_ledger (user_id, created_at DESC)`,
      );
      await d1Run(`
        CREATE TABLE IF NOT EXISTS wheel_spins (
          id            TEXT PRIMARY KEY,
          user_id       TEXT NOT NULL,
          product_id    TEXT NOT NULL,
          product_title TEXT NOT NULL DEFAULT '',
          product_price REAL,
          weight_label  TEXT NOT NULL DEFAULT '',
          coupon_code   TEXT,
          expires_at    TEXT,
          created_at    TEXT NOT NULL
        )
      `);
      await d1Run(
        `CREATE INDEX IF NOT EXISTS wheel_spins_user_idx
           ON wheel_spins (user_id, created_at DESC)`,
      );
      /*
        Which redemption offers are tickets, and how many each one gives.

        Its own table rather than two columns on `banana_redemption_offers`,
        because that table is created behind `RUNTIME_SCHEMA_VERSION` and the
        bootstrap short-circuits once a database is stamped — so an ALTER
        added there is invisible to production until that number moves, and
        moving it makes every isolate re-run the whole bootstrap, which is
        what took the storefront down at version 24. A separate table needs no
        such permission.
      */
      await d1Run(`
        CREATE TABLE IF NOT EXISTS wheel_ticket_offers (
          offer_id        TEXT PRIMARY KEY,
          ticket_quantity INTEGER NOT NULL DEFAULT 1,
          created_at      TEXT NOT NULL
        )
      `);
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  return schemaReady;
}

export async function getTicketBalance(userId: string): Promise<number> {
  if (!userId || !getD1()) return 0;
  await ensureWheelSchema();
  const row = await d1First<{ balance?: number }>(
    `SELECT balance FROM wheel_tickets WHERE user_id = ?`,
    userId,
  );
  // `d1First` answers with a truthy empty object when there is no binding, so
  // read the field rather than the row.
  return Math.max(0, Number(row?.balance ?? 0) || 0);
}

/**
 * Add tickets, once per reference.
 *
 * `referenceId` is the whole guarantee. A purchase that is retried, an admin
 * who double-clicks, a queue that delivers twice — all of them carry the same
 * reference, and the unique index on it means the second attempt inserts
 * nothing and adds nothing.
 */
export async function grantTickets(input: {
  userId: string;
  quantity: number;
  reason: string;
  referenceId?: string;
  now?: string;
}): Promise<{ granted: boolean; balance: number }> {
  const userId = String(input.userId ?? "");
  const quantity = Math.floor(Number(input.quantity));
  if (!userId || !Number.isFinite(quantity) || quantity <= 0) {
    return { granted: false, balance: await getTicketBalance(userId) };
  }
  await ensureWheelSchema();
  const now = input.now ?? new Date().toISOString();

  if (input.referenceId) {
    const claimed = await d1RunChanges(
      `INSERT OR IGNORE INTO wheel_ticket_ledger (id, user_id, delta, reason, reference_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      randomId("wtl"),
      userId,
      quantity,
      input.reason,
      input.referenceId,
      now,
    );
    // Already granted under this reference. Say so rather than granting again.
    if (claimed !== 1) return { granted: false, balance: await getTicketBalance(userId) };
  } else {
    await d1Run(
      `INSERT INTO wheel_ticket_ledger (id, user_id, delta, reason, reference_id, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
      randomId("wtl"),
      userId,
      quantity,
      input.reason,
      now,
    );
  }

  try {
    await d1Run(
      `INSERT INTO wheel_tickets (user_id, balance, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         balance = wheel_tickets.balance + excluded.balance,
         updated_at = excluded.updated_at`,
      userId,
      quantity,
      now,
    );
  } catch (error) {
    /*
      The claim above is what makes a repeat harmless, and it is written
      before the balance because it has to be — checking first and writing
      after is not atomic across two statements. The cost is this window: a
      reference claimed and no tickets credited, which would make every retry
      of that same grant a no-op forever.

      Giving the claim back unconditionally is not the answer, and it was the
      first one here. "The statement threw" does not mean "the statement did
      not run": on the REST transport the error can come out of reading the
      response, after Cloudflare has already executed the write. Release the
      claim then, and the admin's retry adds the tickets a second time —
      which on this path is free games.

      So the credit is checked rather than assumed. The ledger is the record
      of what was promised and `wheel_tickets.balance` is the running total;
      if they agree, the credit landed and the claim must stand. They can
      only be compared if both can be read, and when they cannot the claim
      stays — an ambiguous grant is left for a human to settle rather than
      resolved in the direction that pays out twice.
    */
    if (input.referenceId) {
      const landed = await creditLanded(userId).catch(() => null);
      if (landed === false) {
        await d1Run(
          `DELETE FROM wheel_ticket_ledger WHERE reference_id = ? AND user_id = ?`,
          input.referenceId,
          userId,
        ).catch(() => undefined);
      } else {
        console.warn("[wheel:grant_ambiguous]", {
          userId,
          referenceId: input.referenceId,
          landed,
        });
      }
    }
    throw error;
  }

  /*
    Same rule as the spin. The tickets are in the member's balance by now, and
    the caller treats a thrown error as "not granted" and refunds the bananas
    — so letting this last SELECT throw would hand the member both the
    tickets and their money back.
  */
  return { granted: true, balance: await getTicketBalance(userId).catch(() => 0) };
}

/**
 * Did the balance credit land?
 *
 * `true` when `wheel_tickets.balance` already equals the ledger's running
 * total, `false` when it is short by exactly what the ledger says is owed,
 * and `null` when the question could not be asked. Only a definite `false`
 * is safe to roll a claim back on.
 */
async function creditLanded(userId: string): Promise<boolean | null> {
  const owed = await d1First<{ total?: number }>(
    `SELECT COALESCE(SUM(delta), 0) AS total FROM wheel_ticket_ledger WHERE user_id = ?`,
    userId,
  );
  const held = await d1First<{ balance?: number }>(
    `SELECT balance FROM wheel_tickets WHERE user_id = ?`,
    userId,
  );
  /*
    `d1First` answers with a truthy empty object when there is no binding, so
    both are read as fields. A missing `wheel_tickets` row is a real zero — a
    member who has never held a ticket — while a missing `total` means the
    sum could not be computed and the comparison is worthless.
  */
  if (owed?.total === undefined || owed?.total === null) return null;
  const balance = Number(held?.balance ?? 0) || 0;
  return balance === Number(owed.total);
}

/**
 * Take one ticket, or refuse.
 *
 * One guarded statement, so two spins fired at the same instant cannot both
 * win on one ticket. Everything the spin does afterwards is written so that a
 * failure returns the ticket.
 */
async function claimTicket(userId: string, now: string): Promise<boolean> {
  const claimed = await d1RunChanges(
    `UPDATE wheel_tickets SET balance = balance - ?, updated_at = ?
     WHERE user_id = ? AND balance >= ?`,
    TICKET_COST_PER_SPIN,
    now,
    userId,
    TICKET_COST_PER_SPIN,
  );
  if (claimed !== 1) return false;
  await d1Run(
    `INSERT INTO wheel_ticket_ledger (id, user_id, delta, reason, reference_id, created_at)
     VALUES (?, ?, ?, 'spin', NULL, ?)`,
    randomId("wtl"),
    userId,
    -TICKET_COST_PER_SPIN,
    now,
  ).catch(() => undefined);
  return true;
}

/**
 * Give a claimed ticket back, when the spin could not finish.
 *
 * Reports whether it worked, because the member is told about it. The screen
 * said «أُعيدت تذكرتك» whatever happened here, which is the one sentence that
 * must not be guessed: a member who is told their ticket came back and finds
 * it did not has been lied to about something they paid for.
 */
async function returnTicket(userId: string, now: string): Promise<boolean> {
  const returned = await d1RunChanges(
    `UPDATE wheel_tickets SET balance = balance + ?, updated_at = ? WHERE user_id = ?`,
    TICKET_COST_PER_SPIN,
    now,
    userId,
  ).catch(() => 0);
  await d1Run(
    `INSERT INTO wheel_ticket_ledger (id, user_id, delta, reason, reference_id, created_at)
     VALUES (?, ?, ?, 'spin_refund', NULL, ?)`,
    randomId("wtl"),
    userId,
    TICKET_COST_PER_SPIN,
    now,
  ).catch(() => undefined);
  return returned === 1;
}

export interface WheelCandidate {
  id: string;
  title: string;
  price: number;
  image?: string | null;
}

/**
 * Pick a winner, weighted, from a CSPRNG.
 *
 * `Math.random` would be statistically fine and is still the wrong tool: this
 * decides who gets a game worth money, and a predictable sequence is a way to
 * farm the wheel. `crypto.getRandomValues` is available in Workers and costs
 * nothing here.
 */
export function pickWeighted(
  candidates: readonly WheelCandidate[],
  randomUnit?: () => number,
): { candidate: WheelCandidate; weightLabel: string } | null {
  if (candidates.length === 0) return null;

  const weights = candidates.map((candidate) => weightForPrice(Number(candidate.price)));
  const total = weights.reduce((sum, tier) => sum + tier.weight, 0);
  if (total <= 0) return null;

  const unit = randomUnit ? randomUnit() : cryptoUnit();
  let cursor = Math.min(Math.max(unit, 0), 0.999999999) * total;
  for (let index = 0; index < candidates.length; index += 1) {
    cursor -= weights[index]!.weight;
    if (cursor < 0) {
      return { candidate: candidates[index]!, weightLabel: weights[index]!.label };
    }
  }
  const last = candidates.length - 1;
  return { candidate: candidates[last]!, weightLabel: weights[last]!.label };
}

function cryptoUnit(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0] ?? 0) / 2 ** 32;
}

export type SpinOutcome =
  | {
      ok: true;
      spinId: string;
      prize: { productId: string; title: string; price: number; image: string | null };
      couponCode: string;
      expiresAt: string;
      ticketsLeft: number;
    }
  | {
      ok: false;
      reason: "no_ticket" | "no_candidates" | "failed";
      ticketsLeft: number;
      /** Only on "failed": whether the ticket really did come back. */
      ticketReturned?: boolean;
    };

/**
 * Spend a ticket and win a game.
 *
 * The candidate list is the caller's, and the caller is the server — the route
 * builds it from the store it already holds. Nothing a browser sends reaches
 * this function.
 */
export async function spinWheel(input: {
  userId: string;
  candidates: readonly WheelCandidate[];
  now?: string;
}): Promise<SpinOutcome> {
  const userId = String(input.userId ?? "");
  if (!userId) return { ok: false, reason: "failed", ticketsLeft: 0 };

  await ensureWheelSchema();
  const now = input.now ?? new Date().toISOString();

  if (input.candidates.length === 0) {
    return { ok: false, reason: "no_candidates", ticketsLeft: await getTicketBalance(userId) };
  }

  if (!(await claimTicket(userId, now))) {
    return { ok: false, reason: "no_ticket", ticketsLeft: await getTicketBalance(userId) };
  }

  /*
    The code minted for this spin, remembered so the failure path can take it
    back. Between the mint and the `wheel_spins` row there is a window where a
    member holds a live 100%-off coupon for a spin that never happened — and
    the catch below hands their ticket back too, so the cost of losing that
    window is a free game AND another turn.
  */
  let mintedCode = "";

  try {
    const winner = pickWeighted(input.candidates);
    if (!winner) throw new Error("WHEEL_NO_WINNER");

    const expiresAt = new Date(
      Date.parse(now) + PRIZE_VALID_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { issuePrizeCoupon } = await import("./wheel-prize.server");
    const couponCode = await issuePrizeCoupon({
      userId,
      productId: winner.candidate.id,
      // The price the wheel itself offered — the server's catalogue read, not
      // anything the browser sent.
      price: Number(winner.candidate.price) || 0,
      issuedAt: now,
      expiresAt,
    });
    mintedCode = couponCode;

    const spinId = randomId("spin");
    await d1Run(
      `INSERT INTO wheel_spins
         (id, user_id, product_id, product_title, product_price, weight_label, coupon_code, expires_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      spinId,
      userId,
      winner.candidate.id,
      winner.candidate.title,
      Number(winner.candidate.price) || 0,
      winner.weightLabel,
      couponCode,
      expiresAt,
      now,
    );

    /*
      Past this point the spin has happened: the coupon is minted and the
      `wheel_spins` row is committed. The closing balance is a number for the
      screen, and it used to be read inside the try as the last expression of
      the return — so a transient failure on that one SELECT fell into the
      catch below, which revokes the prize and hands the ticket back for a
      spin that fully succeeded. The member would be left with a spin row
      pointing at a coupon that no longer exists.

      So it is read where it cannot do that, and a failure to read it costs
      the screen a number rather than costing the member their prize.
    */
    const ticketsLeft = await getTicketBalance(userId).catch(() => 0);
    return {
      ok: true,
      spinId,
      prize: {
        productId: winner.candidate.id,
        title: winner.candidate.title,
        price: Number(winner.candidate.price) || 0,
        image: winner.candidate.image ?? null,
      },
      couponCode,
      expiresAt,
      ticketsLeft,
    };
  } catch (error) {
    /*
      The prize goes back first, then the ticket.

      `revokePrizeCoupon` was written for this and had no caller, which is the
      quietest kind of missing line: every test passed, the happy path was
      right, and the only way to see it was to ask what a member is left
      holding when the spin row fails to write. The answer was a working
      coupon for a free game, plus the ticket, plus no record that either
      happened.

      Order matters. Revoking first means that if the process dies between the
      two, the member has lost a ticket — recoverable, and visible in the
      ledger. The other order leaves the shop giving away a game.
    */
    if (mintedCode) {
      const { revokePrizeCoupon } = await import("./wheel-prize.server");
      await revokePrizeCoupon(mintedCode).catch(() => undefined);
    }
    /*
      The ticket goes back. A member who span and got an error has not had
      their turn, and the alternative — keeping the ticket because the code
      threw — is the shop charging for nothing.
    */
    const ticketReturned = await returnTicket(userId, now);
    console.warn("[wheel:spin_failed]", {
      userId,
      ticketReturned,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      reason: "failed",
      ticketsLeft: await getTicketBalance(userId).catch(() => 0),
      ticketReturned,
    };
  }
}

/** The member's own recent wins, for the wheel screen. */
export async function recentSpins(userId: string, limit = 10) {
  if (!userId || !getD1()) return [];
  await ensureWheelSchema();
  return d1All<{
    id: string;
    product_id: string;
    product_title: string;
    product_price: number | null;
    coupon_code: string | null;
    expires_at: string | null;
    created_at: string;
  }>(
    `SELECT id, product_id, product_title, product_price, coupon_code, expires_at, created_at
     FROM wheel_spins WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    userId,
    Math.max(1, Math.min(50, limit)),
  );
}

/** How many tickets this redemption offer gives, or 0 if it is not a ticket. */
export async function ticketQuantityForOffer(offerId: string): Promise<number> {
  if (!offerId || !getD1()) return 0;
  await ensureWheelSchema();
  const row = await d1First<{ ticket_quantity?: number }>(
    `SELECT ticket_quantity FROM wheel_ticket_offers WHERE offer_id = ?`,
    offerId,
  );
  return Math.max(0, Math.floor(Number(row?.ticket_quantity ?? 0)) || 0);
}

/** Mark a redemption offer as selling wheel tickets, or stop it doing so. */
export async function setTicketOffer(offerId: string, ticketQuantity: number): Promise<void> {
  if (!offerId) return;
  await ensureWheelSchema();
  const quantity = Math.floor(Number(ticketQuantity));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    await d1Run(`DELETE FROM wheel_ticket_offers WHERE offer_id = ?`, offerId);
    return;
  }
  await d1Run(
    `INSERT INTO wheel_ticket_offers (offer_id, ticket_quantity, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(offer_id) DO UPDATE SET ticket_quantity = excluded.ticket_quantity`,
    offerId,
    quantity,
    new Date().toISOString(),
  );
}

/** Every offer that sells tickets, so the redeem screen can label them. */
export async function ticketOfferIds(): Promise<Record<string, number>> {
  if (!getD1()) return {};
  await ensureWheelSchema();
  const rows = await d1All<{ offer_id: string; ticket_quantity: number }>(
    `SELECT offer_id, ticket_quantity FROM wheel_ticket_offers`,
  );
  const map: Record<string, number> = {};
  for (const row of rows) map[row.offer_id] = Number(row.ticket_quantity) || 1;
  return map;
}
