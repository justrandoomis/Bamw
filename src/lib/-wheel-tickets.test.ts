/**
 * @vitest-environment node
 */
/**
 * A ticket is money. These run against a real SQLite database rather than the
 * shape of the code, because the properties that matter here are about what
 * survives a concurrent request and a crash — neither of which a source-text
 * assertion can see.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";
import { DEFAULT_WHEEL_ODDS } from "./wheel-odds";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__WHEEL_TEST_D1__"] = db;

vi.mock("./env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__WHEEL_TEST_D1__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

/*
  The gift order, under this test's control.

  A win now creates a real order and revokes the coupon that would have been a
  second free copy — see `wheel-gift-order.server.ts`. The coupon path did not
  go away: it is what a member is left holding when the order cannot be
  written, and it is still the shop's rollback for the window between minting a
  prize and committing the spin row. Both need testing, and which one happens
  is decided by whether the order succeeds — so that is the thing this file
  gets to set.

  Default OFF, so the coupon assertions below read as what they are: the
  fallback, exercised deliberately, not a happy path that happens to still work.
*/
let giftOrderResult: { orderId: string; code: string; threadId: string } | null = null;
let giftOrderCalls = 0;
vi.mock("./wheel-gift-order.server", () => ({
  WHEEL_GIFT_SOURCE: "wheel_prize",
  createWheelGiftOrder: async () => {
    giftOrderCalls += 1;
    return giftOrderResult;
  },
}));

let wheel: typeof import("./wheel.server");

const NOW = "2026-09-21T12:00:00.000Z";
const GAMES = [
  { id: "cheap", title: "Cheap Game", price: 5_000 },
  { id: "dear", title: "Dear Game", price: 60_000 },
];

beforeAll(async () => {
  const { ensureSchema } = await import("./d1.server");
  await ensureSchema();
  wheel = await import("./wheel.server");
  await wheel.ensureWheelSchema();
});

beforeEach(() => {
  giftOrderResult = null;
  giftOrderCalls = 0;
  for (const table of ["wheel_tickets", "wheel_ticket_ledger", "wheel_spins", "coupons"]) {
    db.raw.exec(`DELETE FROM ${table}`);
  }
  db.reset();
});

/*
  These tests are about the ticket lifecycle, not the odds. The wheel now has a
  losing outcome, so a spin that expects a prize without saying so is a coin
  flip — the odds are passed in explicitly to keep every assertion here about
  the thing it is actually testing.
*/
const ALWAYS_WINS = { ...DEFAULT_WHEEL_ODDS, losingPercent: 0 };

describe("tickets", () => {
  it("starts everyone at zero", async () => {
    expect(await wheel.getTicketBalance("usr_a")).toBe(0);
  });

  it("grants and adds up", async () => {
    await wheel.grantTickets({ userId: "usr_a", quantity: 2, reason: "test", now: NOW });
    await wheel.grantTickets({ userId: "usr_a", quantity: 3, reason: "test", now: NOW });
    expect(await wheel.getTicketBalance("usr_a")).toBe(5);
  });

  it("grants once per reference, however many times it is asked", async () => {
    /*
      An admin double-click, a retried purchase, a queue that delivers twice.
      All of them carry the same reference and only one of them may count.
    */
    const once = await wheel.grantTickets({
      userId: "usr_a",
      quantity: 4,
      reason: "redemption",
      referenceId: "brd_1",
      now: NOW,
    });
    const twice = await wheel.grantTickets({
      userId: "usr_a",
      quantity: 4,
      reason: "redemption",
      referenceId: "brd_1",
      now: NOW,
    });

    expect(once.granted).toBe(true);
    expect(twice.granted).toBe(false);
    expect(await wheel.getTicketBalance("usr_a")).toBe(4);
  });

  it("refuses nonsense quantities instead of writing them", async () => {
    for (const quantity of [0, -3, Number.NaN]) {
      await wheel.grantTickets({ userId: "usr_a", quantity, reason: "test", now: NOW });
    }
    expect(await wheel.getTicketBalance("usr_a")).toBe(0);
  });

  it("records every movement, so a missing ticket has an explanation", async () => {
    await wheel.grantTickets({ userId: "usr_a", quantity: 1, reason: "admin_grant", now: NOW });
    await wheel.spinWheel({
      odds: ALWAYS_WINS,
      userId: "usr_a",
      candidates: GAMES,
      now: NOW,
    });

    const ledger = db.raw
      .prepare(`SELECT delta, reason FROM wheel_ticket_ledger WHERE user_id = ? ORDER BY rowid`)
      .all("usr_a") as { delta: number; reason: string }[];
    expect(ledger.map((row) => row.delta)).toEqual([1, -1]);
    expect(ledger[1]!.reason).toBe("spin");
  });
});

