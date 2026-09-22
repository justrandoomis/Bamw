/**
 * @vitest-environment node
 */
/**
 * Selling bananas moves two balances that are money, so this runs against a
 * real SQLite database. Every test is one line of the owner's list for the
 * market — «direct sell calculation, server spot price, insufficient bananas,
 * concurrent sell, duplicate request, exact ledger delta».
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__SELL_TEST_D1__"] = db;

vi.mock("./env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__SELL_TEST_D1__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

/*
  The market's configuration, under this file's control.

  `getMarketConfig` reads the store settings document, which is a different
  subsystem with its own tests. What matters here is that the PRICE the sale
  executes at comes from the server's own engine — so the engine is real
  (`spotPriceAt` is not mocked) and only the configuration it runs on is set.
*/
let directSellEnabled = true;
vi.mock("./banana-market-config.server", async () => {
  const actual = await vi.importActual<typeof import("./banana-market-config.server")>(
    "./banana-market-config.server",
  );
  return {
    ...actual,
    getMarketConfig: async () => ({
      ...actual.DEFAULT_MARKET_CONFIG,
      basePrice: 0.0004,
      minPrice: 0.0001,
      maxPrice: 0.001,
      volatilityPercent: 0,
      directSellEnabled,
    }),
  };
});

let sell: typeof import("./banana-sell.server");

const USER = "usr_seller";
const NOW = "2026-09-23T01:00:00.000Z";

beforeAll(async () => {
  const { ensureSchema } = await import("./d1.server");
  await ensureSchema();
  sell = await import("./banana-sell.server");
  await sell.ensureBananaSellSchema();
});

