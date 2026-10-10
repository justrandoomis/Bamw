/**
 * @vitest-environment node
 */
/**
 * «اشتري ثلاثة ألعاب وأحصل على الرابعة مجانا ، حيث عندما يضع مستخدم أربعة
 *  ألعاب يعتمد على أرخص لعبة تكون مجانية في السله ، … ويمكن تفعيلها وتعطيلها
 *  من لوحة الإدارة»
 *
 * Two halves. The rule itself — which copy is free, and when — as the one pure
 * function the cart and the checkout share. And the checkout, driven for
 * real: the order a member is charged for is the one the rule describes, the
 * switch the admin set is the one that decides, and nothing that is not a
 * game is ever given away.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PROMOTIONS,
  countsAsGame,
  normalizePromotions,
  quoteBuy3Get1,
  withoutFreeUnits,
  type PromoLine,
} from "./promotions";

const ON = { enabled: true, repeat: true };
const ONCE = { enabled: true, repeat: false };

const game = (key: string, unitPrice: number, quantity = 1, kind = "game"): PromoLine => ({
  key,
  productId: `prd_${key}`,
  title: `Game ${key}`,
  kind,
  unitPrice,
  quantity,
});

describe("the rule", () => {
  it("is off until the admin turns it on", () => {
    expect(DEFAULT_PROMOTIONS.buy3get1.enabled).toBe(false);
    expect(normalizePromotions(undefined).buy3get1).toEqual({ enabled: false, repeat: true });
    expect(normalizePromotions({ buy3get1: { enabled: "yes" } }).buy3get1.enabled).toBe(false);
    const quote = quoteBuy3Get1(
      [game("a", 10), game("b", 20), game("c", 30), game("d", 40)],
      DEFAULT_PROMOTIONS.buy3get1,
    );
    expect(quote).toMatchObject({ applied: false, discount: 0, free: [] });
  });

  it("gives nothing for three games, and says one more is needed", () => {
    const quote = quoteBuy3Get1([game("a", 10_000), game("b", 12_000), game("c", 9_000)], ON);
    expect(quote).toMatchObject({ applied: false, games: 3, discount: 0, toNext: 1 });
  });

  it("makes the cheapest of four games free", () => {
    const quote = quoteBuy3Get1(
      [game("a", 10_000), game("b", 12_000), game("c", 8_000), game("d", 15_000)],
      ON,
    );
    expect(quote.applied).toBe(true);
    expect(quote.discount).toBe(8_000);
    expect(quote.free.map((unit) => unit.key)).toEqual(["c"]);
  });

  it("counts copies one by one: four of the same game is four games", () => {
    const quote = quoteBuy3Get1([game("a", 9_000, 4)], ON);
    expect(quote).toMatchObject({ applied: true, games: 4, discount: 9_000 });
  });

  it("repeats for every four games — eight games, the two cheapest free", () => {
    const lines = [5, 6, 7, 8, 9, 10, 11, 12].map((n) => game(`g${n}`, n * 1000));
    const quote = quoteBuy3Get1(lines, ON);
    expect(quote.free.map((unit) => unit.unitPrice)).toEqual([5_000, 6_000]);
    expect(quote.discount).toBe(11_000);
    expect(quote.toNext).toBe(4);
  });

  it("gives one game per order when the admin turned repeating off", () => {
    const lines = [5, 6, 7, 8, 9, 10, 11, 12].map((n) => game(`g${n}`, n * 1000));
    const quote = quoteBuy3Get1(lines, ONCE);
    expect(quote.free).toHaveLength(1);
    expect(quote.discount).toBe(5_000);
    expect(quote.toNext).toBeNull();
  });

  it("counts only games — never a gift card, a bundle, or anything that ships", () => {
    for (const kind of [
      "gift_card",
      "digital_code",
      "code",
      "bundle",
      "hardware",
      "used",
      "accessory",
    ]) {
      expect(countsAsGame(kind), kind).toBe(false);
    }
    for (const kind of ["game", "account", "offline_account", "online_account", "preorder", ""]) {
      expect(countsAsGame(kind), kind || "(missing)").toBe(true);
    }
    const quote = quoteBuy3Get1(
      [
        game("a", 10_000),
        game("b", 10_000),
        game("c", 10_000),
        game("card", 5_000, 1, "gift_card"),
        game("box", 3_000, 1, "bundle"),
      ],
      ON,
    );
    expect(quote).toMatchObject({ applied: false, games: 3 });
  });

  it("picks the same copy every time two games cost the same", () => {
    const lines = [game("b", 7_000), game("a", 7_000), game("c", 9_000), game("d", 9_000)];
    expect(quoteBuy3Get1(lines, ON).free[0]!.key).toBe("a");
    expect(quoteBuy3Get1([...lines].reverse(), ON).free[0]!.key).toBe("a");
  });

  it("takes the free copies out of what a coupon or a referral is priced on", () => {
    const lines = [game("a", 9_000, 2), game("b", 12_000), game("c", 15_000)];
    const quote = quoteBuy3Get1(lines, ON);
    const paid = withoutFreeUnits(lines, (line) => line.key, quote);
    expect(paid.map((line) => [line.key, line.quantity])).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 1],
    ]);
  });
});

/* ─────────────────────────── the checkout ─────────────────────────── */

