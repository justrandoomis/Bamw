/**
 * @vitest-environment node
 */
/**
 * «أجعل سعر التذكرة تحدد أيضا يدويا من الإدارة في إدارة الألعاب في عجلة الحظ.
 * وتأكد من الأمان وأن لا يصير هناك غش أو استغلال ... من حيث خصم الموز وتأكد من
 * رصيد الموز وسجل الموز».
 *
 * Until now a ticket could only arrive through a redemption reward flagged as
 * a ticket offer, or from an admin by hand. Production has zero of the first
 * and zero tickets in existence — nobody has ever spun the wheel — and there
 * was no single price anywhere for the owner to set.
 *
 * The purchase is where bananas become tickets, so it is where cheating would
 * pay. These run against a real database, and each one is an attack.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__TICKET_TEST_D1__"] = db;

vi.mock("./env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__TICKET_TEST_D1__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

let wheel: typeof import("./wheel.server");
let balance: typeof import("./banana-balance.server");

const BUYER = "usr_buyer";

beforeAll(async () => {
  const { ensureSchema } = await import("./d1.server");
  await ensureSchema();
  wheel = await import("./wheel.server");
  balance = await import("./banana-balance.server");
  await wheel.ensureWheelSchema();
});

/** Put a price on a ticket, the way the admin save does. */
async function priceAt(bananas: number) {
  await wheel.saveWheelOdds({ ticketPriceBananas: bananas });
}

async function bananas(): Promise<number> {
  return (await balance.getUserBananaBalance(BUYER)).balance;
}

beforeEach(async () => {
  const { d1Run } = await import("./d1.server");
  for (const table of ["wheel_tickets", "wheel_ticket_ledger", "banana_transactions"]) {
    db.raw.exec(`DELETE FROM ${table}`);
  }
  await d1Run(`DELETE FROM users WHERE id = ?`, BUYER);
  await d1Run(
    `INSERT INTO users (id, name, email, created_at, banana_balance, banana_locked)
     VALUES (?, ?, ?, ?, ?, 0)`,
    BUYER,
    "Buyer",
    "buyer@example.test",
    "2026-01-01T00:00:00.000Z",
    10_000,
  );
});

describe("the price is the owner's", () => {
  it("refuses to sell a ticket before a price is set", async () => {
    await priceAt(0);
    const bought = await wheel.buyTickets({ userId: BUYER, quantity: 1 });
    expect(bought.ok).toBe(false);
    if (bought.ok) return;
    expect(bought.reason).toBe("not_for_sale");
    expect(await bananas()).toBe(10_000);
    expect(await wheel.getTicketBalance(BUYER)).toBe(0);
  });

  it("charges exactly what the admin set, per ticket", async () => {
    await priceAt(250);
    const bought = await wheel.buyTickets({ userId: BUYER, quantity: 4 });
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(bought.spent).toBe(1_000);
    expect(await bananas()).toBe(9_000);
    expect(await wheel.getTicketBalance(BUYER)).toBe(4);
  });

  it("follows the admin when the price changes", async () => {
    await priceAt(100);
    await wheel.buyTickets({ userId: BUYER, quantity: 1 });
    await priceAt(900);
    await wheel.buyTickets({ userId: BUYER, quantity: 1 });
    expect(await bananas()).toBe(10_000 - 100 - 900);
  });
});

describe("what a member cannot do", () => {
  it("cannot buy more tickets than their bananas pay for", async () => {
    await priceAt(3_000);
    const bought = await wheel.buyTickets({ userId: BUYER, quantity: 4 });
    expect(bought.ok).toBe(false);
    if (bought.ok) return;
    expect(bought.reason).toBe("insufficient_bananas");
    // Nothing taken, nothing given.
    expect(await bananas()).toBe(10_000);
    expect(await wheel.getTicketBalance(BUYER)).toBe(0);
  });

  it("cannot ask for zero, a fraction, or a negative", async () => {
    await priceAt(10);
    for (const quantity of [0, -5, 0.5, Number.NaN]) {
      const bought = await wheel.buyTickets({ userId: BUYER, quantity });
      expect(bought.ok).toBe(false);
    }
    expect(await bananas()).toBe(10_000);
  });

  it("cannot ask for a quantity whose cost overflows the check", async () => {
    await priceAt(1);
    const bought = await wheel.buyTickets({ userId: BUYER, quantity: Number.MAX_SAFE_INTEGER });
    expect(bought.ok).toBe(false);
    expect(await bananas()).toBe(10_000);
  });

  it("cannot be charged twice by one purchase replayed", async () => {
    /*
      `debitBananaBalance` accepted an `idempotencyKey` and never looked it up
      — it was only the ledger row's id — so every caller that passed one
      believed it was protected and none of them were. A retried purchase took
      the bananas a second time and then failed on the ledger's primary key,
      AFTER the balance had already moved.
    */
    await priceAt(500);
    const reference = "tkb_replayed";
    const first = await balance.debitBananaBalance(BUYER, 500, {
      reason: "ticket",
      kind: "spend",
      idempotencyKey: reference,
    });
    const second = await balance.debitBananaBalance(BUYER, 500, {
      reason: "ticket",
      kind: "spend",
      idempotencyKey: reference,
    });
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(await bananas()).toBe(9_500);
  });
});

describe("the ledger", () => {
  it("records every purchase, so a member can be told where the bananas went", async () => {
    await priceAt(120);
    await wheel.buyTickets({ userId: BUYER, quantity: 2 });

    const tx = db.raw
      .prepare(`SELECT amount FROM banana_transactions WHERE user_id = ?`)
      .all(BUYER) as { amount: number }[];
    expect(tx).toHaveLength(1);
    expect(tx[0]!.amount).toBe(-240);

    const ledger = db.raw
      .prepare(`SELECT delta FROM wheel_ticket_ledger WHERE user_id = ?`)
      .all(BUYER) as { delta: number }[];
    expect(ledger.reduce((sum, row) => sum + row.delta, 0)).toBe(2);
  });
});
