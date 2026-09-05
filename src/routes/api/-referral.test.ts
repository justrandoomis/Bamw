/**
 * @vitest-environment node
 */
/**
 * The referral endpoints, as a browser meets them.
 *
 * What is asserted here is the boundary: the response never contains a device
 * or an address, a forged body cannot name its own referrer or its own
 * discount, a refused code always reads the same, and guessing codes runs into
 * a rate limit rather than into the database.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__TEST_D1__"] = db;

const SECRETS: Record<string, string> = {
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  REFERRAL_HASH_SALT: "test-referral-salt-0123456789abcdefghij",
};

let viewer: { id: string; name: string; email: string; username: string; isAdmin: boolean } | undefined;
let allowed = true;

vi.mock("@/lib/env.server", () => ({
  env: (name: string) => SECRETS[name],
  getEnv: () => ({ ...SECRETS, bananto: (globalThis as Record<string, unknown>)["__TEST_D1__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

vi.mock("@/lib/session.server", () => ({
  getSessionUser: vi.fn(async () => viewer),
  requireUser: vi.fn(async () => {
    if (!viewer) throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    return viewer;
  }),
  requireAdmin: vi.fn(async () => {
    if (!viewer?.isAdmin) throw new Response("forbidden", { status: 403 });
    return viewer;
  }),
}));

vi.mock("@/lib/rate-limit.server", () => ({
  consumeRateLimit: vi.fn(async () => ({ allowed, retryAfter: 900, remaining: 0 })),
  rateLimitResponse: vi.fn(
    (retryAfter: number) =>
      new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "retry-after": String(retryAfter) },
      }),
  ),
}));

const GAME = {
  id: "prd_odyssey",
  title: "Super Mario Odyssey",
  slug: "super-mario-odyssey",
  price: 10_000,
  stock: 99,
  kind: "account",
  category: "cat_nintendo",
  isActive: true,
  options: [{ id: "offline_account", name: "حساب أوفلاين", price: 10_000 }],
  types: [{ id: "standard_offline", name: "أوفلاين عادي" }],
};

let referralRoute: typeof import("./referral");
let store: typeof import("@/lib/db.server");
let service: typeof import("@/lib/referral/service.server");

beforeAll(async () => {
  const { ensureSchema } = await import("@/lib/d1.server");
  await ensureSchema();
  store = await import("@/lib/db.server");
  service = await import("@/lib/referral/service.server");
  referralRoute = await import("./referral");
});

type Handler = (ctx: { request: Request }) => Promise<Response>;
const handlers = () =>
  referralRoute.Route.options.server!.handlers as unknown as {
    GET: Handler;
    POST: Handler;
    PUT: Handler;
    DELETE: Handler;
  };

const HEADERS = {
  host: "banan.to",
  "x-forwarded-proto": "https",
  "cf-connecting-ip": "37.236.44.44",
  "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/124.0.0.0 Mobile Safari/537.36",
  "content-type": "application/json",
};

function post(body: unknown, cookies?: string[]) {
  const headers = new Headers(HEADERS);
  if (cookies?.length) headers.set("cookie", cookies.join("; "));
  return handlers().POST({
    request: new Request("https://banan.to/api/referral", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  });
}

beforeEach(() => {
  for (const table of [
    "referral_rewards",
    "referral_attributions",
    "referral_risk_events",
    "referral_identity_links",
    "referral_blocklist",
    "referral_codes",
    "users",
    "store_kv",
    "store_rev",
  ]) {
    try {
      db.raw.exec(`DELETE FROM ${table}`);
    } catch {
      // Not every build creates every table.
    }
  }

  const now = new Date().toISOString();
  const insertUser = db.raw.prepare(
    `INSERT INTO users (id, name, email, phone, password_hash, username, wallet_balance, is_admin,
                        provider, settings, addresses, favorites, created_at)
     VALUES (?, ?, ?, ?, 'x', ?, 0, ?, 'password', '{}', '[]', '[]', ?)`,
  );
  insertUser.run("usr_ref", "سامي", "sami@example.com", "+9647701111111", "sami", 0, now);
  insertUser.run("usr_buy", "علي", "ali@example.com", "+9647702222222", "ali", 0, now);

  const insertKv = db.raw.prepare(`INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)`);
  insertKv.run(
    "store",
    JSON.stringify({ settings: { referral: { enabled: true, buyerPercent: 10, referrerPercent: 10 } } }),
    now,
  );
  insertKv.run("store:products", JSON.stringify([GAME]), now);
  db.raw.prepare(`INSERT INTO store_rev (rev, updated_at) VALUES (1, ?)`).run(now);
  store.invalidateStoreCache();

  viewer = undefined;
  allowed = true;
});

async function mintCode(): Promise<string> {
  const owner = await store.findUserById("usr_ref");
  return (await service.getOrCreateReferralCode(owner!))!.code;
}

describe("GET /api/referral", () => {
  it("answers a guest with the terms and no personal data", async () => {
    const res = await handlers().GET({
      request: new Request("https://banan.to/api/referral", { headers: new Headers(HEADERS) }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.terms.buyerPercent).toBe(10);
    expect(body.share).toBeNull();
    expect(body.stats).toBeNull();

    // Identity cookies are minted, and they are signed and HttpOnly.
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith("bnt_ref_sid="))).toBe(true);
    for (const cookie of cookies) {
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
    }
  });

  it("gives a signed-in member their own code and link", async () => {
    viewer = { id: "usr_ref", name: "سامي", email: "sami@example.com", username: "sami", isAdmin: false };
    const res = await handlers().GET({
      request: new Request("https://banan.to/api/referral", { headers: new Headers(HEADERS) }),
    });
    const body = await res.json();

    expect(body.share.code).toMatch(/^[A-Z0-9]{6,16}$/);
    /*
      The shop's front door, not `/refer` — that is the referrer's own invite
      screen, and a friend who followed an invitation used to land on a page
      telling them to invite somebody, with nothing to buy on it.
    */
    expect(body.share.link).toContain("/?ref=");
    expect(body.share.link).not.toContain("/refer?ref=");
    expect(body.stats.invites).toBe(0);

    // Nothing about the device or the address travels back.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("37.236.44.44");
    expect(raw).not.toContain("Pixel 8");
    expect(raw).not.toMatch(/device_hash|ip_hash|deviceHash|ipHash/);
  });

  it("offers the field to a member who has never used a referral", async () => {
    viewer = { id: "usr_buy", name: "علي", email: "ali@example.com", username: "ali", isAdmin: false };
    const body = await (
      await handlers().GET({
        request: new Request("https://banan.to/api/referral", { headers: new Headers(HEADERS) }),
      })
    ).json();

    expect(body.canApply).toBe(true);
    expect(body.discountUsed).toBe(false);
    expect(body.supporting).toBeNull();
  });

  it("stops offering it once the discount has been used", async () => {
    /*
      The visibility rule, decided on the database and nowhere else. Once the
      discount is spent the cart shows no field — not a disabled one — because
      a second code cannot give a second discount or move the referrer.
    */
    db.raw
      .prepare(
        `UPDATE users SET referral_discount_used_at = ?, first_referral_order_id = 'ord_1',
                referred_by_user_id = 'usr_ref' WHERE id = 'usr_buy'`,
      )
      .run(new Date().toISOString());
    viewer = { id: "usr_buy", name: "علي", email: "ali@example.com", username: "ali", isAdmin: false };

    const body = await (
      await handlers().GET({
        request: new Request("https://banan.to/api/referral", { headers: new Headers(HEADERS) }),
      })
    ).json();

    expect(body.canApply).toBe(false);
    expect(body.discountUsed).toBe(true);
    // The relationship is still named — that member keeps earning 5%.
    expect(body.supporting).toEqual({ username: "sami" });
  });

  it("names the referrer from the server, not from anything a link carried", async () => {
    db.raw
      .prepare(`UPDATE users SET referred_by_user_id = 'usr_ref' WHERE id = 'usr_buy'`)
      .run();
    viewer = { id: "usr_buy", name: "علي", email: "ali@example.com", username: "ali", isAdmin: false };

    const body = await (
      await handlers().GET({
        request: new Request("https://banan.to/api/referral", { headers: new Headers(HEADERS) }),
      })
    ).json();

    // The public username only: no real name, no email, no phone.
    expect(body.supporting).toEqual({ username: "sami" });
    const raw = JSON.stringify(body.supporting);
    expect(raw).not.toContain("سامي");
    expect(raw).not.toContain("sami@example.com");
  });
});

