/**
 * @vitest-environment node
 */
/** THROWAWAY PROBE — delete after running. */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__TEST_D1__"] = db;

const SECRETS: Record<string, string> = {
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  ACCOUNT_ENC_KEY: "test-account-encryption-key-0123456789ab",
  IP_SALT: "test-ip-salt-0123456789abcdefghijklmn",
  REFERRAL_HASH_SALT: "test-referral-salt-0123456789abcdefghij",
};

vi.mock("@/lib/env.server", () => ({
  env: (name: string) => SECRETS[name],
  getEnv: () => ({ ...SECRETS, bananto: (globalThis as Record<string, unknown>)["__TEST_D1__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));
vi.mock("@/lib/telegram.server", () => ({
  sendTelegramMessage: vi.fn(async () => ({ ok: true })),
  telegramMiniAppDeepLink: (value: string) => `https://t.me/bananto?start=${value}`,
}));
vi.mock("@/lib/whatsapp.server", () => ({ sendWhatsappMessage: vi.fn(async () => undefined) }));

const GAME = {
  id: "prd_odyssey",
  title: "Super Mario Odyssey",
  slug: "super-mario-odyssey",
  price: 10_000,
  cost: 4_000,
  stock: 99,
  kind: "account",
  category: "cat_nintendo",
  status: "نشط",
  isActive: true,
  releaseDate: "2017-10-27",
  options: [
    { id: "offline_account", name: "حساب أوفلاين", price: 10_000 },
    { id: "online_account", name: "حساب أونلاين", price: 14_000 },
  ],
  types: [{ id: "standard_offline", name: "أوفلاين عادي" }],
};

const OFFLINE_LINE = {
  productId: GAME.id,
  quantity: 1,
  optionId: "offline_account",
  typeId: "standard_offline",
};

let store: typeof import("@/lib/db.server");
let service: typeof import("@/lib/referral/service.server");
let orders: typeof import("@/lib/orders.server");

beforeAll(async () => {
  const { ensureSchema } = await import("@/lib/d1.server");
  await ensureSchema();
  store = await import("@/lib/db.server");
  service = await import("@/lib/referral/service.server");
  orders = await import("@/lib/orders.server");
});

function seedUser(u: { id: string; name: string; email: string; phone: string; username: string; walletBalance?: number }) {
  db.raw
    .prepare(
      `INSERT OR REPLACE INTO users
        (id, name, email, phone, password_hash, username, wallet_balance, is_admin,
         provider, settings, addresses, favorites, created_at)
       VALUES (?, ?, ?, ?, 'x', ?, ?, 0, 'password', '{}', '[]', '[]', ?)`,
    )
    .run(u.id, u.name, u.email, u.phone, u.username, u.walletBalance ?? 0, new Date().toISOString());
}

function seedCatalogue() {
  db.raw.exec("DELETE FROM store_kv");
  db.raw.exec("DELETE FROM store_rev");
  const insert = db.raw.prepare(`INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)`);
  insert.run(
    "store",
    JSON.stringify({
      categories: [{ id: "cat_nintendo", title: "ألعاب" }],
      bundles: [],
      settings: { referral: { enabled: true, buyerPercent: 10, referrerPercent: 10, holdDays: 0 } },
    }),
    "now",
  );
  insert.run("store:products", JSON.stringify([GAME]), "now");
  db.raw.prepare(`INSERT INTO store_rev (rev, updated_at) VALUES (1, 'now')`).run();
  store.invalidateStoreCache();
}

function request(options: { cookies?: string[]; ip?: string; userAgent?: string; url?: string } = {}): Request {
  const headers = new Headers({
    host: "banan.to",
    "x-forwarded-proto": "https",
    "cf-connecting-ip": options.ip ?? "37.236.0.1",
    "user-agent":
      options.userAgent ??
      "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36",
    "accept-language": "ar,en;q=0.9",
  });
  if (options.cookies?.length) headers.set("cookie", options.cookies.join("; "));
  return new Request(options.url ?? "https://banan.to/product/super-mario-odyssey", { headers });
}

function cookieJar(setCookies: string[], existing: string[] = []): string[] {
  const jar = new Map<string, string>();
  for (const pair of existing) {
    const [name, ...rest] = pair.split("=");
    if (name) jar.set(name, rest.join("="));
  }
  for (const header of setCookies) {
    const [pair] = header.split(";");
    const [name, ...rest] = (pair ?? "").split("=");
    if (!name) continue;
    const value = rest.join("=");
    if (value === "") jar.delete(name);
    else jar.set(name, value);
  }
  return Array.from(jar, ([name, value]) => `${name}=${value}`);
}

const REFERRER = { id: "usr_referrer", name: "سامي", email: "sami@example.com", phone: "+9647701111111", username: "sami" };
const BUYER = { id: "usr_buyer", name: "علي", email: "ali@example.com", phone: "+9647702222222", username: "ali", walletBalance: 500_000 };
const REFERRER_DEVICE = { ip: "37.236.10.10", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) AppleWebKit/605.1 Version/17.4 Mobile Safari/604.1" };
const BUYER_DEVICE = { ip: "37.236.20.20", userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36" };

beforeEach(async () => {
  for (const table of [
    "referral_rewards", "referral_attributions", "referral_risk_events", "referral_identity_links",
    "referral_blocklist", "referral_codes", "telegram_links", "orders", "wallet_transactions",
    "order_items_snapshot", "order_queue", "threads", "messages", "coupons", "coupon_redemptions", "coupon_user_usage",
  ]) {
    try { db.raw.exec(`DELETE FROM ${table}`); } catch { /* not in this build */ }
  }
  seedUser(REFERRER);
  seedUser(BUYER);
  seedCatalogue();
});

async function readyToBuy() {
  const owner = await store.findUserById(REFERRER.id);
  const code = (await service.getOrCreateReferralCode(owner!))!.code;
  const identity = await service.requestIdentity(request(REFERRER_DEVICE));
  await service.bindIdentitiesToUser(REFERRER.id, identity);
  const capture = await service.captureAttribution({
    request: request(BUYER_DEVICE),
    codeInput: code,
    productRef: "super-mario-odyssey",
  });
  expect(capture.ok).toBe(true);
  const jar = cookieJar(capture.setCookies);
  const checkoutRequest = request({ ...BUYER_DEVICE, cookies: jar, url: "https://banan.to/cart" });
  await service.bindAttributionToUser(checkoutRequest, BUYER.id);
  return checkoutRequest;
}

const bindingRow = () =>
  db.raw
    .prepare(`SELECT referral_discount_used_at, first_referral_order_id, referred_by_user_id, wallet_balance FROM users WHERE id = ?`)
    .get(BUYER.id) as Record<string, unknown>;

const orderCount = () =>
  Number((db.raw.prepare(`SELECT COUNT(*) AS n FROM orders`).get() as Record<string, unknown>)["n"]);

describe("PROBE", () => {
  it("baseline: a normal referred purchase spends the discount and the money", async () => {
    const req = await readyToBuy();
    const buyer = (await store.findUserById(BUYER.id))!;
    const order = await orders.createOrderForUser(
      buyer, [OFFLINE_LINE] as never, undefined, undefined, true, undefined, undefined,
      "checkout_web", undefined, { request: req },
    );
    expect(order.total).toBe(9_000);
    console.log("BASELINE:", bindingRow(), "orders:", orderCount());
  });

  it("A: wallet batch loses the race after the referral was claimed", async () => {
    const req = await readyToBuy();
    // The snapshot requireUser() handed this request.
    const buyer = (await store.findUserById(BUYER.id))!;
    expect(buyer.walletBalance).toBe(500_000);
    // The other tab's order commits here: the real balance is now too small,
    // while THIS request still holds the old number in memory.
    db.raw.prepare(`UPDATE users SET wallet_balance = 0 WHERE id = ?`).run(BUYER.id);

    await expect(
      orders.createOrderForUser(
        buyer, [OFFLINE_LINE] as never, undefined, undefined, true, undefined, undefined,
        "checkout_web", undefined, { request: req },
      ),
    ).rejects.toThrow("insufficient_balance");

    const row = bindingRow();
    console.log("AFTER LOST RACE:", row, "orders:", orderCount());
    console.log("DISCOUNT BURNED?", row["referral_discount_used_at"] !== null);
  });

  it("B: the pre-flight balance check (the honest path) releases it", async () => {
    const req = await readyToBuy();
    const buyer = (await store.findUserById(BUYER.id))!;
    db.raw.prepare(`UPDATE users SET wallet_balance = 0 WHERE id = ?`).run(BUYER.id);
    const poor = { ...buyer, walletBalance: 0 };

    await expect(
      orders.createOrderForUser(
        poor as never, [OFFLINE_LINE] as never, undefined, undefined, true, undefined, undefined,
        "checkout_web", undefined, { request: req },
      ),
    ).rejects.toThrow("insufficient_balance");

    const row = bindingRow();
    console.log("AFTER PREFLIGHT REFUSAL:", row, "orders:", orderCount());
    console.log("DISCOUNT BURNED?", row["referral_discount_used_at"] !== null);
  });
});
