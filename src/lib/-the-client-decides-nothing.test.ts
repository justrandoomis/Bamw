/**
 * @vitest-environment node
 */
/**
 * What a browser can and cannot decide.
 *
 * «اعتبر كل بيانات Client غير موثوقة. المستخدم لا يستطيع تحديد: سعر الموز،
 *  رصيد الموز، سعر التذكرة، رصيد التذاكر، odds، popularity، game price،
 *  game ID الفائز، reward ID غير متاح، قيمة الجائزة، order total، gift status.»
 *
 * The strongest version of that guarantee is not a check — it is the ABSENCE
 * of a parameter. A function that never takes a price cannot be told one, and
 * no future edit can weaken a guard that was never written because it was
 * never needed.
 *
 * So these tests are in two halves, and the split is deliberate:
 *
 *  - where a value COULD be sent and must be ignored, the value is sent and
 *    the result is measured against the server's own number;
 *  - where the guarantee is that there is nothing to send, the request
 *    handlers are read and the absence is asserted. A behavioural test cannot
 *    prove a parameter does not exist; reading the source can, and it is the
 *    only claim here made that way.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__CLIENT_TEST_D1__"] = db;

vi.mock("./env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__CLIENT_TEST_D1__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

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
      directSellEnabled: true,
    }),
  };
});

let sell: typeof import("./banana-sell.server");

const USER = "usr_client";
const NOW = "2026-09-23T02:00:00.000Z";

beforeAll(async () => {
  const { ensureSchema } = await import("./d1.server");
  await ensureSchema();
  sell = await import("./banana-sell.server");
  await sell.ensureBananaSellSchema();
});

beforeEach(() => {
  for (const table of ["banana_direct_sales", "banana_transactions", "wallet_transactions", "users"]) {
    db.raw.exec(`DELETE FROM ${table}`);
  }
  db.reset();
  db.raw
    .prepare(
      `INSERT INTO users (id, name, email, banana_balance, banana_locked, wallet_balance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(USER, "Client", "client@example.test", 1_000_000, 0, 0, NOW);
});

const wallet = () =>
  Number(
    (db.raw.prepare(`SELECT wallet_balance FROM users WHERE id = ?`).get(USER) as
      | { wallet_balance?: number }
      | undefined)?.wallet_balance ?? 0,
  );

describe("a price sent by the browser changes nothing", () => {
  it("pays the server's price even when a better one is in the request", async () => {
    // «تعديل سعر الموز» — the tenth line of the owner's list.
    const honest = await sell.quoteSale(100_000, Date.parse(NOW));
    /*
      Built as a variable rather than written inline, because an object literal
      passed straight to a typed parameter is rejected by the compiler for
      having extra properties — and being unable to COMPILE the attack is not
      the same as the attack failing. A real request is JSON arriving over the
      wire, where no compiler is watching, so the test sends it the way the
      network would.
    */
    const tampered = {
      userId: USER,
      quantity: 100_000,
      requestId: "tamper_price",
      now: NOW,
      // Everything a hopeful browser might add. None of it is a parameter.
      pricePerBanana: 99,
      price: 99,
      proceeds: 9_999_999,
      walletBalance: 9_999_999,
    };
    const result = await sell.sellBananas(tampered);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pricePerBanana).toBe(honest.pricePerBanana);
    expect(result.proceeds).toBe(Math.floor(100_000 * honest.pricePerBanana));
    expect(wallet()).toBe(result.proceeds);
    expect(wallet()).toBeLessThan(1_000);
  });

  it("pays the server's price even when the request claims a bigger balance", async () => {
    // «رصيد الموز» — the balance is read, never accepted.
    const claimed = {
      userId: USER,
      quantity: 2_000_000,
      requestId: "tamper_balance",
      now: NOW,
      bananaBalance: 99_999_999,
      balance: 99_999_999,
    };
    const result = await sell.sellBananas(claimed);
    expect(result).toMatchObject({ ok: false, reason: "insufficient_bananas" });
    expect(wallet()).toBe(0);
  });
});

/**
 * The handlers, read.
 *
 * Every path below is a POST body reaching a server action. What matters is
 * which fields are taken OUT of it — so the file is read and the fields are
 * counted, which is a claim a rendered test cannot make.
 */