describe("POST /api/referral", () => {
  it("applies a valid code and says so", async () => {
    const code = await mintCode();
    const res = await post({ code, product: "super-mario-odyssey" });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.message).toContain("@sami");
    expect(body.buyerPercent).toBe(10);
    expect(res.headers.getSetCookie().some((cookie) => cookie.startsWith("bnt_ref="))).toBe(true);
  });

  it("refuses an unknown code in the same words as every refusal", async () => {
    const res = await post({ code: "ZZZZZZZZ" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.message).toBe(service.REFERRAL_REFUSAL_MESSAGE);
    expect(body.reason).toBeUndefined();
  });

  it("ignores a referrer, a rate and an amount sent in the body", async () => {
    const code = await mintCode();
    viewer = { id: "usr_buy", name: "علي", email: "ali@example.com", username: "ali", isAdmin: false };

    const res = await post({
      code,
      product: "super-mario-odyssey",
      // Everything a tampered client might try.
      referrerUserId: "usr_attacker",
      buyerDiscountIqd: 9_999,
      buyerPercent: 90,
      lines: [
        {
          productId: GAME.id,
          kind: "account",
          quantity: 1,
          unitPrice: 1_000_000,
          optionId: "offline_account",
          typeId: "standard_offline",
        },
      ],
    });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.quote.originalPriceIqd).toBe(10_000);
    expect(body.quote.buyerDiscountIqd).toBe(1_000);

    const row = db.raw.prepare(`SELECT referrer_user_id FROM referral_attributions`).get() as
      | Record<string, unknown>
      | undefined;
    expect(row?.["referrer_user_id"]).toBe("usr_ref");
  });

  it("meets a rate limit rather than the database when codes are guessed", async () => {
    allowed = false;
    const res = await post({ code: "AAAAAAAA" });
    expect(res.status).toBe(429);
    expect(db.raw.prepare(`SELECT COUNT(*) AS total FROM referral_attributions`).get()).toEqual({
      total: 0,
    });
  });
});

