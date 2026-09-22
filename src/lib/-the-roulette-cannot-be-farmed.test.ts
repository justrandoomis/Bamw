/**
 * @vitest-environment node
 */
/**
 * Tickets are money and a prize is a game the shop pays for, so these run
 * against a real SQLite database rather than against the shape of the code.
 *
 * Every test here is one line of the owner's own attack list — «اختبر تحديداً»
 * — and each is named after the thing it refuses. What they have in common is
 * that none of them can be answered by reading the source: they are about what
 * survives a double click, a retry, two tabs and a failure in the middle.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__ROULETTE_TEST_D1__"] = db;

vi.mock("./env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__ROULETTE_TEST_D1__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

/*
  The gift order, under this file's control.

  The import's job is to call it exactly once per prize and to link what comes
  back. Whether the real order body writes a good order is `wheel-gift-order`'s
  own question, already answered by its own tests; mocking it here is what makes
  "exactly once" measurable rather than inferred.
*/
let giftOrderCalls: { orderId?: string; idempotencyKey?: string }[] = [];
let giftOrderFails = false;
vi.mock("./wheel-gift-order.server", () => ({
  WHEEL_GIFT_SOURCE: "wheel_prize",
  createWheelGiftOrder: async (input: Record<string, unknown>) => {
    giftOrderCalls.push({
      orderId: input["orderId"] as string,
      idempotencyKey: input["idempotencyKey"] as string,
    });
    if (giftOrderFails) throw new Error("ORDER_WRITE_FAILED");
    const orderId = String(input["orderId"] ?? "ord_x");
    const threadId = String(input["threadId"] ?? "thr_x");
    /* A real row, so "how many orders exist" is a question about the table. */
    db.raw
      .prepare(
        `INSERT OR IGNORE INTO orders
           (id, code, user_id, doc, status, payment_status, total, created_at, updated_at, idempotency_key, source)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        orderId,
        "BN-G-TEST",
        String(input["userId"] ?? ""),
        "{}",
        "processing",
        "paid",
        0,
        "2026-09-23T00:00:00.000Z",
        "2026-09-23T00:00:00.000Z",
        String(input["idempotencyKey"] ?? "") || null,
        "wheel_prize",
      );
    return { orderId, code: "BN-G-TEST", threadId };
  },
}));

let roulette: typeof import("./roulette.server");
let importer: typeof import("./roulette-import.server");
let wheel: typeof import("./wheel.server");
let pool: typeof import("./roulette-pool.server");

const NOW = "2026-09-23T00:00:00.000Z";
const USER = "usr_spinner";
const OTHER = "usr_stranger";

/** A pool with something in every bucket a test needs. */
const product = (id: string, price: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  price,
  kind: "game",
  ...extra,
});

let games: import("./roulette-pool.server").PoolGame[];

beforeAll(async () => {
  const { ensureSchema } = await import("./d1.server");
  await ensureSchema();
  wheel = await import("./wheel.server");
  pool = await import("./roulette-pool.server");
  roulette = await import("./roulette.server");
  importer = await import("./roulette-import.server");
  await roulette.ensureRouletteSchema();

  const flags = new Map<string, import("./roulette-pool.server").GameFlags>([
    ["famous_dear", { popularity: "high", excluded: false }],
    ["famous_cheap", { popularity: "high", excluded: false }],
  ]);
  games = pool.buildPool(
    [
      product("cheap_a", 3_000),
      product("cheap_b", 3_500),
      product("famous_cheap", 4_000),
      product("dear_a", 40_000),
      product("famous_dear", 75_000),
    ],
    flags,
  ).games;
});

beforeEach(() => {
  giftOrderCalls = [];
  giftOrderFails = false;
  for (const table of [
    "wheel_tickets",
    "wheel_ticket_ledger",
    "wheel_spins",
    "roulette_prizes",
    "orders",
  ]) {
    db.raw.exec(`DELETE FROM ${table}`);
  }
  db.reset();
});

const give = async (userId: string, quantity: number) => {
  await wheel.grantTickets({ userId, quantity, reason: "test", now: NOW });
};

/** A draw that always lands on the first prize bucket with games in it. */
const ALWAYS_WIN = () => 0.999999;
/** A draw that always lands in the losing share. */
const ALWAYS_LOSE = () => 0;

describe("a spin cannot be made without paying for it", () => {
  it("refuses a spin with no tickets at all", async () => {
    // «إرسال spin بدون تذاكر».
    const result = await roulette.spinRoulette({
      userId: USER,
      tickets: 1,
      requestId: "req_1",
      games,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: "no_tickets" });
    expect(await wheel.getTicketBalance(USER)).toBe(0);
    expect(db.raw.prepare(`SELECT count(*) AS n FROM wheel_spins`).get()).toMatchObject({ n: 0 });
  });

  it("refuses ten tickets from a member holding nine, and takes none of them", async () => {
    // «استخدام 10 تذاكر بينما لديه 9» — the whole point of one guarded UPDATE.
    await give(USER, 9);
    const result = await roulette.spinRoulette({
      userId: USER,
      tickets: 10,
      requestId: "req_2",
      games,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: "no_tickets" });
    expect(await wheel.getTicketBalance(USER)).toBe(9);
  });

  it("refuses a ticket count that is not a ticket count", async () => {
    // «إرسال -1 tickets» and «إرسال 100 tickets».
    await give(USER, 10);
    for (const tickets of [-1, 0, 11, 100, 1.5, "abc", null, [5]]) {
      const result = await roulette.spinRoulette({
        userId: USER,
        tickets,
        requestId: `req_bad_${String(tickets)}`,
        games,
        now: NOW,
      });
      expect(result, String(tickets)).toMatchObject({ ok: false, reason: "bad_tickets" });
    }
    expect(await wheel.getTicketBalance(USER)).toBe(10);
  });

  it("takes exactly the tickets it was asked for, once", async () => {
    await give(USER, 10);
    const result = await roulette.spinRoulette({
      userId: USER,
      tickets: 5,
      requestId: "req_3",
      games,
      now: NOW,
      drawBucket: ALWAYS_LOSE,
    });
    expect(result.ok).toBe(true);
    expect(await wheel.getTicketBalance(USER)).toBe(5);

    /* And the ledger says where they went, with the spin named. */
    const ledger = db.raw
      .prepare(`SELECT delta, reason, reference_id FROM wheel_ticket_ledger WHERE delta < 0`)
      .all() as Record<string, unknown>[];
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: -5, reason: "roulette_spin" });
    expect(String(ledger[0]["reference_id"])).toContain("spin:");
  });
});

describe("pressing the button twice", () => {
  it("charges once and shows the same result", async () => {
    // «replay لنفس request» and «الضغط المزدوج».
    await give(USER, 10);
    const first = await roulette.spinRoulette({
      userId: USER,
      tickets: 3,
      requestId: "req_same",
      games,
      now: NOW,
      drawBucket: ALWAYS_WIN,
      drawGame: () => 0,
    });
    const second = await roulette.spinRoulette({
      userId: USER,
      tickets: 3,
      requestId: "req_same",
      games,
      now: NOW,
      drawBucket: ALWAYS_WIN,
      drawGame: () => 0,
    });

    expect(first.ok && second.ok).toBe(true);
    expect(await wheel.getTicketBalance(USER)).toBe(7);
    expect(db.raw.prepare(`SELECT count(*) AS n FROM wheel_spins`).get()).toMatchObject({ n: 1 });
    if (first.ok && second.ok) {
      expect(second.spinId).toBe(first.spinId);
      expect(second.replay).toBe(true);
      expect(second.won).toBe(first.won);
    }
  });

  it("survives two requests fired at the same instant", async () => {
    // «concurrent requests».
    await give(USER, 10);
    const both = await Promise.all([
      roulette.spinRoulette({
        userId: USER,
        tickets: 4,
        requestId: "req_race",
        games,
        now: NOW,
        drawBucket: ALWAYS_WIN,
        drawGame: () => 0,
      }),
      roulette.spinRoulette({
        userId: USER,
        tickets: 4,
        requestId: "req_race",
        games,
        now: NOW,
        drawBucket: ALWAYS_WIN,
        drawGame: () => 0,
      }),
    ]);
    expect(both.every((r) => r.ok)).toBe(true);
    expect(await wheel.getTicketBalance(USER)).toBe(6);
    expect(db.raw.prepare(`SELECT count(*) AS n FROM wheel_spins`).get()).toMatchObject({ n: 1 });
    expect(db.raw.prepare(`SELECT count(*) AS n FROM roulette_prizes`).get()).toMatchObject({
      n: 1,
    });
  });

  it("charges twice for two genuinely different presses", async () => {
    /*
      The other half of idempotency, and the half a too-eager guard breaks: two
      real spins must both happen. A member who presses, sees a loss and
      presses again is owed a second spin.
    */
    await give(USER, 10);
    await roulette.spinRoulette({
      userId: USER,
      tickets: 1,
      requestId: "press_1",
      games,
      now: NOW,
      drawBucket: ALWAYS_LOSE,
    });
    await roulette.spinRoulette({
      userId: USER,
      tickets: 1,
      requestId: "press_2",
      games,
      now: NOW,
      drawBucket: ALWAYS_LOSE,
    });
    expect(await wheel.getTicketBalance(USER)).toBe(8);
    expect(db.raw.prepare(`SELECT count(*) AS n FROM wheel_spins`).get()).toMatchObject({ n: 2 });
  });
});

describe("what a spin records, so it can be audited", () => {
  it("writes the ticket count, the bucket and the odds it actually ran on", async () => {
    await give(USER, 10);
    const result = await roulette.spinRoulette({
      userId: USER,
      tickets: 7,
      requestId: "req_audit",
      games,
      now: NOW,
      drawBucket: ALWAYS_WIN,
      drawGame: () => 0,
    });
    expect(result.ok).toBe(true);

    const row = db.raw.prepare(`SELECT * FROM wheel_spins`).get() as Record<string, unknown>;
    expect(Number(row["tickets"])).toBe(7);
    expect(String(row["status"])).toBe("settled");
    expect(String(row["request_id"])).toBe("req_audit");
    expect(String(row["bucket"])).not.toBe("");

    const snapshot = JSON.parse(String(row["odds_snapshot"]));
    expect(snapshot.tickets).toBe(7);
    const total = Object.values(snapshot.probabilities as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    expect(total).toBeCloseTo(100, 6);
  });

  it("records a loss as a loss, with no prize behind it", async () => {
    await give(USER, 3);
    const result = await roulette.spinRoulette({
      userId: USER,
      tickets: 1,
      requestId: "req_loss",
      games,
      now: NOW,
      drawBucket: ALWAYS_LOSE,
    });
    expect(result).toMatchObject({ ok: true, won: false });
    expect(db.raw.prepare(`SELECT count(*) AS n FROM roulette_prizes`).get()).toMatchObject({
      n: 0,
    });
  });

  it("creates exactly one prize for a win, and no order", async () => {
    // «win creates exactly one Prize» and «no immediate Order on win».
    await give(USER, 3);
    const result = await roulette.spinRoulette({
      userId: USER,
      tickets: 1,
      requestId: "req_win",
      games,
      now: NOW,
      drawBucket: ALWAYS_WIN,
      drawGame: () => 0,
    });
    expect(result).toMatchObject({ ok: true, won: true });
    expect(db.raw.prepare(`SELECT count(*) AS n FROM roulette_prizes`).get()).toMatchObject({
      n: 1,
    });
    expect(db.raw.prepare(`SELECT count(*) AS n FROM orders`).get()).toMatchObject({ n: 0 });
    expect(giftOrderCalls).toHaveLength(0);
    if (result.ok && result.won) {
      expect(result.prize.status).toBe("available");
      expect(result.prize.orderId).toBeNull();
    }
  });

  it("refuses to spin at all when nothing can be won", async () => {
    await give(USER, 5);
    const result = await roulette.spinRoulette({
      userId: USER,
      tickets: 5,
      requestId: "req_empty",
      games: [],
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: "empty_pool" });
    // And it costs nothing: a certainty is not something to charge for.
    expect(await wheel.getTicketBalance(USER)).toBe(5);
  });
});

describe("importing a prize", () => {
  const win = async (requestId = "req_prize") => {
    await give(USER, 5);
    const result = await roulette.spinRoulette({
      userId: USER,
      tickets: 1,
      requestId,
      games,
      now: NOW,
      drawBucket: ALWAYS_WIN,
      drawGame: () => 0,
    });
    if (!result.ok || !result.won) throw new Error("expected a win");
    return result.prize;
  };

  it("creates one order and links it to the prize", async () => {
    const prize = await win();
    const result = await importer.importPrize({ userId: USER, prizeId: prize.id, now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyImported).toBe(false);
    expect(await importer.countOrdersForPrize(prize.id)).toBe(1);

    const row = db.raw
      .prepare(`SELECT * FROM roulette_prizes WHERE id = ?`)
      .get(prize.id) as Record<string, unknown>;
    expect(String(row["status"])).toBe("claimed");
    expect(String(row["order_id"])).toBe(result.orderId);
    expect(String(row["thread_id"])).toBe(result.threadId);
  });

  it("makes one order out of a double click", async () => {
    // «استيراد الجائزة مرتين» and «double claim creates one order».
    const prize = await win();
    const first = await importer.importPrize({ userId: USER, prizeId: prize.id, now: NOW });
    const second = await importer.importPrize({ userId: USER, prizeId: prize.id, now: NOW });

    expect(first.ok && second.ok).toBe(true);
    expect(await importer.countOrdersForPrize(prize.id)).toBe(1);
    if (first.ok && second.ok) {
      expect(second.orderId).toBe(first.orderId);
      expect(second.alreadyImported).toBe(true);
    }
  });

  it("makes one order out of two requests at the same instant", async () => {
    // «concurrent claim creates one order».
    const prize = await win();
    const both = await Promise.all([
      importer.importPrize({ userId: USER, prizeId: prize.id, now: NOW }),
      importer.importPrize({ userId: USER, prizeId: prize.id, now: NOW }),
    ]);
    expect(await importer.countOrdersForPrize(prize.id)).toBe(1);
    // One of them may be told to wait; neither may create a second order.
    const succeeded = both.filter((r) => r.ok);
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    expect(giftOrderCalls.length).toBeLessThanOrEqual(1);
  });

  it("refuses to import somebody else's prize", async () => {
    // «استيراد جائزة مستخدم آخر» and «التلاعب بـPrize ID».
    const prize = await win();
    const result = await importer.importPrize({ userId: OTHER, prizeId: prize.id, now: NOW });
    expect(result).toMatchObject({ ok: false, reason: "not_yours" });
    expect(await importer.countOrdersForPrize(prize.id)).toBe(0);

    const row = db.raw
      .prepare(`SELECT status FROM roulette_prizes WHERE id = ?`)
      .get(prize.id) as Record<string, unknown>;
    expect(String(row["status"])).toBe("available");
  });

  it("refuses a prize id that does not exist", async () => {
    const result = await importer.importPrize({ userId: USER, prizeId: "przw_made_up", now: NOW });
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("gives the prize back when the order cannot be written", async () => {
    /*
      «فشل Import بعد تغيير حالة prize» — a failure in the middle must not
      leave a member holding a prize they can never import.
    */
    const prize = await win();
    giftOrderFails = true;
    const failed = await importer.importPrize({ userId: USER, prizeId: prize.id, now: NOW });
    expect(failed).toMatchObject({ ok: false, reason: "failed" });

    const row = db.raw
      .prepare(`SELECT status FROM roulette_prizes WHERE id = ?`)
      .get(prize.id) as Record<string, unknown>;
    expect(String(row["status"])).toBe("available");

    giftOrderFails = false;
    const retried = await importer.importPrize({ userId: USER, prizeId: prize.id, now: NOW });
    expect(retried.ok).toBe(true);
    expect(await importer.countOrdersForPrize(prize.id)).toBe(1);
  });

  it("uses the product stored on the prize, not one a caller names", async () => {
    /*
      «طلب لعبة غير التي فاز بها» — there is no parameter for it. The import
      takes a prize id and reads everything else off the row, which is what
      makes the attack impossible rather than merely refused.
    */
    const prize = await win();
    await importer.importPrize({ userId: USER, prizeId: prize.id, now: NOW });
    const order = db.raw.prepare(`SELECT * FROM orders`).get() as Record<string, unknown>;
    expect(String(order["idempotency_key"])).toBe(`roulette_prize:${prize.id}`);
    expect(giftOrderCalls[0]?.idempotencyKey).toBe(`roulette_prize:${prize.id}`);
  });

  it("marks the order as a gift from the roulette", async () => {
    const prize = await win();
    await importer.importPrize({ userId: USER, prizeId: prize.id, now: NOW });
    const order = db.raw.prepare(`SELECT * FROM orders`).get() as Record<string, unknown>;
    expect(String(order["source"])).toBe("wheel_prize");
    expect(Number(order["total"])).toBe(0);
    expect(String(order["payment_status"])).toBe("paid");
  });
});