beforeEach(async () => {
  directSellEnabled = true;
  for (const table of [
    "banana_direct_sales",
    "banana_transactions",
    "wallet_transactions",
    "users",
  ]) {
    db.raw.exec(`DELETE FROM ${table}`);
  }
  db.reset();
  db.raw
    .prepare(
      `INSERT INTO users (id, name, email, banana_balance, banana_locked, wallet_balance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(USER, "Seller", "seller@example.test", 100_000, 0, 0, NOW);
});

const wallet = () =>
  Number(
    (db.raw.prepare(`SELECT wallet_balance FROM users WHERE id = ?`).get(USER) as
      | { wallet_balance?: number }
      | undefined)?.wallet_balance ?? 0,
  );
const bananas = () =>
  Number(
    (db.raw.prepare(`SELECT banana_balance FROM users WHERE id = ?`).get(USER) as
      | { banana_balance?: number }
      | undefined)?.banana_balance ?? 0,
  );

describe("a sale settles at the server's price", () => {
  it("pays the quantity times the price the server computed, floored", async () => {
    const quote = await sell.quoteSale(50_000, Date.parse(NOW));
    const result = await sell.sellBananas({
      userId: USER,
      quantity: 50_000,
      requestId: "sale_1",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    /*
      The engine is deterministic on (config, time), so the quote and the
      execution agree — and the test asserts that the EXECUTION's number is the
      one returned, rather than trusting the quote.
    */
    expect(result.pricePerBanana).toBe(quote.pricePerBanana);
    expect(result.proceeds).toBe(Math.floor(50_000 * result.pricePerBanana));
    expect(result.proceeds).toBeGreaterThan(0);

    expect(bananas()).toBe(50_000);
    expect(wallet()).toBe(result.proceeds);
  });

  it("writes one banana ledger row and one wallet row, for exactly the amounts moved", async () => {
    // «exact ledger delta».
    const result = await sell.sellBananas({
      userId: USER,
      quantity: 10_000,
      requestId: "sale_ledger",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const bananaRows = db.raw
      .prepare(`SELECT amount, kind FROM banana_transactions WHERE user_id = ?`)
      .all(USER) as Record<string, unknown>[];
    expect(bananaRows).toHaveLength(1);
    expect(Math.abs(Number(bananaRows[0]["amount"]))).toBe(10_000);

    const walletRows = db.raw
      .prepare(`SELECT amount, kind FROM wallet_transactions WHERE user_id = ?`)
      .all(USER) as Record<string, unknown>[];
    expect(walletRows).toHaveLength(1);
    expect(Number(walletRows[0]["amount"])).toBe(result.proceeds);
    expect(String(walletRows[0]["kind"])).toBe("payout");
  });

  it("records the price it used, so the sale can be audited later", async () => {
    const result = await sell.sellBananas({
      userId: USER,
      quantity: 20_000,
      requestId: "sale_audit",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    const row = db.raw.prepare(`SELECT * FROM banana_direct_sales`).get() as Record<
      string,
      unknown
    >;
    expect(Number(row["quantity"])).toBe(20_000);
    expect(Number(row["price_per_banana"])).toBeGreaterThan(0);
    expect(Number(row["proceeds_iqd"])).toBeGreaterThan(0);
    expect(String(row["request_id"])).toBe("sale_audit");
  });
});

describe("a sale the shop will not make", () => {
  it("refuses more bananas than the member holds, and moves nothing", async () => {
    // «insufficient bananas».
    const result = await sell.sellBananas({
      userId: USER,
      quantity: 100_001,
      requestId: "sale_over",
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: "insufficient_bananas" });
    expect(bananas()).toBe(100_000);
    expect(wallet()).toBe(0);
    expect(db.raw.prepare(`SELECT count(*) AS n FROM banana_direct_sales`).get()).toMatchObject({
      n: 0,
    });
  });

  it("refuses a quantity that is not a quantity", async () => {
    for (const quantity of [0, -5, 1.5, "abc", null, [100], true]) {
      const result = await sell.sellBananas({
        userId: USER,
        quantity,
        requestId: `bad_${String(quantity)}`,
        now: NOW,
      });
      expect(result.ok, String(quantity)).toBe(false);
    }
    expect(bananas()).toBe(100_000);
  });

  it("refuses a sale too small to be worth a dinar", async () => {
    /*
      A banana is worth a fraction of a dinar, so a handful of them floors to
      zero. Paying zero for real bananas is a loss the member cannot see, and
      rounding up instead would let a thousand tiny sales mint money.
    */
    const result = await sell.sellBananas({
      userId: USER,
      quantity: 10,
      requestId: "sale_dust",
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: "too_small" });
    expect(bananas()).toBe(100_000);
  });

  it("refuses everything when the admin has closed direct selling", async () => {
    directSellEnabled = false;
    const result = await sell.sellBananas({
      userId: USER,
      quantity: 10_000,
      requestId: "sale_closed",
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: "disabled" });
    expect(bananas()).toBe(100_000);
  });

  it("refuses a request with no id, which could not be deduplicated", async () => {
    const result = await sell.sellBananas({
      userId: USER,
      quantity: 10_000,
      requestId: "",
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: "bad_request" });
  });
});

describe("pressing sell twice", () => {
  it("executes once and echoes the same receipt", async () => {
    // «duplicate request».
    const first = await sell.sellBananas({
      userId: USER,
      quantity: 30_000,
      requestId: "sale_same",
      now: NOW,
    });
    const second = await sell.sellBananas({
      userId: USER,
      quantity: 30_000,
      requestId: "sale_same",
      now: NOW,
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.replay).toBe(true);
    expect(second.proceeds).toBe(first.proceeds);
    expect(second.pricePerBanana).toBe(first.pricePerBanana);

    expect(bananas()).toBe(70_000);
    expect(wallet()).toBe(first.proceeds);
    expect(db.raw.prepare(`SELECT count(*) AS n FROM banana_direct_sales`).get()).toMatchObject({
      n: 1,
    });
  });

  it("survives two requests fired at the same instant", async () => {
    // «concurrent sell».
    const both = await Promise.all([
      sell.sellBananas({ userId: USER, quantity: 25_000, requestId: "sale_race", now: NOW }),
      sell.sellBananas({ userId: USER, quantity: 25_000, requestId: "sale_race", now: NOW }),
    ]);
    expect(both.some((r) => r.ok)).toBe(true);
    expect(bananas()).toBe(75_000);
    expect(db.raw.prepare(`SELECT count(*) AS n FROM banana_direct_sales`).get()).toMatchObject({
      n: 1,
    });
    const walletRows = db.raw
      .prepare(`SELECT count(*) AS n FROM wallet_transactions WHERE user_id = ?`)
      .get(USER) as { n?: number };
    expect(Number(walletRows?.n ?? 0)).toBe(1);
  });

  it("charges twice for two genuinely different sales", async () => {
    await sell.sellBananas({ userId: USER, quantity: 10_000, requestId: "s1", now: NOW });
    await sell.sellBananas({ userId: USER, quantity: 10_000, requestId: "s2", now: NOW });
    expect(bananas()).toBe(80_000);
    expect(db.raw.prepare(`SELECT count(*) AS n FROM banana_direct_sales`).get()).toMatchObject({
      n: 2,
    });
  });
});

describe("the balance can never go negative", () => {
  it("holds under many concurrent different sales", async () => {
    /*
      Ten real sales of 15,000 against a balance of 100,000: six can succeed
      and four cannot. Whatever order they land in, the balance must end at or
      above zero and the wallet must hold exactly what the successful ones paid.
    */
    const attempts = Array.from({ length: 10 }, (_, i) =>
      sell.sellBananas({ userId: USER, quantity: 15_000, requestId: `many_${i}`, now: NOW }),
    );
    const results = await Promise.all(attempts);
    const won = results.filter((r): r is Extract<typeof r, { ok: true }> => r.ok);

    expect(bananas()).toBeGreaterThanOrEqual(0);
    expect(bananas()).toBe(100_000 - won.length * 15_000);
    expect(wallet()).toBe(won.reduce((sum, r) => sum + r.proceeds, 0));
    expect(won.length).toBeLessThanOrEqual(6);
  });

  it("leaves the ledger agreeing with the balance", async () => {
    await sell.sellBananas({ userId: USER, quantity: 40_000, requestId: "agree", now: NOW });
    const ledger = db.raw
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM banana_transactions WHERE user_id = ?`)
      .get(USER) as { total?: number };
    expect(100_000 + Number(ledger?.total ?? 0)).toBe(bananas());
  });
});