describe("DELETE /api/referral", () => {
  it("clears the attribution cookie", async () => {
    const res = await handlers().DELETE({
      request: new Request("https://banan.to/api/referral", {
        method: "DELETE",
        headers: new Headers(HEADERS),
      }),
    });
    expect(res.status).toBe(200);
    const cleared = res.headers.getSetCookie().find((cookie) => cookie.startsWith("bnt_ref="));
    expect(cleared).toContain("Max-Age=0");
  });
});

describe("PUT /api/referral", () => {
  it("needs an account", async () => {
    viewer = undefined;
    const res = await handlers()
      .PUT({
        request: new Request("https://banan.to/api/referral", {
          method: "PUT",
          headers: new Headers(HEADERS),
          body: JSON.stringify({ lines: [] }),
        }),
      })
      .catch((thrown: Response) => thrown);
    expect(res.status).toBe(401);
  });
});

describe("a deployment with no signing key", () => {
  it("reports the programme as off instead of failing the cart's read", async () => {
    const original = SECRETS["SESSION_SECRET"];
    delete SECRETS["SESSION_SECRET"];
    try {
      const res = await handlers().GET({
        request: new Request("https://banan.to/api/referral", { headers: new Headers(HEADERS) }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.terms.enabled).toBe(false);
      expect(body.share).toBeNull();
    } finally {
      SECRETS["SESSION_SECRET"] = original!;
    }
  });

  it("refuses to apply a code, in the same words as every refusal", async () => {
    const original = SECRETS["SESSION_SECRET"];
    delete SECRETS["SESSION_SECRET"];
    try {
      const res = await post({ code: "ABC12345" });
      expect(res.status).toBe(503);
      expect((await res.json()).message).toBe(service.REFERRAL_REFUSAL_MESSAGE);
    } finally {
      SECRETS["SESSION_SECRET"] = original!;
    }
  });
});
