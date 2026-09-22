/**
 * @vitest-environment node
 */
/**
 * «تأكد من الأمان وأن لا يصير هناك غش أو استغلال ... من حيث خصم الموز وتأكد من
 * رصيد الموز وسجل الموز».
 *
 * The worst thing in the banana market was not that it was dead. It was that
 * editing a listing did not require the listing to be live.
 *
 *   1. List N bananas. The balance falls by N, `banana_locked` rises by N.
 *   2. Cancel. The lock is released and the balance credited back — correctly
 *      — and the row survives at status 'cancelled' still saying quantity N.
 *   3. Edit that cancelled row down. `diff` is negative, so the difference is
 *      credited a SECOND time, from nothing, against bananas that are no
 *      longer locked against anything.
 *   4. Repeat for as long as you like.
 *
 * No race, no special account, no timing. One ordinary edit on a listing the
 * seller had already cancelled — in a shop holding 13.9 million bananas across
 * 60 wallets, with a wheel that turns them into free games.
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

beforeAll(async () => {
  const { ensureSchema } = await import("@/lib/d1.server");
  await ensureSchema();
  market = await import("./banana.server");
});

async function balance(): Promise<number> {
  const { d1First } = await import("@/lib/d1.server");
  const row = await d1First<{ banana_balance: number; banana_locked: number }>(
    `SELECT COALESCE(banana_balance, 0) AS banana_balance, COALESCE(banana_locked, 0) AS banana_locked
     FROM users WHERE id = ?`,
    SELLER,
  );
  return Number(row?.banana_balance ?? 0);
}

async function locked(): Promise<number> {
  const { d1First } = await import("@/lib/d1.server");
  const row = await d1First<{ banana_locked: number }>(
    `SELECT COALESCE(banana_locked, 0) AS banana_locked FROM users WHERE id = ?`,
    SELLER,
  );
  return Number(row?.banana_locked ?? 0);
}

beforeEach(async () => {
  const { d1Run } = await import("@/lib/d1.server");
  await d1Run(`DELETE FROM banana_market_offers`);
  await d1Run(`DELETE FROM users WHERE id = ?`, SELLER);
  await d1Run(
    `INSERT INTO users (id, name, email, created_at, banana_balance, banana_locked)
     VALUES (?, ?, ?, ?, ?, 0)`,
    SELLER,
    "Seller",
    "seller@example.test",
    "2026-01-01T00:00:00.000Z",
    100_000,
  );
});

describe("the printer", () => {
  it("does not credit a cancelled listing a second time", async () => {
    const opening = await balance();

    const created = await market.createListing(SELLER, { quantity: 10_000, pricePer: 0.2 });
    expect(created.success).toBe(true);
    expect(await balance()).toBe(opening - 10_000);
    expect(await locked()).toBe(10_000);

    await market.cancelListing(SELLER, created.id);
    // Cancelling is correct on its own: the bananas come back and the lock goes.
    expect(await balance()).toBe(opening);
    expect(await locked()).toBe(0);

    // The exploit: shrink the listing that was already cancelled.
    await expect(
      market.updateListing(SELLER, { id: created.id, quantity: 100, pricePer: 0.2 }),
    ).rejects.toThrow();

    expect(await balance()).toBe(opening);
    expect(await locked()).toBe(0);
  });

  it("does not print on a second run of the same cycle", async () => {
    const opening = await balance();
    for (let round = 0; round < 3; round += 1) {
      const created = await market.createListing(SELLER, { quantity: 5_000, pricePer: 0.2 });
      await market.cancelListing(SELLER, created.id);
      await market
        .updateListing(SELLER, { id: created.id, quantity: 100, pricePer: 0.2 })
        .catch(() => undefined);
    }
    expect(await balance()).toBe(opening);
    expect(await locked()).toBe(0);
  });
});

describe("editing a listing that IS active", () => {
  it("still works, and moves exactly the difference", async () => {
    const opening = await balance();
    const created = await market.createListing(SELLER, { quantity: 10_000, pricePer: 0.2 });

    await market.updateListing(SELLER, { id: created.id, quantity: 4_000, pricePer: 0.2 });
    expect(await balance()).toBe(opening - 4_000);
    expect(await locked()).toBe(4_000);

    await market.updateListing(SELLER, { id: created.id, quantity: 9_000, pricePer: 0.2 });
    expect(await balance()).toBe(opening - 9_000);
    expect(await locked()).toBe(9_000);
  });

  it("refuses to grow a listing past the seller's balance, and takes nothing", async () => {
    const opening = await balance();
    const created = await market.createListing(SELLER, { quantity: 1_000, pricePer: 0.2 });

    await expect(
      market.updateListing(SELLER, { id: created.id, quantity: 1_000_000, pricePer: 0.2 }),
    ).rejects.toThrow();

    expect(await balance()).toBe(opening - 1_000);
    expect(await locked()).toBe(1_000);
  });

  it("refuses another member's listing", async () => {
    const created = await market.createListing(SELLER, { quantity: 1_000, pricePer: 0.2 });
    await expect(
      market.updateListing("usr_someone_else", { id: created.id, quantity: 500, pricePer: 0.2 }),
    ).rejects.toThrow();
  });
});

describe("two listings in the same millisecond", () => {
  it("both exist, and neither member is quietly made poorer", async () => {
    /*
      The id was `bmo_${Date.now()}`. Two listings inside one millisecond got
      the same one, and the collision lands AFTER the bananas have been
      debited — so the INSERT fails and the member is simply poorer, with no
      listing to show for it. A double-tapped publish button is inside one
      millisecond often enough; this test hit it creating three in a loop.
    */
    const opening = await balance();
    const ids = await Promise.all([
      market.createListing(SELLER, { quantity: 1_000, pricePer: 0.2 }),
      market.createListing(SELLER, { quantity: 1_000, pricePer: 0.2 }),
      market.createListing(SELLER, { quantity: 1_000, pricePer: 0.2 }),
    ]);

    expect(new Set(ids.map((r) => r.id)).size).toBe(3);
    expect(await balance()).toBe(opening - 3_000);
    expect(await locked()).toBe(3_000);
  });
});