describe("spinning", () => {
  it("costs exactly one ticket and returns a prize", async () => {
    await wheel.grantTickets({ userId: "usr_a", quantity: 2, reason: "test", now: NOW });
    const outcome = await wheel.spinWheel({
      odds: ALWAYS_WINS,
      userId: "usr_a",
      candidates: GAMES,
      now: NOW,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.won) return;
    expect(GAMES.some((game) => game.id === outcome.prize.productId)).toBe(true);
    expect(outcome.ticketsLeft).toBe(1);
  });

  it("refuses with no ticket, and takes nothing", async () => {
    const outcome = await wheel.spinWheel({
      odds: ALWAYS_WINS,
      userId: "usr_a",
      candidates: GAMES,
      now: NOW,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("no_ticket");
    expect(await wheel.getTicketBalance("usr_a")).toBe(0);
  });

  it("cannot be overdrawn by spinning more times than it has tickets", async () => {
    await wheel.grantTickets({ userId: "usr_a", quantity: 2, reason: "test", now: NOW });
    const outcomes: Awaited<ReturnType<typeof wheel.spinWheel>>[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      outcomes.push(
        await wheel.spinWheel({
          odds: ALWAYS_WINS,
          userId: "usr_a",
          candidates: GAMES,
          now: NOW,
        }),
      );
    }
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(2);
    expect(await wheel.getTicketBalance("usr_a")).toBe(0);
  });

  it("does not let two simultaneous spins share one ticket", async () => {
    /*
      The guarded UPDATE is the whole defence. Two spins fired together must
      produce one winner and one refusal, not two prizes for one ticket.
    */
    await wheel.grantTickets({ userId: "usr_a", quantity: 1, reason: "test", now: NOW });
    const [first, second] = await Promise.all([
      wheel.spinWheel({
        odds: ALWAYS_WINS,
        userId: "usr_a",
        candidates: GAMES,
        now: NOW,
      }),
      wheel.spinWheel({
        odds: ALWAYS_WINS,
        userId: "usr_a",
        candidates: GAMES,
        now: NOW,
      }),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(await wheel.getTicketBalance("usr_a")).toBe(0);
  });

  it("gives the ticket back when there is nothing to win", async () => {
    await wheel.grantTickets({ userId: "usr_a", quantity: 1, reason: "test", now: NOW });
    const outcome = await wheel.spinWheel({
      odds: ALWAYS_WINS,
      userId: "usr_a",
      candidates: [],
      now: NOW,
    });

    expect(outcome.ok).toBe(false);
    // Refused before the ticket was ever claimed, so nothing to refund.
    expect(await wheel.getTicketBalance("usr_a")).toBe(1);
  });

  it("issues a coupon that pays for exactly that game, for exactly that member", async () => {
    await wheel.grantTickets({ userId: "usr_a", quantity: 1, reason: "test", now: NOW });
    const outcome = await wheel.spinWheel({
      odds: ALWAYS_WINS,
      userId: "usr_a",
      candidates: GAMES,
      now: NOW,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.won) return;

    const coupon = db.raw
      .prepare(
        `SELECT discount_type, discount_value, usage_limit, per_user_limit,
                eligible_products, eligible_users, is_stackable, max_discount_amount
         FROM coupons WHERE code = ?`,
      )
      .get(outcome.couponCode) as Record<string, unknown>;

    /*
      A fixed amount equal to the game's price, not 100%.

      This assertion used to read `percentage` / 100, which is how the defect
      survived: it is the literal description of "this game is free", and the
      engine reads a product-scoped percentage against `unitPrice × quantity`.
      See "the prize pays for one copy" below for what that cost.
    */
    expect(coupon.discount_type).toBe("fixed");
    expect(coupon.discount_value).toBe(outcome.prize.price);
    expect(coupon.max_discount_amount).toBe(outcome.prize.price);
    expect(coupon.usage_limit).toBe(1);
    expect(coupon.per_user_limit).toBe(1);
    expect(JSON.parse(String(coupon.eligible_products))).toEqual([outcome.prize.productId]);
    expect(JSON.parse(String(coupon.eligible_users))).toEqual(["usr_a"]);
    // A prize that pays the whole price must not also stack with a discount.
    expect(coupon.is_stackable).toBe(0);
  });

  it("writes one spin row per win, with the code on it", async () => {
    await wheel.grantTickets({ userId: "usr_a", quantity: 3, reason: "test", now: NOW });
    for (let n = 0; n < 3; n += 1) {
      await wheel.spinWheel({
        odds: ALWAYS_WINS,
        userId: "usr_a",
        candidates: GAMES,
        now: NOW,
      });
    }
    const spins = await wheel.recentSpins("usr_a", 10);
    expect(spins).toHaveLength(3);
    for (const spin of spins) expect(spin.coupon_code).toMatch(/^WIN-/);
  });

  it("keeps one member's tickets away from another's", async () => {
    await wheel.grantTickets({ userId: "usr_a", quantity: 1, reason: "test", now: NOW });
    const outcome = await wheel.spinWheel({
      odds: ALWAYS_WINS,
      userId: "usr_b",
      candidates: GAMES,
      now: NOW,
    });
    expect(outcome.ok).toBe(false);
    expect(await wheel.getTicketBalance("usr_a")).toBe(1);
  });
});

describe("ticket offers", () => {
  it("remembers which redemption offer sells tickets, and how many", async () => {
    await wheel.setTicketOffer("offer_1", 3);
    expect(await wheel.ticketQuantityForOffer("offer_1")).toBe(3);
    expect(await wheel.ticketQuantityForOffer("offer_2")).toBe(0);
  });

  it("stops being a ticket offer when set to zero", async () => {
    await wheel.setTicketOffer("offer_1", 3);
    await wheel.setTicketOffer("offer_1", 0);
    expect(await wheel.ticketQuantityForOffer("offer_1")).toBe(0);
  });
});

/**
 * The two windows between a write that succeeded and the one after it.
 *
 * D1 has no interactive transaction on this path, so every pair of statements
 * here has a gap in the middle, and what matters is what a member is left
 * holding when the process dies inside one. Both of these were real: the code
 * to close the first existed and had no caller, and the second had no code at
 * all.
 *
 * A trigger that aborts is how the second statement is made to fail on
 * demand. It is closer to the real failure than a mocked rejection, because
 * the first statement really has committed by the time it fires.
 */
describe("a write that fails half way", () => {
  const abort = (table: string) =>
    db.raw.exec(
      `CREATE TRIGGER boom_${table} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
    );
  const unabort = (table: string) => db.raw.exec(`DROP TRIGGER IF EXISTS boom_${table}`);

  it("takes the prize coupon back when the spin cannot be recorded", async () => {
    await wheel.grantTickets({ userId: "usr_a", quantity: 1, reason: "test", now: NOW });
    abort("wheel_spins");
    try {
      const outcome = await wheel.spinWheel({
        odds: ALWAYS_WINS,
        userId: "usr_a",
        candidates: GAMES,
        now: NOW,
      });
      expect(outcome.ok).toBe(false);
      /*
        And the outcome says the refund happened, because the screen repeats
        it to the member. The route used to print «أُعيدت تذكرتك» whatever
        this was — which is the one sentence that must not be guessed.
      */
      if (!outcome.ok) expect(outcome.ticketReturned).toBe(true);
    } finally {
      unabort("wheel_spins");
    }

    /*
      The whole point. Without the revoke the member walks away with a live
      100%-off coupon for a real game AND their ticket, and nothing anywhere
      records that a spin happened.
    */
    const left = db.raw
      .prepare(`SELECT COUNT(*) AS n FROM coupons WHERE code LIKE 'WIN-%'`)
      .get() as { n: number };
    expect(left.n).toBe(0);

    // The ticket does come back — they did not get their turn.
    expect(await wheel.getTicketBalance("usr_a")).toBe(1);
    expect(await wheel.recentSpins("usr_a", 10)).toHaveLength(0);
  });

  it("lets a grant be retried when the balance never got written", async () => {
    abort("wheel_tickets");
    try {
      await expect(
        wheel.grantTickets({
          userId: "usr_a",
          quantity: 2,
          reason: "admin",
          referenceId: "ref-1",
          now: NOW,
        }),
      ).rejects.toThrow();
    } finally {
      unabort("wheel_tickets");
    }

    expect(await wheel.getTicketBalance("usr_a")).toBe(0);

    /*
      The claim must have been given back. If it were still held, this second
      call — the admin pressing the button again after an error — would be
      refused as a duplicate and the member would never get the tickets.
    */
    const retry = await wheel.grantTickets({
      userId: "usr_a",
      quantity: 2,
      reason: "admin",
      referenceId: "ref-1",
      now: NOW,
    });
    expect(retry.granted).toBe(true);
    expect(await wheel.getTicketBalance("usr_a")).toBe(2);
  });

  it("still refuses a genuine duplicate", async () => {
    // The release above must not have weakened the thing it is guarding.
    await wheel.grantTickets({
      userId: "usr_a",
      quantity: 2,
      reason: "admin",
      referenceId: "ref-2",
      now: NOW,
    });
    const again = await wheel.grantTickets({
      userId: "usr_a",
      quantity: 2,
      reason: "admin",
      referenceId: "ref-2",
      now: NOW,
    });
    expect(again.granted).toBe(false);
    expect(await wheel.getTicketBalance("usr_a")).toBe(2);
  });
});

/**
 * What the prize is worth when the cart holds more than one copy.
 *
 * The coupon was `percentage` 100 restricted to the won product, which reads
 * like "this game is free" and is not what the engine does with it: a
 * product-scoped percentage is taken against `eligibleSubtotal`, and that is
 * `unitPrice × quantity`. `orders.server.ts` clamps a line to 1..99, so one
 * spin was worth up to ninety-nine free copies of the game it won.
 *
 * These run the real `couponDiscount` against the row the wheel actually
 * writes, because the defect was entirely in how the shared engine reads that
 * row — a test of the wheel's own logic would have passed either way.
 */
describe("the prize pays for one copy", () => {
  const cartLine = (productId: string, unitPrice: number, quantity: number) => ({
    productId,
    title: "Won Game",
    unitPrice,
    quantity,
    kind: "account",
  });

  const wonCoupon = async () => {
    await wheel.grantTickets({ userId: "usr_a", quantity: 1, reason: "test", now: NOW });
    const outcome = await wheel.spinWheel({
      odds: ALWAYS_WINS,
      userId: "usr_a",
      candidates: GAMES,
      now: NOW,
    });
    if (!outcome.ok || !outcome.won) throw new Error("the spin was supposed to win");
    const row = db.raw
      .prepare(`SELECT * FROM coupons WHERE code = ?`)
      .get(outcome.couponCode) as Record<string, unknown>;
    return { outcome, row };
  };

  it("covers the whole price of a single copy", async () => {
    const { outcome, row } = await wonCoupon();
    const { rowToCoupon, couponDiscount } = await import("./coupons");
    const coupon = rowToCoupon(row);
    const price = outcome.prize.price;
    const items = [cartLine(outcome.prize.productId, price, 1)];

    expect(couponDiscount(coupon, price, items).discount).toBe(price);
  });

  it("does not pay for the second copy, or the ninety-ninth", async () => {
    const { outcome, row } = await wonCoupon();
    const { rowToCoupon, couponDiscount } = await import("./coupons");
    const coupon = rowToCoupon(row);
    const price = outcome.prize.price;

    for (const quantity of [2, 5, 99]) {
      const items = [cartLine(outcome.prize.productId, price, quantity)];
      const { discount } = couponDiscount(coupon, price * quantity, items);
      expect(discount).toBe(price);
    }
  });

  it("pays nothing towards the other things in the cart", async () => {
    const { outcome, row } = await wonCoupon();
    const { rowToCoupon, couponDiscount } = await import("./coupons");
    const coupon = rowToCoupon(row);
    const price = outcome.prize.price;
    const items = [
      cartLine(outcome.prize.productId, price, 1),
      cartLine("some_other_game", 40_000, 2),
    ];

    expect(couponDiscount(coupon, price + 80_000, items).discount).toBe(price);
  });

  it("refuses to mint a prize with no price", async () => {
    const { issuePrizeCoupon } = await import("./wheel-prize.server");
    await expect(
      issuePrizeCoupon({
        userId: "usr_a",
        productId: "cheap",
        price: 0,
        issuedAt: NOW,
        expiresAt: NOW,
      }),
    ).rejects.toThrow(/WHEEL_PRIZE_NO_PRICE/);
  });
});

/**
 * Failures that must not undo work that already succeeded.
 *
 * Each of these is the same mistake in a different place: a read taken for
 * the screen, placed where a failure on it looks like a failure of the thing
 * it was reporting on. The cost is never the missing number — it is the
 * rollback that follows.
 */
describe("a read that fails after the work is done", () => {
  it("keeps the prize when only the closing balance cannot be read", async () => {
    await wheel.grantTickets({ userId: "usr_a", quantity: 1, reason: "test", now: NOW });
    /*
      Exactly `getTicketBalance`'s own SELECT is made to fail, at the binding,
      so every write the spin performs still lands. Failing the whole table
      would stop the spin before it started and prove nothing about the
      ordering this is here to hold.
    */
    const realPrepare = db.prepare;
    db.prepare = ((sql: string) => {
      if (/SELECT balance FROM wheel_tickets/.test(sql)) throw new Error("boom");
      return realPrepare.call(db, sql);
    }) as typeof db.prepare;
    try {
      const outcome = await wheel.spinWheel({
        odds: ALWAYS_WINS,
        userId: "usr_a",
        candidates: GAMES,
        now: NOW,
      });
      // The spin happened; a failing balance read must not turn it into a loss.
      expect(outcome.ok).toBe(true);
    } finally {
      db.prepare = realPrepare;
    }

    const coupons = db.raw
      .prepare(`SELECT COUNT(*) AS n FROM coupons WHERE code LIKE 'WIN-%'`)
      .get() as { n: number };
    expect(coupons.n).toBe(1);
    expect(await wheel.recentSpins("usr_a", 10)).toHaveLength(1);
  });
});

describe("one reference, many members", () => {
  it("grants a shared campaign reference to every one of them", async () => {
    /*
      The index was `UNIQUE (reference_id)` across the table, which reads as
      "this grant happens once" and means "once in the whole shop". A single
      campaign reference handed to a list of members granted the first and
      reported "already granted" for all the rest.
    */
    for (const userId of ["usr_a", "usr_b", "usr_c"]) {
      const result = await wheel.grantTickets({
        userId,
        quantity: 1,
        reason: "campaign",
        referenceId: "eid-2026",
        now: NOW,
      });
      expect(result.granted).toBe(true);
    }
    for (const userId of ["usr_a", "usr_b", "usr_c"]) {
      expect(await wheel.getTicketBalance(userId)).toBe(1);
    }
  });

  it("still refuses the same member twice under that reference", async () => {
    await wheel.grantTickets({
      userId: "usr_a",
      quantity: 1,
      reason: "campaign",
      referenceId: "eid-2026",
      now: NOW,
    });
    const again = await wheel.grantTickets({
      userId: "usr_a",
      quantity: 1,
      reason: "campaign",
      referenceId: "eid-2026",
      now: NOW,
    });
    expect(again.granted).toBe(false);
    expect(await wheel.getTicketBalance("usr_a")).toBe(1);
  });
});

describe("«حظ أوفر» — a spin that wins nothing", () => {
  /*
    The owner asked for a losing outcome whose chance is higher than the
    cheapest band's. Until now every spin that reached `pickWeighted` minted a
    coupon, so there was nothing to lose with.

    A loss must cost the ticket. A losing spin that refunded would be a free
    re-roll, which is not a chance of losing at all.
  */
  const ALWAYS_LOSES = { ...DEFAULT_WHEEL_ODDS, losingPercent: 90 };
  /** The draw, forced to the far end of the range, where the losing weight sits. */
  const lose = () => 0.999999999;

  it("spends the ticket and mints no coupon", async () => {
    await wheel.grantTickets({ userId: "usr_l", quantity: 1, reason: "test", referenceId: "l1" });

    const outcome = await wheel.spinWheel({
      odds: ALWAYS_LOSES,
      randomUnit: lose,
      userId: "usr_l",
      candidates: GAMES,
      now: NOW,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.won).toBe(false);
    expect(outcome.ticketsLeft).toBe(0);

    const coupons = db.raw.prepare(`SELECT COUNT(*) AS n FROM coupons`).get() as { n: number };
    expect(coupons.n).toBe(0);
  });

  it("records the spin, so the ticket is accounted for", async () => {
    await wheel.grantTickets({ userId: "usr_l", quantity: 1, reason: "test", referenceId: "l2" });
    await wheel.spinWheel({
      odds: ALWAYS_LOSES,
      randomUnit: lose,
      userId: "usr_l",
      candidates: GAMES,
      now: NOW,
    });

    const row = db.raw
      .prepare(`SELECT product_id, coupon_code, weight_label FROM wheel_spins WHERE user_id = ?`)
      .get("usr_l") as Record<string, unknown>;
    expect(row.product_id).toBe("");
    expect(row.coupon_code).toBeNull();
    expect(String(row.weight_label)).toContain("حظ");
  });

  it("does not show a loss in «جوائزك السابقة» as a blank prize", async () => {
    await wheel.grantTickets({ userId: "usr_l", quantity: 2, reason: "test", referenceId: "l3" });
    await wheel.spinWheel({
      odds: ALWAYS_LOSES,
      randomUnit: lose,
      userId: "usr_l",
      candidates: GAMES,
      now: NOW,
    });
    await wheel.spinWheel({
      odds: ALWAYS_WINS,
      userId: "usr_l",
      candidates: GAMES,
      now: NOW,
    });

    const spins = await wheel.recentSpins("usr_l", 10);
    expect(spins).toHaveLength(1);
    expect(spins[0]!.product_id).not.toBe("");
  });

  it("still wins when the draw lands in the games", async () => {
    await wheel.grantTickets({ userId: "usr_w", quantity: 1, reason: "test", referenceId: "w1" });
    const outcome = await wheel.spinWheel({
      odds: ALWAYS_LOSES,
      randomUnit: () => 0,
      userId: "usr_w",
      candidates: GAMES,
      now: NOW,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.won) throw new Error("the draw at zero should win");
    expect(outcome.couponCode).toBeTruthy();
  });

  it("cannot be spun without a ticket, losing or not", async () => {
    const outcome = await wheel.spinWheel({
      odds: ALWAYS_LOSES,
      randomUnit: lose,
      userId: "usr_broke",
      candidates: GAMES,
      now: NOW,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("no_ticket");
  });
});

/*
  «يتم عمل طلب لا مباشرة» — the prize is an order, and the coupon that would
  have been a second free copy of the same game is taken back.
*/
describe("a win becomes an order", () => {
  it("reports the order, and revokes the coupon that would double the gift", async () => {
    giftOrderResult = { orderId: "ord_gift", code: "BN-G-ABC123", threadId: "thr_gift" };
    await wheel.grantTickets({ userId: "usr_a", quantity: 1, reason: "test", now: NOW });

    const outcome = await wheel.spinWheel({
      odds: ALWAYS_WINS,
      userId: "usr_a",
      candidates: GAMES,
      now: NOW,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.won) return;
    expect(giftOrderCalls).toBe(1);
    expect(outcome.giftOrder?.orderId).toBe("ord_gift");

    /*
      The coupon is GONE. A member holding a 100%-off coupon for a game they
      have already been given as an order is the one outcome that costs the
      shop twice.
    */
    const coupon = db.raw
      .prepare(`SELECT is_active FROM coupons WHERE code = ?`)
      .get(outcome.couponCode) as { is_active?: number } | undefined;
    expect(coupon?.is_active ?? 0).toBe(0);
  });

  it("records the order against the spin that won it", async () => {
    giftOrderResult = { orderId: "ord_linked", code: "BN-G-LINK01", threadId: "thr_linked" };
    await wheel.grantTickets({ userId: "usr_a", quantity: 1, reason: "test", now: NOW });

    const outcome = await wheel.spinWheel({
      odds: ALWAYS_WINS,
      userId: "usr_a",
      candidates: GAMES,
      now: NOW,
    });
    if (!outcome.ok || !outcome.won) throw new Error("expected a win");

    const row = db.raw
      .prepare(`SELECT order_id FROM wheel_spins WHERE id = ?`)
      .get(outcome.spinId) as { order_id?: string } | undefined;
    expect(row?.order_id).toBe("ord_linked");
  });

  it("keeps the prize as a live coupon when the order cannot be written", async () => {
    /*
      The fallback, and the reason it is worth keeping: a member who has been
      told they won must not be left with nothing because a later write
      failed. This is what the wheel did before prizes became orders, so it is
      a known-good path rather than an untested one.
    */
    giftOrderResult = null;
    await wheel.grantTickets({ userId: "usr_a", quantity: 1, reason: "test", now: NOW });

    const outcome = await wheel.spinWheel({
      odds: ALWAYS_WINS,
      userId: "usr_a",
      candidates: GAMES,
      now: NOW,
    });
    if (!outcome.ok || !outcome.won) throw new Error("expected a win");

    expect(outcome.giftOrder).toBeUndefined();
    const coupon = db.raw
      .prepare(`SELECT is_active FROM coupons WHERE code = ?`)
      .get(outcome.couponCode) as { is_active?: number } | undefined;
    expect(coupon?.is_active).toBe(1);
    // And the ticket is still spent: the spin happened and the prize is real.
    expect(await wheel.getTicketBalance("usr_a")).toBe(0);
  });
});
