/**
 * @vitest-environment node
 */
/**
 * A game that is not out yet cannot be bought — proven at the order, not at
 * the button.
 *
 * The storefront can be told not to draw a buy button, but the cart is client
 * state and a checkout request is just a list of product ids. The only place a
 * refusal counts is where the order is built, which is why the gate lives in
 * `validateLine` and why this test drives `createOrderForUser` directly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const products = [
  {
    id: "prd_xeno3",
    title: "Xenoblade Chronicles 3 – Nintendo Switch 2 Edition",
    price: 12500,
    kind: "account",
    stock: 99,
    releaseDate: "2099-12-03",
  },
  {
    id: "prd_odyssey",
    title: "Super Mario Odyssey",
    price: 25000,
    kind: "account",
    stock: 99,
    releaseDate: "2017-10-27",
  },
  // The catalogue is full of these: no release date at all. They must keep
  // selling — refusing them would take the whole shop offline.
  { id: "prd_giftcard", title: "بطاقة نينتندو", price: 15000, kind: "digital_code", stock: 99 },
  { id: "prd_tba", title: "لعبة قادمة", price: 20000, kind: "account", stock: 99, releaseDate: "TBA" },
];

const saved: Record<string, unknown>[] = [];

const bundles = [
  { id: "bnd_mixed", title: "حزمة الألعاب", price: 40000, isActive: true, gameIds: ["prd_odyssey", "prd_xeno3"] },
  { id: "bnd_ok", title: "حزمة متوفرة", price: 40000, isActive: true, gameIds: ["prd_odyssey"] },
];

vi.mock("./db.server", () => ({
  getStore: vi.fn(async () => ({ products, bundles, settings: {} })),
  findUserById: vi.fn(async () => null),
  saveOrder: vi.fn(async (order: Record<string, unknown>) => {
    saved.push(order);
    return order;
  }),
  saveThread: vi.fn(async () => undefined),
  appendMessage: vi.fn(async () => undefined),
  createAuditLog: vi.fn(async () => undefined),
  getOrder: vi.fn(async () => undefined),
  d1Run: vi.fn(async () => undefined),
  d1First: vi.fn(async () => undefined),
  d1All: vi.fn(async () => []),
  // The wallet debit reads `meta.changes` to confirm the balance was taken;
  // a bare [] reads as "no rows changed" and every sale fails as unpaid.
  d1Batch: vi.fn(async (statements: unknown[]) =>
    (Array.isArray(statements) ? statements : [{}]).map(() => ({
      success: true,
      meta: { changes: 1 },
    })),
  ),
}));
vi.mock("./telegram.server", () => ({ sendTelegramMessage: vi.fn(async () => undefined) }));
vi.mock("./coupon-usage.server", () => ({
  claimCouponUse: vi.fn(async () => null),
  readCouponUsage: vi.fn(async () => null),
  releaseCouponUse: vi.fn(async () => undefined),
}));

const { AwaitingReleaseError, createOrderForUser } = await import("./orders.server");

const buyer = {
  id: "usr_9",
  name: "زبون",
  phone: "+9647700000000",
  walletBalance: 1_000_000,
} as never;

const buy = (productId: string) =>
  createOrderForUser(buyer, [{ productId, quantity: 1 }] as never);

beforeEach(() => {
  saved.length = 0;
  vi.clearAllMocks();
});

describe("ordering a game that has not been released", () => {
  it("is refused, and names the game and the date", async () => {
    await expect(buy("prd_xeno3")).rejects.toBeInstanceOf(AwaitingReleaseError);

    const error = await buy("prd_xeno3").then(
      () => null,
      (err: unknown) => err as InstanceType<typeof AwaitingReleaseError>,
    );
    expect(error).toBeInstanceOf(AwaitingReleaseError);
    expect(error!.productId).toBe("prd_xeno3");
    expect(error!.productTitle).toContain("Xenoblade");
    expect(error!.releaseDate).toBe("2099-12-03");
    // Nothing may be written: the refusal happens before the order exists.
    expect(saved).toHaveLength(0);
  });

  it("refuses it inside a mixed cart rather than quietly dropping the line", async () => {
    // Dropping it would charge for the rest and report nothing, which is how a
    // customer ends up paying for an order they did not agree to.
    await expect(
      createOrderForUser(
        buyer,
        [
          { productId: "prd_odyssey", quantity: 1 },
          { productId: "prd_xeno3", quantity: 1 },
        ] as never,
      ),
    ).rejects.toBeInstanceOf(AwaitingReleaseError);
    expect(saved).toHaveLength(0);
  });
});

describe("a bundle is only as available as the games in it", () => {
  it("refuses a bundle carrying a game that is not out", async () => {
    // The bundle branch returns before the product gate, so without its own
    // check this sells the unreleased game one indirection further out.
    const error = await buy("bnd_mixed").then(
      () => null,
      (err: unknown) => err as InstanceType<typeof AwaitingReleaseError>,
    );
    expect(error).toBeInstanceOf(AwaitingReleaseError);
    expect(error!.productId).toBe("prd_xeno3");
    expect(saved).toHaveLength(0);
  });

  it("sells a bundle whose games are all out", async () => {
    await expect(buy("bnd_ok")).resolves.toBeTruthy();
  });
});

describe("everything that is actually on sale", () => {
  it("sells a released game", async () => {
    await expect(buy("prd_odyssey")).resolves.toBeTruthy();
    expect(saved).toHaveLength(1);
  });

  it("sells a product with no release date at all", async () => {
    await expect(buy("prd_giftcard")).resolves.toBeTruthy();
  });

  it("sells a product whose date cannot be read", async () => {
    // "TBA" is not a date. Guessing would take a sellable product off the shelf.
    await expect(buy("prd_tba")).resolves.toBeTruthy();
  });
});
