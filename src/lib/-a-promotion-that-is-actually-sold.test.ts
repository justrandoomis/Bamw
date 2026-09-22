/**
 * @vitest-environment node
 */
/**
 * «عرض خاص» and «تمييز العرض» are sold, not just quoted.
 *
 * Both have been on the listing form the whole time: two checkboxes, a duration
 * picker, a price in bananas computed from the shop's own rate, and a publish
 * button that refuses when the seller cannot afford it. `createListing` took all
 * three fields and its INSERT named none of them, because the columns did not
 * exist.
 *
 * So: nothing was charged, nothing was stored, and `getSnapshot` hardcoded both
 * flags false — a seller who ticked «خاص» watched their own listing come back
 * labelled «عام». The shop contradicting a member about what they had just
 * done, which is the same class of fault as a card showing one price and the
 * till charging another.
 *
 * Run against the real schema rather than asserted from the source, because the
 * whole failure was a column that was not there.
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

const SELLER = "usr_promo_seller";
const OTHER = "usr_promo_other";

beforeAll(async () => {
  const { ensureSchema } = await import("@/lib/d1.server");
  await ensureSchema();
  market = await import("./banana.server");
});

async function bananas(id: string): Promise<{ balance: number; locked: number }> {
  const { d1First } = await import("@/lib/d1.server");
  const row = await d1First<{ banana_balance: number; banana_locked: number }>(
    `SELECT COALESCE(banana_balance, 0) AS banana_balance,
            COALESCE(banana_locked, 0) AS banana_locked
     FROM users WHERE id = ?`,
    id,
  );
  return { balance: Number(row?.banana_balance ?? 0), locked: Number(row?.banana_locked ?? 0) };
}

async function makeUser(id: string, balance: number) {
  const { d1Run } = await import("@/lib/d1.server");
  await d1Run(`DELETE FROM users WHERE id = ?`, id);
  await d1Run(
    `INSERT INTO users (id, name, email, created_at, wallet_balance, banana_balance, banana_locked)
     VALUES (?, ?, ?, ?, 0, ?, 0)`,
    id,
    id,
    `${id}@example.test`,
    "2026-01-01T00:00:00.000Z",
    balance,
  );
}

beforeEach(async () => {
  const { d1Run } = await import("@/lib/d1.server");
  await d1Run(`DELETE FROM banana_market_offers`);
  await makeUser(SELLER, 200_000);
  await makeUser(OTHER, 200_000);
});

async function offerRow(id: string) {
  const { d1First } = await import("@/lib/d1.server");
  return d1First<{
    is_private: number;
    is_promoted: number;
    promoted_until: string | null;
    locked_banana: number;
  }>(
    `SELECT is_private, is_promoted, promoted_until, locked_banana
     FROM banana_market_offers WHERE id = ?`,
    id,
  );
}

describe("the columns exist and carry the seller's choice", () => {
  it("stores a private listing as private", async () => {
    const made = await market.createListing(SELLER, {
      quantity: 10_000,
      pricePer: 0.2,
      isPrivate: true,
    });
    const row = await offerRow(String((made as { id?: string })?.id));
    expect(row?.is_private).toBe(1);
    expect(row?.is_promoted).toBe(0);
  });

  it("stores a promotion with the moment it runs out", async () => {
    const made = await market.createListing(SELLER, {
      quantity: 10_000,
      pricePer: 0.2,
      isPromoted: true,
      promoteMinutes: 180,
    });
    const row = await offerRow(String((made as { id?: string })?.id));
    expect(row?.is_promoted).toBe(1);
    expect(row?.promoted_until).toBeTruthy();
    expect(new Date(String(row?.promoted_until)).getTime()).toBeGreaterThan(Date.now());
  });

  it("defaults an ordinary listing to neither", async () => {
    const made = await market.createListing(SELLER, { quantity: 10_000, pricePer: 0.2 });
    const row = await offerRow(String((made as { id?: string })?.id));
    expect(row?.is_private).toBe(0);
    expect(row?.is_promoted).toBe(0);
    expect(row?.promoted_until).toBeNull();
  });
});

describe("the promotion is paid for", () => {
  it("charges the listed bananas plus the promotion, in one debit", async () => {
    const before = await bananas(SELLER);
    await market.createListing(SELLER, {
      quantity: 10_000,
      pricePer: 0.2,
      isPromoted: true,
      promoteMinutes: 180,
    });
    const after = await bananas(SELLER);
    // 180 minutes at the default rate of 2 bananas a minute.
    expect(before.balance - after.balance).toBe(10_000 + 360);
  });

  /*
    The promotion buys placement; it does not come back. Only the listed
    bananas are held, so cancelling returns those and not the fee.
  */
  it("locks only the listed bananas, never the fee", async () => {
    const made = await market.createListing(SELLER, {
      quantity: 10_000,
      pricePer: 0.2,
      isPromoted: true,
      promoteMinutes: 180,
    });
    const row = await offerRow(String((made as { id?: string })?.id));
    expect(row?.locked_banana).toBe(10_000);
    expect((await bananas(SELLER)).locked).toBe(10_000);
  });

  it("charges nothing extra when the promotion is not asked for", async () => {
    const before = await bananas(SELLER);
    await market.createListing(SELLER, { quantity: 10_000, pricePer: 0.2, isPrivate: true });
    expect(before.balance - (await bananas(SELLER)).balance).toBe(10_000);
  });

  /*
    The rate is the shop's, never the request's. A browser that sends minutes is
    sending a duration, not a price.
  */
  it("ignores a promotion flag with no minutes behind it", async () => {
    const before = await bananas(SELLER);
    await market.createListing(SELLER, {
      quantity: 10_000,
      pricePer: 0.2,
      isPromoted: true,
      promoteMinutes: 0,
    });
    expect(before.balance - (await bananas(SELLER)).balance).toBe(10_000);
  });

  it("refuses the whole listing when the seller cannot afford the promotion", async () => {
    await makeUser(SELLER, 10_100);
    await expect(
      market.createListing(SELLER, {
        quantity: 10_000,
        pricePer: 0.2,
        isPromoted: true,
        promoteMinutes: 180,
      }),
    ).rejects.toThrow();

    // And nothing was half-done: no bananas taken, no row left behind.
    const after = await bananas(SELLER);
    expect(after.balance).toBe(10_100);
    expect(after.locked).toBe(0);
    const { d1First } = await import("@/lib/d1.server");
    const count = await d1First<{ n: number }>(
      `SELECT COUNT(*) AS n FROM banana_market_offers WHERE user_id = ?`,
      SELLER,
    );
    expect(Number(count?.n)).toBe(0);
  });
});

