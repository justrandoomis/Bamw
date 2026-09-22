/**
 * @vitest-environment node
 * THROWAWAY PROBE - delete after running.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const catalogue: Record<string, unknown>[] = [];
const batches: { sql: string; params: unknown[] }[][] = [];
let batchChanges = 1;
const deliveryCalls: string[] = [];

vi.mock("./db.server", () => ({
  getStore: vi.fn(async () => ({ products: catalogue, bundles: [], settings: {} })),
  findUserById: vi.fn(async () => null),
  saveOrder: vi.fn(async (order: Record<string, unknown>) => order),
  saveThread: vi.fn(async () => undefined),
  appendMessage: vi.fn(async () => undefined),
  createAuditLog: vi.fn(async () => undefined),
  getOrder: vi.fn(async () => undefined),
  d1Run: vi.fn(async () => undefined),
  d1First: vi.fn(async () => undefined),
  d1All: vi.fn(async () => []),
  d1Batch: vi.fn(async (statements: { sql: string; params: unknown[] }[]) => {
    batches.push(statements);
    return statements.map(() => ({ success: true, meta: { changes: batchChanges } }));
  }),
}));
vi.mock("./telegram.server", () => ({ sendTelegramMessage: vi.fn(async () => undefined) }));
vi.mock("./coupon-usage.server", () => ({
  claimCouponUse: vi.fn(async () => null),
  readCouponUsage: vi.fn(async () => null),
  releaseCouponUse: vi.fn(async () => undefined),
}));
vi.mock("./order-delivery-items.server", () => ({
  ensureOrderDeliveryRecords: vi.fn(async (order: { id: string }) => {
    deliveryCalls.push(order.id);
  }),
  ensureDigitalOrderQueueEntry: vi.fn(async () => false),
}));

const { createOrderForUser } = await import("./orders.server");

const buyer = {
  id: "usr_1",
  name: "زبون",
  phone: "+9647700000000",
  walletBalance: 1_000_000,
} as never;

beforeEach(() => {
  batches.length = 0;
  deliveryCalls.length = 0;
  batchChanges = 1;
  catalogue.length = 0;
  catalogue.push(
    { id: "game_1", title: "Digital Game", kind: "game", price: 30_000, stock: 99, isActive: true },
    { id: "acc_1", title: "Controller", kind: "accessory", price: 5_000, stock: 99, isActive: true },
  );
  vi.clearAllMocks();
});

describe("the claimed exploit: accessory + digital games checked out together", () => {
  it("still debits the wallet and writes the order paid", async () => {
    const order = await createOrderForUser(
      buyer,
      [
        { productId: "acc_1", quantity: 1 },
        { productId: "game_1", quantity: 2 },
      ] as never,
      { name: "x", phone: "+9647700000000", city: "بغداد", area: "a", details: "d" } as never,
    );
    // eslint-disable-next-line no-console
    console.log("PROBE order:", JSON.stringify({
      paymentStatus: order.paymentStatus,
      status: order.status,
      total: order.total,
      needsAddress: order.needsAddress,
      paymentReference: order.paymentReference,
    }));
    const debit = batches.flat().find((s) => s.sql.includes("UPDATE users SET wallet_balance"));
    // eslint-disable-next-line no-console
    console.log("PROBE debit:", JSON.stringify(debit));
    expect(debit).toBeTruthy();
    expect(order.paymentStatus).toBe("paid");
    expect(debit!.params[0]).toBe(order.total);
    expect(deliveryCalls).toEqual([order.id]);
  });

  it("creates no order and no delivery slots when the debit does not apply", async () => {
    batchChanges = 0;
    await expect(
      createOrderForUser(buyer, [
        { productId: "acc_1", quantity: 1 },
        { productId: "game_1", quantity: 2 },
      ] as never, { name: "x", phone: "+9647700000000", city: "بغداد", area: "a", details: "d" } as never),
    ).rejects.toThrow("insufficient_balance");
    // eslint-disable-next-line no-console
    console.log("PROBE deliveryCalls after failed debit:", JSON.stringify(deliveryCalls));
    expect(deliveryCalls).toEqual([]);
  });
});