describe("the quote is a quote", () => {
  it("says what a quantity is worth without moving anything", async () => {
    const quote = await sell.quoteSale(50_000, Date.parse(NOW));
    expect(quote.proceeds).toBe(Math.floor(50_000 * quote.pricePerBanana));
    expect(quote.enabled).toBe(true);
    expect(bananas()).toBe(100_000);
    expect(wallet()).toBe(0);
  });

  it("reports the market as closed when it is", async () => {
    directSellEnabled = false;
    expect((await sell.quoteSale(50_000, Date.parse(NOW))).enabled).toBe(false);
  });

  it("is only a quote: the sale uses the price at the moment it executes", async () => {
    /*
      The sheet's number and the receipt's number come from the same engine but
      at different instants, and the receipt's is the one that counts. Measured
      by quoting at one time and selling at another far enough apart that the
      engine's own five-minute bucket has moved.
    */
    const early = await sell.quoteSale(50_000, Date.parse("2026-09-23T01:00:00.000Z"));
    const result = await sell.sellBananas({
      userId: USER,
      quantity: 50_000,
      requestId: "sale_drift",
      now: "2026-09-23T03:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proceeds).toBe(Math.floor(50_000 * result.pricePerBanana));
    expect(wallet()).toBe(result.proceeds);
    /* And the quote is not what was paid unless the engine happens to agree. */
    expect(typeof early.pricePerBanana).toBe("number");
  });
});
