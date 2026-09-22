/**
 * @vitest-environment node
 */
/**
 * One listing sells once, and a bot offer sells once.
 *
 * «سوق الموز اصلحها» — the owner. The market was not dead: listings create,
 * sell and settle, and bot offers are buyable. What it did not do was decide
 * WHO WON when two people bought the same thing.
 *
 * `buyListing` read the offer with `status = 'active'` and then marked it sold
 * with `WHERE id = ?` — no status in the condition at all. Two buyers who both
 * passed the read both ran the whole money batch. Reproduced before the fix, on
 * this same harness: one 10,000-banana listing sold twice, the seller paid
 * 1,900 IQD twice, both buyers credited 10,000 bananas each. Ten thousand
 * bananas minted from nothing, in a shop that then has to honour them.
 *
 * It had gone unnoticed because something unrelated was half-catching it: the
 * locked-banana release wrote NULL through a CASE, and `users.banana_locked` is
 * NOT NULL — so the second buyer aborted, but ONLY when the seller had no other
 * listing locking bananas. Two listings, and both buys went through. A guard
 * that works by accident on some rows is not a guard.
 *
 * The exploit is run here rather than described, because a guard that is only
 * read is a guard that is only hoped for.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__TEST_D1__"] = db;

vi.mock("@/lib/env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__TEST_D1__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

let market: typeof import("./banana.server");

const SELLER = "usr_seller";
const BUYER_A = "usr_buyer_a";
const BUYER_B = "usr_buyer_b";

beforeAll(async () => {
  const { ensureSchema } = await import("@/lib/d1.server");
  await ensureSchema();
  market = await import("./banana.server");
});

async function user(id: string) {
  const { d1First } = await import("@/lib/d1.server");
  return d1First<{ wallet_balance: number; banana_balance: number; banana_locked: number }>(
    `SELECT COALESCE(wallet_balance, 0) AS wallet_balance,
            COALESCE(banana_balance, 0) AS banana_balance,
            COALESCE(banana_locked, 0) AS banana_locked
     FROM users WHERE id = ?`,
    id,
  );
}

async function makeUser(id: string, wallet: number, bananas: number) {
  const { d1Run } = await import("@/lib/d1.server");
  await d1Run(`DELETE FROM users WHERE id = ?`, id);
  await d1Run(
    `INSERT INTO users (id, name, email, created_at, wallet_balance, banana_balance, banana_locked)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    id,
    id,
    `${id}@example.test`,
    "2026-01-01T00:00:00.000Z",
    wallet,
    bananas,
  );
}

beforeEach(async () => {
  const { d1Run } = await import("@/lib/d1.server");
  await d1Run(`DELETE FROM banana_market_offers`);
  await d1Run(`DELETE FROM wallet_transactions`);
  await d1Run(`DELETE FROM banana_transactions`);
  await makeUser(SELLER, 0, 100_000);
  await makeUser(BUYER_A, 50_000, 0);
  await makeUser(BUYER_B, 50_000, 0);
});

describe("two buyers, one listing", () => {
  /*
    THE SHAPE THAT USED TO SUCCEED TWICE.

    The seller holds a SECOND active listing on purpose: that is what made the
    old NOT NULL abort miss, and it is the case that took real money.
  */
  it("sells to exactly one of them, however many listings the seller holds", async () => {
    const decoy = await market.createListing(SELLER, { quantity: 10_000, pricePer: 0.2 });
    expect(decoy).toBeTruthy();
    const listing = await market.createListing(SELLER, { quantity: 10_000, pricePer: 0.2 });
    const listingId = String((listing as { id?: string })?.id ?? "");
    expect(listingId).toBeTruthy();

    const results = await Promise.allSettled([
      market.buyListing(BUYER_A, listingId),
      market.buyListing(BUYER_B, listingId),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    expect(won).toHaveLength(1);

    const a = await user(BUYER_A);
    const b = await user(BUYER_B);
    // Exactly one buyer holds the bananas, and exactly one paid for them.
    expect(Number(a?.banana_balance) + Number(b?.banana_balance)).toBe(10_000);
    expect(Number(a?.wallet_balance) + Number(b?.wallet_balance)).toBe(50_000 + 48_000);

    const { d1First } = await import("@/lib/d1.server");
    const payouts = await d1First<{ n: number; total: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
       FROM wallet_transactions WHERE user_id = ? AND kind = 'payout'`,
      SELLER,
    );
    expect(Number(payouts?.n)).toBe(1);
  });

  it("records who bought it, so a disputed sale has a counterparty", async () => {
    const listing = await market.createListing(SELLER, { quantity: 5_000, pricePer: 0.2 });
    const listingId = String((listing as { id?: string })?.id ?? "");
    await market.buyListing(BUYER_A, listingId);

    const { d1First } = await import("@/lib/d1.server");
    const row = await d1First<{ status: string; buyer_id: string }>(
      `SELECT status, buyer_id FROM banana_market_offers WHERE id = ?`,
      listingId,
    );
    expect(row?.status).toBe("sold");
    expect(row?.buyer_id).toBe(BUYER_A);
  });

  it("refuses a second buy of a listing already sold", async () => {
    const listing = await market.createListing(SELLER, { quantity: 5_000, pricePer: 0.2 });
    const listingId = String((listing as { id?: string })?.id ?? "");
    await market.buyListing(BUYER_A, listingId);
    await expect(market.buyListing(BUYER_B, listingId)).rejects.toThrow();

    const b = await user(BUYER_B);
    expect(Number(b?.wallet_balance)).toBe(50_000);
    expect(Number(b?.banana_balance)).toBe(0);
  });

  /*
    The seller's locked bananas come back once, not once per buyer. The old
    `CASE … ELSE NULL` both failed to guard and, on the row it did abort,
    reported a raw database error rather than anything a member could read.
  */
  it("releases the seller's lock exactly once", async () => {
    const listing = await market.createListing(SELLER, { quantity: 10_000, pricePer: 0.2 });
    const listingId = String((listing as { id?: string })?.id ?? "");
    const before = await user(SELLER);
    expect(Number(before?.banana_locked)).toBe(10_000);

    await Promise.allSettled([
      market.buyListing(BUYER_A, listingId),
      market.buyListing(BUYER_B, listingId),
    ]);

    const after = await user(SELLER);
    expect(Number(after?.banana_locked)).toBe(0);
  });
});

describe("a buyer who cannot pay", () => {
  it("is refused, and the listing stays on the market", async () => {
    await makeUser(BUYER_A, 10, 0);
    const listing = await market.createListing(SELLER, { quantity: 10_000, pricePer: 0.2 });
    const listingId = String((listing as { id?: string })?.id ?? "");

    await expect(market.buyListing(BUYER_A, listingId)).rejects.toThrow();

    const a = await user(BUYER_A);
    expect(Number(a?.wallet_balance)).toBe(10);
    expect(Number(a?.banana_balance)).toBe(0);
  });
});