describe("cancelling twice, and cancelling around an edit", () => {
  it("refunds one listing once, however many cancels arrive together", async () => {
    /*
      Cancelling read the row, then wrote it, with a gap in between. Both of
      two cancels arriving together passed the read, and each went on to
      release the lock and credit the quantity — one listing, paid twice.
      `updateListing` was given a claim when it was found to be printing;
      cancelling had the same shape and the same consequence.
    */
    const opening = await balance();
    const created = await market.createListing(SELLER, { quantity: 8_000, pricePer: 0.2 });
    expect(await balance()).toBe(opening - 8_000);

    const settled = await Promise.allSettled([
      market.cancelListing(SELLER, created.id),
      market.cancelListing(SELLER, created.id),
      market.cancelListing(SELLER, created.id),
    ]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    expect(await balance()).toBe(opening);
    expect(await locked()).toBe(0);
  });

  it("does not refund a figure an edit has already given back", async () => {
    /*
      The claim guarded status but not quantity. A cancel that read 8,000, and
      a shrink to 1,000 that landed in between, each refunded what they held:
      7,000 from the edit and 8,000 from the cancel, for a listing of 8,000.
      The claim now names the quantity it read, so whichever lands second is
      told the listing moved and moves nothing.
    */
    const opening = await balance();
    const created = await market.createListing(SELLER, { quantity: 8_000, pricePer: 0.2 });

    await Promise.allSettled([
      market.cancelListing(SELLER, created.id),
      market.updateListing(SELLER, { id: created.id, quantity: 1_000, pricePer: 0.2 }),
    ]);

    // Either order is legitimate; neither may hand back more than was taken.
    expect(await balance()).toBeLessThanOrEqual(opening);
    const remaining = opening - (await balance());
    expect(await locked()).toBe(remaining);
  });

  it("refuses a cancel from someone who does not own the listing", async () => {
    const opening = await balance();
    const created = await market.createListing(SELLER, { quantity: 2_000, pricePer: 0.2 });
    await expect(market.cancelListing("usr_someone_else", created.id)).rejects.toThrow();
    expect(await balance()).toBe(opening - 2_000);
    expect(await locked()).toBe(2_000);
  });
});
