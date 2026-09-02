/**
 * @vitest-environment node
 */
/**
 * The admin side of the referral programme.
 *
 * Two things are asserted: the manual actions actually move money and state
 * (and write an audit entry doing it), and the payload an admin's browser
 * receives carries no device or address hash — the screen shows "device match:
 * yes", and there is nothing an identifier in the response would add except a
 * copy of it in a screenshot.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__TEST_D1__"] = db;

const SECRETS: Record<string, string> = {
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  REFERRAL_HASH_SALT: "test-referral-salt-0123456789abcdefghij",
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

let route: typeof import("./referrals");
let store: typeof import("@/lib/db.server");

beforeAll(async () => {
  const { ensureSchema } = await import("@/lib/d1.server");
  await ensureSchema();
  store = await import("@/lib/db.server");
  route = await import("./referrals");
});

type Handler = (ctx: { request: Request }) => Promise<Response>;
const handlers = () =>
  route.Route.options.server!.handlers as unknown as { GET: Handler; POST: Handler };

const get = (query = "") =>
  handlers().GET({ request: new Request(`https://banan.to/api/admin/referrals${query}`) });

const post = (body: unknown) =>
  handlers().POST({
    request: new Request("https://banan.to/api/admin/referrals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });

const now = new Date().toISOString();

function seedReward(overrides: Record<string, unknown> = {}) {
  const row = {
    id: "rrw_1",
    order_id: "ord_1",
    order_item_id: "itm_1",
    product_id: "prd_1",
    referrer_user_id: "usr_ref",
    buyer_user_id: "usr_buy",
    referral_code: "ABC12345",
    original_price_iqd: 10_000,
    buyer_discount_iqd: 1_000,
    referrer_reward_iqd: 1_000,
    buyer_percent_bps: 1000,
    referrer_percent_bps: 1000,
    status: "pending",
    risk_score: 90,
    risk_verdict: "same_device",
    attribution_id: "rat_1",
    ...overrides,
  };
  db.raw
    .prepare(
      `INSERT INTO referral_rewards
        (id, attribution_id, order_id, order_item_id, product_id, referrer_user_id, buyer_user_id,
         referral_code, original_price_iqd, buyer_discount_iqd, referrer_reward_iqd,
         reversed_amount_iqd, buyer_percent_bps, referrer_percent_bps, status, risk_score,
         risk_verdict, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.attribution_id,
      row.order_id,
      row.order_item_id,
      row.product_id,
      row.referrer_user_id,
      row.buyer_user_id,
      row.referral_code,
      row.original_price_iqd,
      row.buyer_discount_iqd,
      row.referrer_reward_iqd,
      row.buyer_percent_bps,
      row.referrer_percent_bps,
      row.status,
      row.risk_score,
      row.risk_verdict,
      now,
      now,
    );
  return row;
}

beforeEach(() => {
  for (const table of [
    "referral_rewards",
    "referral_attributions",
    "referral_risk_events",
    "referral_blocklist",
    "referral_codes",
    "wallet_transactions",
    "audit_logs",
    "users",
    "orders",
    "store_kv",
    "store_rev",
  ]) {
    try {
      db.raw.exec(`DELETE FROM ${table}`);
    } catch {
      // Not every build creates every table.
    }
  }

  const insertUser = db.raw.prepare(
    `INSERT INTO users (id, name, email, phone, password_hash, username, wallet_balance, is_admin,
                        provider, settings, addresses, favorites, created_at)
     VALUES (?, ?, ?, ?, 'x', ?, ?, ?, 'password', '{}', '[]', '[]', ?)`,
  );
  insertUser.run("usr_admin", "المدير", "admin@example.com", "+9647700000000", "admin", 0, 1, now);
  insertUser.run("usr_ref", "سامي", "sami@example.com", "+9647701111111", "sami", 0, 0, now);
  insertUser.run("usr_buy", "علي", "ali@example.com", "+9647702222222", "ali", 0, 0, now);

  db.raw
    .prepare(
      `INSERT INTO orders (id, code, user_id, doc, status, payment_status, total, created_at, updated_at)
       VALUES ('ord_1', 'BN-000001', 'usr_buy', ?, 'completed', 'paid', 9000, ?, ?)`,
    )
    .run(
      JSON.stringify({
        id: "ord_1",
        code: "BN-000001",
        userId: "usr_buy",
        items: [],
        total: 9000,
        status: "completed",
        paymentStatus: "paid",
        events: [],
      }),
      now,
      now,
    );

  const insertKv = db.raw.prepare(`INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)`);
  insertKv.run("store", JSON.stringify({ settings: {} }), now);
  insertKv.run("store:products", JSON.stringify([]), now);
  db.raw.prepare(`INSERT INTO store_rev (rev, updated_at) VALUES (1, ?)`).run(now);
  store.invalidateStoreCache();

  admin = { id: "usr_admin", isAdmin: true };
});

describe("the queue", () => {
  it("lists rewards with the anti-abuse verdict as flags, not as hashes", async () => {
    seedReward();
    db.raw
      .prepare(
        `INSERT INTO referral_attributions
          (id, referrer_user_id, referral_code_id, product_id, guest_session_hash, device_hash,
           ip_hash, status, captured_at, expires_at, updated_at)
         VALUES ('rat_1','usr_ref','rfc_1','prd_1','sess_hash','device_hash_value','ip_hash_value',
                 'converted', ?, ?, ?)`,
      )
      .run(now, now, now);

    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.rewards).toHaveLength(1);
    expect(body.rewards[0].deviceMatch).toBe(true);
    expect(body.rewards[0].ipMatch).toBe(false);
    expect(body.rewards[0].referrerName).toBe("سامي");
    expect(body.rewards[0].orderCode).toBe("BN-000001");
    expect(body.totals.pendingIqd).toBe(1_000);

    const raw = JSON.stringify(body);
    expect(raw).not.toContain("device_hash_value");
    expect(raw).not.toContain("ip_hash_value");
    expect(raw).not.toContain("sess_hash");
  });

  it("returns one referral's whole trail, still without the hashes", async () => {
    seedReward();
    db.raw
      .prepare(
        `INSERT INTO referral_risk_events
          (id, attribution_id, reward_id, order_id, event_type, risk_score, device_hash, ip_hash, metadata, created_at)
         VALUES ('rre_1','rat_1','rrw_1','ord_1','capture_blocked', 90, 'device_hash_value','ip_hash_value','{"reasons":["same_device"]}', ?)`,
      )
      .run(now);

    const res = await get("?reward=rrw_1");
    const body = await res.json();

    expect(body.reward.id).toBe("rrw_1");
    expect(body.events).toHaveLength(1);
    expect(body.events[0].eventType).toBe("capture_blocked");
    expect(body.events[0].metadata.reasons).toEqual(["same_device"]);
    expect(body.events[0].deviceHash).toBeUndefined();
    expect(body.events[0].ipHash).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("device_hash_value");
  });

  it("is closed to anyone who is not an admin", async () => {
    admin = { id: "usr_buy", isAdmin: false };
    const res = await get().catch((thrown: Response) => thrown);
    expect(res.status).toBe(403);
  });
});

describe("the manual actions", () => {
  const balance = (userId: string) =>
    Number(
      (db.raw.prepare(`SELECT wallet_balance FROM users WHERE id = ?`).get(userId) as
        | Record<string, unknown>
        | undefined)?.["wallet_balance"] ?? 0,
    );

  const auditCount = () =>
    Number(
      (db.raw.prepare(`SELECT COUNT(*) AS total FROM audit_logs`).get() as Record<string, unknown>)[
        "total"
      ],
    );

  it("approves a held reward and credits the wallet once", async () => {
    seedReward({ status: "pending" });
    const res = await post({ action: "approve", rewardId: "rrw_1" });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(balance("usr_ref")).toBe(1_000);
    expect(auditCount()).toBe(1);

    // Pressing it again pays nothing more.
    await post({ action: "approve", rewardId: "rrw_1" });
    expect(balance("usr_ref")).toBe(1_000);
  });

  it("blocks a reward before it is paid", async () => {
    seedReward({ status: "pending" });
    const res = await post({ action: "block", rewardId: "rrw_1", reason: "same_device" });
    expect((await res.json()).ok).toBe(true);

    const row = db.raw.prepare(`SELECT status, blocked_reason FROM referral_rewards`).get() as
      | Record<string, unknown>
      | undefined;
    expect(row?.["status"]).toBe("blocked");
    expect(row?.["blocked_reason"]).toBe("same_device");
    expect(balance("usr_ref")).toBe(0);
  });

  it("reverses one that was already paid", async () => {
    seedReward({ status: "pending" });
    await post({ action: "approve", rewardId: "rrw_1" });
    expect(balance("usr_ref")).toBe(1_000);

    const res = await post({ action: "reverse", rewardId: "rrw_1", reason: "fraud" });
    expect((await res.json()).ok).toBe(true);
    expect(balance("usr_ref")).toBe(0);

    const row = db.raw.prepare(`SELECT status FROM referral_rewards`).get() as Record<
      string,
      unknown
    >;
    expect(row["status"]).toBe("reversed");
  });

  it("takes a member out of the programme and puts them back", async () => {
    await post({ action: "block_user", userId: "usr_ref", reason: "abuse" });
    let blocked = db.raw.prepare(`SELECT * FROM referral_blocklist`).all();
    expect(blocked).toHaveLength(1);

    await post({ action: "unblock_user", userId: "usr_ref" });
    blocked = db.raw.prepare(`SELECT * FROM referral_blocklist`).all();
    expect(blocked).toHaveLength(0);
  });

  it("disables a code without touching anybody's earnings", async () => {
    db.raw
      .prepare(
        `INSERT INTO referral_codes (id, user_id, code, is_active, created_at, updated_at)
         VALUES ('rfc_1','usr_ref','ABC12345',1,?,?)`,
      )
      .run(now, now);
    seedReward({ status: "approved" });

    await post({ action: "set_code_active", code: "ABC12345", isActive: false, reason: "abuse" });

    const code = db.raw.prepare(`SELECT is_active FROM referral_codes`).get() as Record<
      string,
      unknown
    >;
    expect(code["is_active"]).toBe(0);
    const reward = db.raw.prepare(`SELECT status FROM referral_rewards`).get() as Record<
      string,
      unknown
    >;
    expect(reward["status"]).toBe("approved");
  });

  it("saves the settings into the store document and nowhere else", async () => {
    const res = await post({
      action: "save_settings",
      settings: {
        enabled: true,
        buyerPercent: 15,
        referrerPercent: 5,
        maxRewardIqd: 20_000,
        linkTtlDays: 45,
        firstPurchaseOnly: false,
        stackWithCoupon: true,
        eligibleCategories: ["game", "bundle"],
      },
    });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.settings.buyerPercentBps).toBe(1500);
    expect(body.settings.referrerPercentBps).toBe(500);

    const stored = JSON.parse(
      String(
        (db.raw.prepare(`SELECT value FROM store_kv WHERE key = 'store'`).get() as Record<
          string,
          unknown
        >)["value"],
      ),
    ) as { settings?: Record<string, unknown> };
    const referral = stored.settings?.["referral"] as Record<string, unknown>;
    expect(referral["buyerPercentBps"]).toBe(1500);
    expect(referral["stackWithCoupon"]).toBe(true);
    expect(referral["eligibleCategories"]).toEqual(["game", "bundle"]);
  });

  it("refuses an action it does not know", async () => {
    const res = await post({ action: "drop_everything" });
    expect(res.status).toBe(400);
  });
});
