/**
 * @vitest-environment node
 */
/**
 * A cart is a list of intentions, not a price list.
 *
 * A line sits in localStorage carrying the price it had on the day it was
 * added, and it survives restarts — so "that day" can be weeks ago. The order
 * must therefore be built from the catalogue as it stands at checkout, and
 * from the *selection* the buyer made, never from a number the browser kept.
 *
 * These drive `createOrderForUser` directly, because the only place a refusal
 * or a re-price counts is where the order is written.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/** The live catalogue. Tests mutate this between orders, as an admin would. */
const catalogue: Record<string, unknown>[] = [];

const saved: Record<string, unknown>[] = [];

vi.mock("./db.server", () => ({
  getStore: vi.fn(async () => ({ products: catalogue, bundles: [], settings: {} })),
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

const { createOrderForUser } = await import("./orders.server");

const buyer = {
  id: "usr_1",
  name: "زبون",
  phone: "+9647700000000",
  walletBalance: 1_000_000,
} as never;

function seed(product: Record<string, unknown>) {
  catalogue.length = 0;
  catalogue.push({
    id: "prd_1",
    title: "Super Mario Odyssey",
    kind: "account",
    stock: 99,
    isActive: true,
    ...product,
  });
}

beforeEach(() => {
  saved.length = 0;
  vi.clearAllMocks();
});

describe("a price that changed while the cart was open", () => {
  it("charges the new price, not the one the cart remembers", async () => {
    seed({ price: 10_000 });
    const before = await createOrderForUser(buyer, [{ productId: "prd_1", quantity: 1 }] as never);
    expect(before.items[0]!.unitPrice).toBe(10_000);
    expect(before.total).toBe(10_000);

    // The admin raises the price. The cart still holds the old one.
    seed({ price: 12_000 });
    const after = await createOrderForUser(buyer, [{ productId: "prd_1", quantity: 1 }] as never);

    expect(after.items[0]!.unitPrice).toBe(12_000);
    expect(after.total).toBe(12_000);
  });

  it("charges the lower price when one is reduced", async () => {
    seed({ price: 25_000 });
    await createOrderForUser(buyer, [{ productId: "prd_1", quantity: 1 }] as never);

    seed({ price: 18_000 });
    const order = await createOrderForUser(buyer, [{ productId: "prd_1", quantity: 1 }] as never);
    expect(order.items[0]!.unitPrice).toBe(18_000);
  });

  it("multiplies the current price by the quantity, not the old one", async () => {
    seed({ price: 12_000 });
    const order = await createOrderForUser(buyer, [{ productId: "prd_1", quantity: 3 }] as never);
    expect(order.total).toBe(36_000);
  });
});

describe("the option the buyer picked", () => {
  const WITH_OPTIONS = {
    price: 10_000,
    options: [
      { id: "offline_account", name: "حساب أوفلاين", price: 10_000 },
      { id: "online_account", name: "حساب أونلاين", price: 14_000 },
    ],
    types: [
      { id: "standard_offline", name: "أوفلاين عادي", optionId: "offline_account" },
      { id: "dlc_offline", name: "مع الإضافات", optionId: "offline_account", price: 12_500 },
    ],
  };

  it("is what decides the price, not the record's headline figure", async () => {
    seed(WITH_OPTIONS);
    const order = await createOrderForUser(buyer, [
      { productId: "prd_1", quantity: 1, optionId: "online_account" },
    ] as never);

    // This is the defect: the online account used to be charged at 10,000.
    expect(order.items[0]!.unitPrice).toBe(14_000);
    expect(order.total).toBe(14_000);
    expect((order.items[0]!.meta as Record<string, unknown>)["optionName"]).toBe("حساب أونلاين");
  });

  it("lets a priced type override its option", async () => {
    seed(WITH_OPTIONS);
    const order = await createOrderForUser(buyer, [
      { productId: "prd_1", quantity: 1, optionId: "offline_account", typeId: "dlc_offline" },
    ] as never);
    expect(order.items[0]!.unitPrice).toBe(12_500);
  });

  it("follows an option whose price changes, like any other price", async () => {
    seed(WITH_OPTIONS);
    const before = await createOrderForUser(buyer, [
      { productId: "prd_1", quantity: 1, optionId: "online_account" },
    ] as never);
    expect(before.items[0]!.unitPrice).toBe(14_000);

    seed({
      ...WITH_OPTIONS,
      options: [
        { id: "offline_account", name: "حساب أوفلاين", price: 10_000 },
        { id: "online_account", name: "حساب أونلاين", price: 16_500 },
      ],
    });
    const after = await createOrderForUser(buyer, [
      { productId: "prd_1", quantity: 1, optionId: "online_account" },
    ] as never);
    expect(after.items[0]!.unitPrice).toBe(16_500);
  });

  it("ignores an option id the record does not have", async () => {
    seed(WITH_OPTIONS);
    const order = await createOrderForUser(buyer, [
      { productId: "prd_1", quantity: 1, optionId: "forged_option" },
    ] as never);
    expect(order.items[0]!.unitPrice).toBe(10_000);
  });
});

describe("what the request may not decide", () => {
  it("cannot name its own price", async () => {
    seed({ price: 10_000 });
    const order = await createOrderForUser(buyer, [
      // Everything a tampered client might send alongside the line.
      { productId: "prd_1", quantity: 1, price: 1, unitPrice: 1, total: 1 },
    ] as never);

    expect(order.items[0]!.unitPrice).toBe(10_000);
    expect(order.total).toBe(10_000);
  });

  it("refuses a line whose product has left the catalogue", async () => {
    seed({ price: 10_000 });
    await expect(
      createOrderForUser(buyer, [{ productId: "prd_gone", quantity: 1 }] as never),
    ).rejects.toThrow("cart_empty");
  });

  it("refuses a product the admin has priced at zero", async () => {
    seed({ price: 0 });
    await expect(
      createOrderForUser(buyer, [{ productId: "prd_1", quantity: 1 }] as never),
    ).rejects.toThrow("cart_empty");
  });
});
