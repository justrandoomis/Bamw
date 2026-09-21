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

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__WHEEL_TEST_D1__"] = db;

vi.mock("./env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__WHEEL_TEST_D1__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
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
  for (const table of ["wheel_tickets", "wheel_ticket_ledger", "wheel_spins", "coupons"]) {
    db.raw.exec(`DELETE FROM ${table}`);
  }
  db.reset();
});

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
    await wheel.spinWheel({ userId: "usr_a", candidates: GAMES, now: NOW });

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
    const outcome = await wheel.spinWheel({ userId: "usr_a", candidates: GAMES, now: NOW });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(GAMES.some((game) => game.id === outcome.prize.productId)).toBe(true);
    expect(outcome.ticketsLeft).toBe(1);
  });

  it("refuses with no ticket, and takes nothing", async () => {
    const outcome = await wheel.spinWheel({ userId: "usr_a", candidates: GAMES, now: NOW });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("no_ticket");
    expect(await wheel.getTicketBalance("usr_a")).toBe(0);
  });

  it("cannot be overdrawn by spinning more times than it has tickets", async () => {
    await wheel.grantTickets({ userId: "usr_a", quantity: 2, reason: "test", now: NOW });
    const outcomes = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      outcomes.push(await wheel.spinWheel({ userId: "usr_a", candidates: GAMES, now: NOW }));
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
      wheel.spinWheel({ userId: "usr_a", candidates: GAMES, now: NOW }),
      wheel.spinWheel({ userId: "usr_a", candidates: GAMES, now: NOW }),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(await wheel.getTicketBalance("usr_a")).toBe(0);
  });

  it("gives the ticket back when there is nothing to win", async () => {
    await wheel.grantTickets({ userId: "usr_a", quantity: 1, reason: "test", now: NOW });
    const outcome = await wheel.spinWheel({ userId: "usr_a", candidates: [], now: NOW });

    expect(outcome.ok).toBe(false);
    // Refused before the ticket was ever claimed, so nothing to refund.
    expect(await wheel.getTicketBalance("usr_a")).toBe(1);
  });

  it("issues a coupon that pays for exactly that game, for exactly that member", async () => {
    await wheel.grantTickets({ userId: "usr_a", quantity: 1, reason: "test", now: NOW });
    const outcome = await wheel.spinWheel({ userId: "usr_a", candidates: GAMES, now: NOW });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const coupon = db.raw
      .prepare(
        `SELECT discount_type, discount_value, usage_limit, per_user_limit,
                eligible_products, eligible_users, is_stackable
         FROM coupons WHERE code = ?`,
      )
      .get(outcome.couponCode) as Record<string, unknown>;

    expect(coupon.discount_type).toBe("percentage");
    expect(coupon.discount_value).toBe(100);
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
      await wheel.spinWheel({ userId: "usr_a", candidates: GAMES, now: NOW });
    }
    const spins = await wheel.recentSpins("usr_a", 10);
    expect(spins).toHaveLength(3);
    for (const spin of spins) expect(spin.coupon_code).toMatch(/^WIN-/);
  });

  it("keeps one member's tickets away from another's", async () => {
    await wheel.grantTickets({ userId: "usr_a", quantity: 1, reason: "test", now: NOW });
    const outcome = await wheel.spinWheel({ userId: "usr_b", candidates: GAMES, now: NOW });
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
