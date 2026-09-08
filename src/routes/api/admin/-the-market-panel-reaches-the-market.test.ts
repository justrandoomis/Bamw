/**
 * @vitest-environment node
 */
/**
 * The Banana Market admin panel, connected to the market.
 *
 * The panel was built — six tabs, an economy engine, market-maker bots,
 * redemption rewards, wallets — and so was every server function behind it, in
 * `banana.server.ts`. Nothing joined them. This route answered three actions
 * about top-up codes, had no `GET` at all, and returned
 * `{"error":"Invalid action"}` to all ten of the actions the panel sends.
 *
 * So the owner saw a market with zero of everything while the shop had live
 * offers and real balances, and every button on the page did nothing. These
 * tests are that page's buttons, one per button.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__TEST_D1__"] = db;

const SECRETS: Record<string, string> = {
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
};

let admin: { id: string; isAdmin: boolean } | undefined = { id: "usr_admin", isAdmin: true };

vi.mock("@/lib/env.server", () => ({
  env: (name: string) => SECRETS[name],
  getEnv: () => ({ ...SECRETS, bananto: (globalThis as Record<string, unknown>)["__TEST_D1__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

vi.mock("@/lib/session.server", () => ({
  requireAdmin: vi.fn(async () => {
    if (!admin?.isAdmin) throw new Response("forbidden", { status: 403 });
    return admin;
  }),
}));

let route: typeof import("./banana");

beforeAll(async () => {
  const { ensureSchema } = await import("@/lib/d1.server");
  await ensureSchema();
  route = await import("./banana");
});

type Handler = (ctx: { request: Request }) => Promise<Response>;
const handlers = () =>
  route.Route.options.server!.handlers as unknown as { GET: Handler; POST: Handler };

const get = async () => {
  const res = await handlers().GET({ request: new Request("https://banan.to/api/admin/banana") });
  return { status: res.status, body: (await res.json()) as any };
};

const post = async (payload: unknown) => {
  const res = await handlers().POST({
    request: new Request("https://banan.to/api/admin/banana", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  });
  return { status: res.status, body: (await res.json()) as any };
};

const run = (sql: string, ...args: unknown[]) =>
  db
    .prepare(sql)
    .bind(...args)
    .run();

beforeEach(async () => {
  admin = { id: "usr_admin", isAdmin: true };
  for (const table of [
    "banana_market_offers",
    "banana_bots",
    "banana_redemption_offers",
    "banana_redemptions",
  ]) {
    await run(`DELETE FROM ${table}`);
  }
  await run(`DELETE FROM users`);
});

async function seedMember(id: string, balance: number, name = "زبون") {
  await run(
    `INSERT INTO users (id, name, email, username, banana_balance, banana_locked, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    id,
    name,
    `${id}@example.test`,
    id,
    balance,
    new Date().toISOString(),
  );
}

describe("what the six tabs read", () => {
  it("answers a GET at all — the panel's counters had nothing to read", async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.stats).toBeDefined();
    expect(body.marketConfig).toBeDefined();
    expect(body.settings).toBeDefined();
  });

  it("reports a live price rather than the zero the page fell back to", async () => {
    const { body } = await get();
    expect(body.livePrice).toBeGreaterThan(0);
  });

  it("counts the bananas the shop actually holds", async () => {
    await seedMember("usr_a", 375_215);
    await seedMember("usr_b", 1_000);
    const { body } = await get();
    expect(body.stats.circulatingBananas).toBe(376_215);
    expect(body.stats.userWalletsCount).toBe(2);
  });

  it("sees a live offer the customer side can see", async () => {
    await seedMember("usr_a", 500_000);
    await run(
      `INSERT INTO banana_market_offers
         (id, user_id, quantity, price_iqd, locked_banana, status, created_at, updated_at)
       VALUES ('off_1', 'usr_a', 430000, 50.005, 430000, 'active', ?, ?)`,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    const { body } = await get();
    expect(body.stats.activeListingsCount).toBe(1);
    expect(body.stats.activeListingsVolume).toBe(430_000);
    expect(body.listings).toHaveLength(1);
  });

  it("refuses anyone who is not an admin", async () => {
    admin = undefined;
    const res = await handlers()
      .GET({ request: new Request("https://banan.to/api/admin/banana") })
      .catch((e: Response) => e);
    expect((res as Response).status).toBe(403);
  });
});

describe("the engine settings the owner types", () => {
  it("saves, and comes back saved", async () => {
    const { body } = await post({
      action: "save_market_config",
      config: { basePrice: 0.31, minPrice: 0.05, maxPrice: 5, volatilityPercent: 6 },
    });
    expect(body.success).toBe(true);
    expect(body.marketConfig.basePrice).toBe(0.31);
    expect((await get()).body.marketConfig.basePrice).toBe(0.31);
  });

  it("refuses a floor above the ceiling instead of quietly repairing it", async () => {
    const { status, body } = await post({
      action: "save_market_config",
      config: { minPrice: 9, maxPrice: 1 },
    });
    expect(status).toBe(400);
    expect(body.error).toContain("أدنى سعر");
  });

  it("refuses a base price of zero — the value that emptied the market", async () => {
    const { status } = await post({ action: "save_market_config", config: { basePrice: 0 } });
    expect(status).toBe(400);
  });

  /*
    Read off production, not invented.

    banana-live read the live database through the Cloudflare API: a base of
    0.0004 inside a band of 0.0001 to 0.0003, against defaults of 0.24 / 0.1 /
    1. `spotPriceAt` clamps to the ceiling and rounds to three decimals, so
    0.0003 becomes 0.000 — the «موزة واحدة $0.00» every customer was shown.
    Two separate faults let that be saved, and both are checked here.
  */
  it("refuses a base price outside its own band — the comment promised this and the code did not", async () => {
    const { status, body } = await post({
      action: "save_market_config",
      config: { basePrice: 0.0004, minPrice: 0.0001, maxPrice: 0.0003 },
    });
    expect(status).toBe(400);
    expect(body.error).toContain("خارج حدوده");
  });

  it("refuses a band that rounds to nothing at the market's own precision", async () => {
    const { status, body } = await post({
      action: "save_market_config",
      config: { basePrice: 0.0002, minPrice: 0.0001, maxPrice: 0.0003 },
    });
    expect(status).toBe(400);
    expect(body.error).toContain("يُقرَّب إلى صفر");
    // The message names the smallest usable value rather than only refusing.
    expect(body.error).toContain("0.001");
  });

  it("accepts the smallest band that does price above zero", async () => {
    const { status, body } = await post({
      action: "save_market_config",
      config: { basePrice: 0.001, minPrice: 0.001, maxPrice: 0.002 },
    });
    expect(status).toBe(200);
    expect(body.marketConfig.basePrice).toBe(0.001);
  });

  it("still accepts a base sitting exactly on its floor or its ceiling", async () => {
    /* The bound check is inclusive: a base equal to either end is inside. */
    expect(
      (
        await post({
          action: "save_market_config",
          config: { basePrice: 0.05, minPrice: 0.05, maxPrice: 5 },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post({
          action: "save_market_config",
          config: { basePrice: 5, minPrice: 0.05, maxPrice: 5 },
        })
      ).status,
    ).toBe(200);
  });

  it("keeps the economy settings the panel did not send", async () => {
    await post({ action: "save_settings", rewardRatePerIqd: 6.8, signupGrant: 500 });
    await post({ action: "save_settings", signupGrant: 750 });
    const { body } = await get();
    expect(body.settings.rewardRatePerIqd).toBe(6.8);
    expect(body.settings.signupGrant).toBe(750);
  });
});