const catalogue: Record<string, unknown>[] = [];
let promotions: unknown = undefined;
const batches: { sql: string; params: unknown[] }[][] = [];

vi.mock("./db.server", () => ({
  getStore: vi.fn(async () => ({
    products: catalogue,
    bundles: [],
    settings: {},
    content: { promotions },
  })),
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
    return statements.map(() => ({ success: true, meta: { changes: 1 } }));
  }),
}));
vi.mock("./telegram.server", () => ({ sendTelegramMessage: vi.fn(async () => undefined) }));
vi.mock("./coupon-usage.server", () => ({
  claimCouponUse: vi.fn(async () => null),
  readCouponUsage: vi.fn(async () => null),
  releaseCouponUse: vi.fn(async () => undefined),
}));

const { createOrderForUser } = await import("./orders.server");

const buyer = {
  id: "usr_offer",
  name: "زبون",
  phone: "+9647700000000",
  walletBalance: 1_000_000,
} as never;

const listing = (id: string, price: number, kind = "game") => ({
  id,
  title: `Listing ${id}`,
  kind,
  price,
  stock: 99,
  isActive: true,
});

/** What the wallet was actually charged, read off the debit statement. */
function debited(): number {
  for (const batch of batches) {
    const debit = batch.find((statement) =>
      String(statement.sql).includes("UPDATE users SET wallet_balance = wallet_balance - ?"),
    );
    if (debit) return Number(debit.params[0]);
  }
  return NaN;
}

beforeEach(() => {
  catalogue.length = 0;
  batches.length = 0;
  promotions = undefined;
  catalogue.push(
    listing("p10", 10_000),
    listing("p12", 12_000),
    listing("p8", 8_000),
    listing("p15", 15_000),
    listing("card", 5_000, "gift_card"),
  );
});

const four = [
  { productId: "p10", quantity: 1 },
  { productId: "p12", quantity: 1 },
  { productId: "p8", quantity: 1 },
  { productId: "p15", quantity: 1 },
];

describe("the checkout", () => {
  it("charges four games at the price of three, the cheapest free, when the offer is on", async () => {
    promotions = { buy3get1: ON };
    const order = await createOrderForUser(buyer, four as never);
    expect(order.total).toBe(37_000);
    expect(order.discountAmount).toBe(8_000);
    expect(order.promotion).toEqual({
      id: "buy3get1",
      discountIqd: 8_000,
      freeItems: [{ productId: "p8", title: "Listing p8", unitPrice: 8_000 }],
    });
    expect(debited()).toBe(37_000);
  });

  it("charges the full price when the admin turned the offer off", async () => {
    promotions = { buy3get1: { enabled: false, repeat: true } };
    const order = await createOrderForUser(buyer, four as never);
    expect(order.total).toBe(45_000);
    expect(order.promotion).toBeUndefined();
    expect(debited()).toBe(45_000);
  });

  it("is off on a shop that never saved the switch", async () => {
    const order = await createOrderForUser(buyer, four as never);
    expect(order.total).toBe(45_000);
  });

  it("gives nothing away for three games and a gift card", async () => {
    promotions = { buy3get1: ON };
    const order = await createOrderForUser(buyer, [
      { productId: "p10", quantity: 1 },
      { productId: "p12", quantity: 1 },
      { productId: "p15", quantity: 1 },
      { productId: "card", quantity: 1 },
    ] as never);
    expect(order.total).toBe(42_000);
    expect(order.promotion).toBeUndefined();
  });

  it("frees the two cheapest of eight, and only one when it does not repeat", async () => {
    const eight = [
      { productId: "p10", quantity: 2 },
      { productId: "p12", quantity: 2 },
      { productId: "p8", quantity: 2 },
      { productId: "p15", quantity: 2 },
    ];
    promotions = { buy3get1: ON };
    const repeating = await createOrderForUser(buyer, eight as never);
    expect(repeating.discountAmount).toBe(16_000);
    expect(repeating.total).toBe(90_000 - 16_000);

    promotions = { buy3get1: ONCE };
    const once = await createOrderForUser(buyer, eight as never);
    expect(once.discountAmount).toBe(8_000);
    expect(once.total).toBe(90_000 - 8_000);
  });
});

describe("the cart previews it with the same function", () => {
  const cart = readFileSync(path.resolve(__dirname, "../routes/cart.tsx"), "utf8");

  it("prices the free game with the checkout's own rule", () => {
    expect(cart).toContain("quoteBuy3Get1(");
    expect(cart).toContain("promotions.buy3get1");
  });

  it("asks for the coupon and the referral on the copies still being paid for", () => {
    expect(cart).toContain("items: paidLines.map(couponItemFromLine)");
    expect(cart).toContain("orderAmount: paidSubtotal");
    expect(cart).toContain("<ReferralCartField lines={paidLines}");
  });
});
