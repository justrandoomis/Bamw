/**
 * @vitest-environment node
 */
/**
 * Five features that can be put under maintenance, and every door to them
 * actually shut when they are.
 *
 *   «حاليا الروليت والموز وسوق الموز وخصم التقييم الالف دينار
 *    ( اجعلها تحت الصيانه )»
 *   «وقف ميزه استبدال الاقراص وجعلها تحت الصيانه»
 *
 * Then the banana half came back — «ارجاع ربح الموز / ارجاع الروليت / ارجاع
 * قسم الموز كاملا» — so the switch as it ships is pinned on its own, read from
 * the real module, and the doors are tested with every switch turned ON:
 * that is what each switch has to do the next time it is.
 *
 * A maintenance screen alone is a curtain — the endpoints behind it would go
 * on spinning, selling and minting for anyone who calls them. So these tests
 * call the endpoints, not the screens, and check two things for each: that
 * the door is shut, and that nothing moved behind it.
 *
 * And the other half, which matters as much: what maintenance must NOT take.
 * A prize already won can still be claimed, the banana snapshot the profile
 * reads still answers, a top-up code still credits its money, a review code
 * already issued is still returned, and a disc trade already submitted can
 * still be cancelled, accepted and settled.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

import { MAINTENANCE_COPY, maintenanceError, type MaintenanceFeature } from "./maintenance";

/*
  Every switch ON for the door tests; `everyDoorShut = false` reads the switch
  as it ships. The mock wraps the real module, so nothing else changes.
*/
let everyDoorShut = true;
vi.mock("./maintenance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./maintenance")>();
  return {
    ...actual,
    isUnderMaintenance: (feature: MaintenanceFeature) =>
      everyDoorShut || actual.isUnderMaintenance(feature),
  };
});

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__TEST_D1__"] = db;

const SECRETS: Record<string, string> = {
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
};