describe("what the board shows", () => {
  it("keeps a private listing off the public board, and on its seller's", async () => {
    await market.createListing(SELLER, { quantity: 10_000, pricePer: 0.2, isPrivate: true });

    const toEveryoneElse = await market.getSnapshot(OTHER, "1D");
    expect(toEveryoneElse.listings.some((l) => l.userId === SELLER)).toBe(false);

    const toItsSeller = await market.getSnapshot(SELLER, "1D");
    expect(toItsSeller.myListings.some((l) => l.isPrivate)).toBe(true);
  });

  it("tells the seller their listing is private, instead of calling it public", async () => {
    await market.createListing(SELLER, { quantity: 10_000, pricePer: 0.2, isPrivate: true });
    const mine = (await market.getSnapshot(SELLER, "1D")).myListings;
    expect(mine).toHaveLength(1);
    expect(mine[0]?.isPrivate).toBe(true);
  });

  /*
    A promoted listing leads — but a dearer one does not get to stay in front
    for ever, which is what an expiry that nothing checks would mean.
  */
  it("puts a live promotion in front of a cheaper ordinary listing", async () => {
    await market.createListing(OTHER, { quantity: 10_000, pricePer: 0.1 });
    await market.createListing(OTHER, {
      quantity: 10_000,
      pricePer: 0.9,
      isPromoted: true,
      promoteMinutes: 180,
    });

    const board = (await market.getSnapshot(SELLER, "1D")).listings.filter(
      (l) => l.userId === OTHER,
    );
    expect(board[0]?.isPromoted).toBe(true);
    expect(board[0]?.pricePer).toBeGreaterThan(Number(board[1]?.pricePer));
  });

  it("stops treating a promotion as live once its window has closed", async () => {
    const made = await market.createListing(OTHER, {
      quantity: 10_000,
      pricePer: 0.9,
      isPromoted: true,
      promoteMinutes: 180,
    });
    const { d1Run } = await import("@/lib/d1.server");
    await d1Run(
      `UPDATE banana_market_offers SET promoted_until = ? WHERE id = ?`,
      "2020-01-01T00:00:00.000Z",
      String((made as { id?: string })?.id),
    );

    const board = (await market.getSnapshot(SELLER, "1D")).listings.filter(
      (l) => l.userId === OTHER,
    );
    expect(board[0]?.isPromoted).toBe(false);
  });
});