describe("market-maker bots", () => {
  it("adds one, and it is there — «لا توجد بوتات بعد» was the panel never asking", async () => {
    const saved = await post({ action: "save_bot", bot: { name: "بوت السوق", isActive: true } });
    expect(saved.body.success).toBe(true);
    expect((await get()).body.bots).toHaveLength(1);
  });

  it("refuses a bot with no name", async () => {
    expect((await post({ action: "save_bot", bot: {} })).status).toBe(400);
  });

  it("deletes one", async () => {
    const saved = await post({ action: "save_bot", bot: { name: "بوت" } });
    await post({ action: "delete_bot", botId: saved.body.id });
    expect((await get()).body.bots).toHaveLength(0);
  });
});

describe("redemption rewards", () => {
  it("creates one and lists it", async () => {
    const res = await post({
      action: "save_reward",
      reward: { title: "بطاقة شحن", description: "", bananaPrice: 5000, stock: 10, isActive: true },
    });
    expect(res.body.success).toBe(true);
    expect((await get()).body.rewards).toHaveLength(1);
  });

  it("refuses one with no title or no price", async () => {
    expect((await post({ action: "save_reward", reward: { bananaPrice: 10 } })).status).toBe(400);
    expect(
      (await post({ action: "save_reward", reward: { title: "x", bananaPrice: 0 } })).status,
    ).toBe(400);
  });

  it("turns one off without deleting it", async () => {
    const res = await post({
      action: "save_reward",
      reward: { title: "جائزة", bananaPrice: 100, stock: 1, isActive: true },
    });
    await post({ action: "toggle_reward", rewardId: res.body.reward.id, isActive: false });
    expect((await get()).body.rewards[0].is_active).toBe(0);
  });

  it("deletes one", async () => {
    const res = await post({
      action: "save_reward",
      reward: { title: "جائزة", bananaPrice: 100, stock: 1, isActive: true },
    });
    await post({ action: "delete_reward", rewardId: res.body.reward.id });
    expect((await get()).body.rewards).toHaveLength(0);
  });
});

describe("a member's balance", () => {
  it("credits, and reports what it was and what it became", async () => {
    await seedMember("usr_a", 1_000);
    const { body } = await post({
      action: "adjust_balance",
      userId: "usr_a",
      amount: 500,
      reason: "تعويض",
    });
    expect(body.oldBalance).toBe(1_000);
    expect(body.newBalance).toBe(1_500);
  });

  it("debits", async () => {
    await seedMember("usr_a", 1_000);
    const { body } = await post({ action: "adjust_balance", userId: "usr_a", amount: -400 });
    expect(body.newBalance).toBe(600);
  });

  it("refuses an adjustment of nothing, and one with no member", async () => {
    await seedMember("usr_a", 10);
    expect((await post({ action: "adjust_balance", userId: "usr_a", amount: 0 })).status).toBe(400);
    expect((await post({ action: "adjust_balance", amount: 5 })).status).toBe(400);
  });
});

describe("the actions that do not exist", () => {
  it("are still refused, so a typo is not a silent success", async () => {
    const { status, body } = await post({ action: "burn_the_economy" });
    expect(status).toBe(400);
    expect(body.error).toBe("Invalid action");
  });
});