vi.mock("@/lib/env.server", () => ({
  env: (name: string) => SECRETS[name],
  getEnv: () => ({ ...SECRETS, bananto: (globalThis as Record<string, unknown>)["__TEST_D1__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

const MEMBER = {
  id: "usr_maint_member",
  name: "Member",
  username: "member",
  email: "member@example.test",
  isAdmin: false,
};

vi.mock("@/lib/session.server", () => ({
  requireUser: vi.fn(async () => MEMBER),
  getSessionUser: vi.fn(async () => MEMBER),
  requireAdmin: vi.fn(async () => {
    throw new Response("forbidden", { status: 403 });
  }),
}));

vi.mock("@/lib/rate-limit.server", () => ({
  consumeRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  rateLimitResponse: vi.fn(() => new Response("slow down", { status: 429 })),
}));

type Handler = (ctx: { request: Request }) => Promise<Response>;
type Handlers = { GET: Handler; POST: Handler };
const handlersOf = (route: { Route: { options: { server?: unknown } } }) =>
  (route.Route.options.server as { handlers: unknown }).handlers as Handlers;

let wheel: Handlers;
let roulette: Handlers;
let banana: Handlers;
let discTrade: Handlers;

beforeAll(async () => {
  const { ensureSchema } = await import("@/lib/d1.server");
  await ensureSchema();
  wheel = handlersOf(await import("@/routes/api/wheel"));
  roulette = handlersOf(await import("@/routes/api/roulette"));
  banana = handlersOf(await import("@/routes/api/banana"));
  discTrade = handlersOf(await import("@/routes/api/disc-trade"));
});

const post = async (handlers: Handlers, url: string, payload: unknown) => {
  const res = await handlers.POST({
    request: new Request(`https://banan.to${url}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
};

async function balances() {
  const { d1First } = await import("@/lib/d1.server");
  const row = await d1First<{ banana_balance: number; wallet_balance: number }>(
    `SELECT COALESCE(banana_balance, 0) AS banana_balance, COALESCE(wallet_balance, 0) AS wallet_balance
     FROM users WHERE id = ?`,
    MEMBER.id,
  );
  return { bananas: Number(row?.banana_balance ?? 0), wallet: Number(row?.wallet_balance ?? 0) };
}

beforeEach(async () => {
  const { d1Run } = await import("@/lib/d1.server");
  await d1Run(`DELETE FROM users WHERE id = ?`, MEMBER.id);
  await d1Run(
    `INSERT INTO users (id, name, email, created_at, wallet_balance, banana_balance, banana_locked)
     VALUES (?, ?, ?, ?, 0, 50000, 0)`,
    MEMBER.id,
    MEMBER.name,
    MEMBER.email,
    "2026-01-01T00:00:00.000Z",
  );
});

describe("the switch", () => {
  it("ships with the banana half open, and the review discount and disc trade-in closed", async () => {
    const actual = await vi.importActual<typeof import("./maintenance")>("./maintenance");
    expect(actual.UNDER_MAINTENANCE).toEqual({
      roulette: false,
      bananas: false,
      bananaMarket: false,
      reviewReward: true,
      discTrade: true,
    });
    for (const feature of Object.keys(actual.UNDER_MAINTENANCE) as MaintenanceFeature[]) {
      expect(actual.isUnderMaintenance(feature)).toBe(actual.UNDER_MAINTENANCE[feature]);
    }
  });

  it("refuses with the member's sentence and a code a client can branch on", () => {
    const refusal = maintenanceError("bananaMarket");
    expect(refusal.code).toBe("maintenance");
    expect(refusal.feature).toBe("bananaMarket");
    expect(refusal.error).toContain(MAINTENANCE_COPY.bananaMarket.title);
    expect(refusal.error).toContain("تحت الصيانة");
  });
});

describe("the roulette", () => {
  it("sells no ticket, and the bananas stay where they were", async () => {
    const before = await balances();
    const res = await post(wheel, "/api/wheel", { action: "buy_ticket", quantity: 2, requestId: "t1" });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: "maintenance", feature: "roulette" });
    expect(await balances()).toEqual(before);
  });

  it("takes no spin on either route — the old wheel or the roulette", async () => {
    expect((await post(wheel, "/api/wheel", {})).status).toBe(503);
    const spin = await post(roulette, "/api/roulette", { action: "spin", tickets: 1, requestId: "s1" });
    expect(spin.status).toBe(503);
    expect(spin.body).toMatchObject({ code: "maintenance", feature: "roulette" });
  });

  it("still lets a member claim a prize they already won", async () => {
    /*
      A prize id that does not exist reaches the importer and is answered
      `not_found` — which is the proof that maintenance did not stop it at
      the door. A real prize would be imported the same way.
    */
    const claim = await post(roulette, "/api/roulette", { action: "import_prize", prizeId: "nope" });
    expect(claim.status).not.toBe(503);
    expect(claim.body["code"]).not.toBe("maintenance");
  });
});

describe("the bananas and the market", () => {
  it.each(["sell_bananas", "buy_listing", "cancel_listing"])(
    "refuses %s as the market under maintenance",
    async (action) => {
      const before = await balances();
      const res = await post(banana, "/api/banana", { action, quantity: 100, id: "x", requestId: "r1" });
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: "maintenance", feature: "bananaMarket" });
      expect(await balances()).toEqual(before);
    },
  );

  it("refuses redeeming a reward as the bananas under maintenance", async () => {
    const res = await post(banana, "/api/banana", { action: "redeem_reward", rewardId: "x" });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: "maintenance", feature: "bananas" });
  });

  it("still answers an action it does not know as unknown, not as maintenance", async () => {
    const res = await post(banana, "/api/banana", { action: "something_else" });
    expect(res.status).toBe(400);
  });

  it("keeps the snapshot the profile reads to know which themes are unlocked", async () => {
    const res = await banana.GET({ request: new Request("https://banan.to/api/banana?range=1D") });
    expect(res.status).toBe(200);
  });

  it("still credits a top-up code's money, and pauses only its banana bonus", async () => {
    const { createBananCode, consumeBananCode } = await import("@/lib/db.server");
    const code = await createBananCode(10_000);
    const before = await balances();
    const used = await consumeBananCode(MEMBER.id, code.code);
    expect(used.success).toBe(true);
    const after = await balances();
    expect(after.wallet).toBe(before.wallet + 10_000);
    expect(after.bananas).toBe(before.bananas);
  });

  it("lets the market's bots trade nothing", async () => {
    const { processBotTrading } = await import("./scheduled-jobs.server");
    await expect(processBotTrading()).resolves.toBeUndefined();
    /*
      And the check is the FIRST thing the function does: the bots ignore
      `botsEnabled`, so nothing may run before maintenance is asked.
    */
    const source = readFileSync(path.resolve(__dirname, "scheduled-jobs.server.ts"), "utf8");
    const body = source.slice(source.indexOf("export async function processBotTrading()"));
    const firstStatement = body.slice(body.indexOf("{") + 1).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    expect(firstStatement.startsWith('if (isUnderMaintenance("bananaMarket")) return;')).toBe(true);
  });

  it("mints no bananas on a purchase while the bananas are under maintenance", () => {
    const source = readFileSync(path.resolve(__dirname, "orders.server.ts"), "utf8");
    expect(source).toMatch(
      /if \(bananaEligible && order\.paymentStatus === "paid" && !isUnderMaintenance\("bananas"\)\)/,
    );
  });
});

describe("the review discount", () => {
  it("mints no new code and spends nobody's week", async () => {
    const { issueApprovedReviewReward } = await import("./review-reward.server");
    const order = { id: "ord_maint_review", userId: MEMBER.id, code: "BN-1" } as never;
    const outcome = await issueApprovedReviewReward(order, { now: "2026-10-07T12:00:00.000Z" });
    expect(outcome).toEqual({ ok: false, reason: "maintenance" });

    const { d1First } = await import("@/lib/d1.server");
    const cooldown = await d1First<{ n: number }>(
      `SELECT COUNT(*) AS n FROM review_reward_cooldowns WHERE user_id = ?`,
      MEMBER.id,
    );
    expect(Number(cooldown?.n ?? 0)).toBe(0);
    const coupons = await d1First<{ n: number }>(
      `SELECT COUNT(*) AS n FROM coupons WHERE id = ?`,
      "cpn_review_ord_maint_review",
    ).catch(() => ({ n: 0 }));
    expect(Number(coupons?.n ?? 0)).toBe(0);
  });
});

describe("the disc trade-in", () => {
  async function tradeRows() {
    const { d1First } = await import("@/lib/d1.server");
    const row = await d1First<{ n: number }>(`SELECT COUNT(*) AS n FROM disc_trades`);
    return Number(row?.n ?? 0);
  }

  it.each([
    ["a quote", { action: "quote", game_name: "Mario Kart 8 Deluxe" }],
    ["a submission", { action: "submit", game_name: "Mario Kart 8 Deluxe", selections: {} }],
    ["a request with no action, which is a submission", { game_name: "Zelda" }],
  ])("refuses %s, and writes no trade", async (_what, payload) => {
    const before = await tradeRows();
    const res = await post(discTrade, "/api/disc-trade", payload);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: "maintenance", feature: "discTrade" });
    expect(await tradeRows()).toBe(before);
  });

  /*
    A trade id that does not exist reaches the handler and is answered 403
    «غير مسموح» — the proof that maintenance did not stop it at the door. A
    member's real trade would be cancelled or accepted the same way.
  */
  it.each(["cancel", "user_cancel", "accept", "accept_offer"])(
    "still lets a member %s a trade already submitted",
    async (action) => {
      const res = await post(discTrade, "/api/disc-trade", { action, trade_id: "trade_nope" });
      expect(res.status).not.toBe(503);
      expect(res.body["code"]).not.toBe("maintenance");
    },
  );

  it("still lets the admin settle a trade — the door is the admin check, not maintenance", async () => {
    const res = await post(discTrade, "/api/disc-trade", { action: "admin_update", trade_id: "x" });
    expect(res.status).toBe(403);
  });

  it("still shows a member their own trades", async () => {
    const res = await discTrade.GET({ request: new Request("https://banan.to/api/disc-trade") });
    expect(res.status).toBe(200);
  });
});

/*
  The same doors with the switch read as it ships: the banana half lets a
  member through — each answer is the feature's own, never «تحت الصيانة» —
  while the two features still closed stay shut.
*/
describe("as it ships", () => {
  beforeEach(() => {
    everyDoorShut = false;
  });
  afterEach(() => {
    everyDoorShut = true;
  });

  /*
    This database has no ticket price and no prize pool, so the roulette
    answers with its own reasons — which is the proof the request got past
    the maintenance door to the roulette itself.
  */
  it("lets a ticket purchase reach the roulette", async () => {
    const res = await post(wheel, "/api/wheel", {
      action: "buy_ticket",
      quantity: 1,
      requestId: "open-ticket-1",
    });
    expect(res.status).not.toBe(503);
    expect(res.body["code"]).not.toBe("maintenance");
    expect(String(res.body["error"])).toContain("سعر التذكرة");
  });

  it("lets a spin reach the roulette", async () => {
    const spin = await post(roulette, "/api/roulette", {
      action: "spin",
      tickets: 1,
      requestId: "open-spin-1",
    });
    expect(spin.status).not.toBe(503);
    expect(spin.body["code"]).toBe("empty_pool");
  });

  it("buys a member's bananas at the market price again", async () => {
    const before = await balances();
    const res = await post(banana, "/api/banana", {
      action: "sell_bananas",
      quantity: 100,
      requestId: "open-sell-1",
    });
    expect(res.status).toBe(200);
    expect((await balances()).bananas).toBe(before.bananas - 100);
  });

  it("lets a reward redemption reach the shelf", async () => {
    const res = await post(banana, "/api/banana", { action: "redeem_reward", rewardId: "x" });
    expect(res.status).not.toBe(503);
    expect(res.body["error"]).toBe("reward_not_found");
  });

  it("lets the market's bots run their round", async () => {
    const { processBotTrading } = await import("./scheduled-jobs.server");
    await expect(processBotTrading()).resolves.toBeUndefined();
  });

  it("still shuts disc trade-in and the review discount", async () => {
    const quote = await post(discTrade, "/api/disc-trade", {
      action: "quote",
      game_name: "Mario Kart 8 Deluxe",
    });
    expect(quote.status).toBe(503);
    const { issueApprovedReviewReward } = await import("./review-reward.server");
    const outcome = await issueApprovedReviewReward(
      { id: "ord_ships_review", userId: MEMBER.id, code: "BN-2" } as never,
      { now: "2026-10-07T12:00:00.000Z" },
    );
    expect(outcome).toEqual({ ok: false, reason: "maintenance" });
  });
});
