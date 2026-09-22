/**
 * A wheel prize is a real order, at nothing, and the shop's loss is recorded.
 *
 * «عند فوز المستخدم بلعبة معينة يتم عمل طلب لا مباشرة، وتكون على الإدمن ربح
 * صفر دينار وبالسالب، ويكون على المستخدم سعرها صفر دينار ويعلم عليها انها
 * الهديه».
 *
 * Three properties, and the third is the one a test has to hold hardest.
 *
 * The member pays nothing — zero price, zero total, nothing owing.
 *
 * The shop's profit is NEGATIVE and says so. `unitCost` carries the real
 * supplier cost, read from the catalogue on the server. A gift recording no
 * cost against no revenue reports a profit of zero, which is a prettier
 * number than the truth and the wrong number for deciding what the wheel's
 * odds should be. This is the one that would have been easy to get wrong in
 * the direction that flatters the shop.
 *
 * And it is marked as a gift, on the order itself, so every screen can say so.
 */
import { describe, expect, it, vi } from "vitest";

const saved: { orders: any[]; threads: any[] } = { orders: [], threads: [] };

vi.mock("./db.server", () => ({
  randomId: (prefix: string) => `${prefix}_test${saved.orders.length}`,
  saveOrder: async (order: any) => {
    saved.orders.push(order);
    return order;
  },
  saveThread: async (thread: any) => {
    saved.threads.push(thread);
    return thread;
  },
  findUserById: async () => ({ id: "usr-1", name: "لاعب" }),
  getStore: async () => ({
    products: [
      {
        id: "p-zelda",
        title: "Zelda",
        kind: "game",
        image: "https://cdn.example/zelda.jpg",
        price: 12_000,
        cost: 2_000,
      },
      { id: "p-nocost", title: "No cost recorded", kind: "game", price: 5_000 },
    ],
  }),
}));

vi.mock("./order-delivery-items.server", () => ({
  ensureOrderDeliveryRecords: async () => undefined,
}));

const { createWheelGiftOrder, WHEEL_GIFT_SOURCE } = await import("./wheel-gift-order.server");

const award = (over: Record<string, unknown> = {}) =>
  createWheelGiftOrder({
    userId: "usr-1",
    productId: "p-zelda",
    title: "Zelda",
    price: 12_000,
    spinId: "spin_1",
    now: "2026-09-22T10:00:00.000Z",
    ...over,
  } as never);

const lastOrder = () => saved.orders.at(-1);

describe("what the member gets", () => {
  it("is an order they owe nothing on", async () => {
    saved.orders = [];
    saved.threads = [];
    const result = await award();
    expect(result).not.toBeNull();

    const order = lastOrder();
    expect(order.total).toBe(0);
    expect(order.items[0].unitPrice).toBe(0);
    expect(order.items[0].quantity).toBe(1);
    // Settled, because there is nothing to settle. An order at zero left
    // awaiting payment asks for money the shop is not owed.
    expect(order.paymentStatus).toBe("paid");
    expect(order.status).toBe("processing");
    expect(order.needsAddress).toBe(false);
  });

  it("is marked as a gift, in a way every screen can read", async () => {
    saved.orders = [];
    await award();
    expect(lastOrder().isGift).toBe(true);
    expect(lastOrder().source).toBe(WHEEL_GIFT_SOURCE);
  });

  it("is told apart from a sale by its code", async () => {
    saved.orders = [];
    await award();
    // A gift and a sale of the same game on one evening are not two identical rows.
    expect(String(lastOrder().code)).toMatch(/^BN-G-/);
  });

  it("carries a conversation, so it can be prepared like any order", async () => {
    saved.orders = [];
    saved.threads = [];
    const result = await award();
    expect(lastOrder().threadId).toBe(result!.threadId);
    expect(saved.threads.at(-1).orderId).toBe(result!.orderId);
    expect(saved.threads.at(-1).mode).toBe("ORDER_PREPARATION");
  });
});

describe("what the shop records", () => {
  it("records the REAL cost, so the profit on a gift is negative", async () => {
    saved.orders = [];
    await award();
    const item = lastOrder().items[0];

    expect(item.unitCost).toBe(2_000);
    // Revenue zero, cost 2,000 — a loss of 2,000, which is the truth.
    const profit = item.unitPrice * item.quantity - item.unitCost * item.quantity;
    expect(profit).toBe(-2_000);
    expect(profit).toBeLessThan(0);
  });

  it("does not invent a cost for a product that has none recorded", async () => {
    saved.orders = [];
    await award({ productId: "p-nocost", title: "No cost recorded", price: 5_000 });
    // Zero because the catalogue says zero — not because a gift is free.
    expect(lastOrder().items[0].unitCost).toBe(0);
  });

  it("keeps what the prize was worth, without charging it", async () => {
    saved.orders = [];
    await award();
    expect(lastOrder().items[0].meta.giftValue).toBe(12_000);
    expect(lastOrder().items[0].unitPrice).toBe(0);
  });

  it("links the order back to the spin that won it", async () => {
    saved.orders = [];
    await award();
    expect(lastOrder().items[0].meta.wheelSpinId).toBe("spin_1");
    expect(lastOrder().events[0].type).toBe("wheel_prize_awarded");
  });
});

describe("what it refuses", () => {
  it("awards nothing without a member or a product", async () => {
    saved.orders = [];
    expect(await award({ userId: "" })).toBeNull();
    expect(await award({ productId: "" })).toBeNull();
    expect(saved.orders).toHaveLength(0);
  });

  it("still awards a product the catalogue read cannot find, at zero cost", async () => {
    /*
      A prize the member has already been told they won must not vanish
      because the catalogue moved under it. The order is created with the
      wheel's own title and no cost, which is honest about what is known.
    */
    saved.orders = [];
    const result = await award({ productId: "p-gone", title: "Deleted Game" });
    expect(result).not.toBeNull();
    expect(lastOrder().items[0].title).toBe("Deleted Game");
    expect(lastOrder().items[0].unitCost).toBe(0);
    expect(lastOrder().total).toBe(0);
  });
});