const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), "utf8");
const ROULETTE_API = read("../routes/api/roulette.ts");
const BANANA_API = read("../routes/api/banana.ts");
const WHEEL_API = read("../routes/api/wheel.ts");

describe("the roulette's request carries nothing that decides anything", () => {
  it("reads only a ticket count, a request id, a prize id and an action", () => {
    /*
      `sent[...]` is every field the handler takes out of the body. The list is
      asserted whole rather than one absence at a time, so a field ADDED later
      fails this test and has to be argued for.
    */
    const fields = [...ROULETTE_API.matchAll(/sent\["(\w+)"\]/g)].map((m) => m[1]);
    expect(new Set(fields)).toEqual(new Set(["action", "tickets", "requestId", "prizeId"]));
  });

  it("never takes a product, a price, a prize value or odds from the body", () => {
    for (const field of [
      "productId",
      "product_id",
      "price",
      "value",
      "odds",
      "probabilities",
      "bucket",
      "popularity",
      "won",
      "prize",
    ]) {
      expect(ROULETTE_API, field).not.toContain(`sent["${field}"]`);
    }
  });

  it("builds the pool and the odds on the server for every spin", () => {
    // Not passed in, not cached from a previous request, not trusted.
    expect(ROULETTE_API).toContain("const state = await buildState(tickets)");
    expect(ROULETTE_API).toContain("games: state.games");
  });
});

describe("the market's request carries no price", () => {
  it("takes only a quantity and a request id for a sale", () => {
    expect(BANANA_API).toContain('quantity: input["quantity"]');
    expect(BANANA_API).toContain('requestId: String(input["requestId"] ?? "")');
    for (const field of ["pricePerBanana", "proceeds", "spot", "balance"]) {
      expect(BANANA_API, field).not.toContain(`input["${field}"]`);
    }
  });

  it("refuses to let a member create a listing at any price at all", () => {
    // The whole surface where a client-chosen price used to exist.
    expect(BANANA_API).toContain('action === "create_listing" || action === "update_listing"');
    expect(BANANA_API).not.toContain('pricePer: Number(input["pricePer"])');
  });
});

describe("the ticket price is the shop's", () => {
  it("is never read from the purchase request", () => {
    /*
      «تعديل سعر التذكرة من DevTools».

      Asserted as the whole set rather than one absence at a time, for the same
      reason as the roulette's: a field added later has to come back here and
      be argued for. A purchase says how many tickets and which press it is —
      never what they cost.
    */
    expect(WHEEL_API).toContain('=== "buy_ticket"');
    const fields = [...WHEEL_API.matchAll(/sent\["(\w+)"\]/g)].map((m) => m[1]);
    expect(new Set(fields)).toEqual(new Set(["action", "quantity", "requestId"]));
    for (const field of ["ticketPriceBananas", "price", "cost", "total"]) {
      expect(WHEEL_API, field).not.toContain(`sent["${field}"]`);
    }
  });

  it("is read from the saved settings inside the purchase itself", () => {
    const wheel = read("./wheel.server.ts");
    expect(wheel).toContain("const odds = await getWheelOdds();");
    expect(wheel).toContain("const price = Math.floor(Number(odds.ticketPriceBananas));");
  });
});

describe("a gift order cannot be asked for directly", () => {
  it("is only ever created from a prize the server looked up", () => {
    /*
      «إنشاء Gift order يدوياً» — there is no endpoint for it. The only caller
      of `createWheelGiftOrder` outside the wheel's own spin is the import, and
      the import reads the product off the stored prize row rather than taking
      one.
    */
    const importer = read("./roulette-import.server.ts");
    expect(importer).toContain("productId: before.productId");
    expect(importer).not.toContain("input.productId");
    expect(importer).not.toContain("input.price");

    // And the route hands it a prize id and nothing else.
    expect(ROULETTE_API).toContain('prizeId: String(sent["prizeId"] ?? "")');
  });

  it("marks what it creates as a gift, so no screen has to infer it", () => {
    const gift = read("./wheel-gift-order.server.ts");
    expect(gift).toContain("isGift: true");
    expect(gift).toContain("source: WHEEL_GIFT_SOURCE");
    expect(gift).toContain("total: 0");
  });
});
