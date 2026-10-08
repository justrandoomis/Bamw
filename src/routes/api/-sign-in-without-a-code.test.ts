/**
 * @vitest-environment node
 */
/**
 * «أريد تسهيل عملية تسجيل الدخول وشراء اللعبة فيمكن تسجيل الدخول عن طريق
 *  جوجل والإيميل بسهولة جدا وإنشاء الحساب أسهل بدون رمز تحقق أو شيء ...
 *  يعطيه النظام كود ... عندما يضع الكود يسجل مباشرة»
 *
 * End to end through the real /api/auth handler, the real session cookie and
 * a real SQLite database built by the application's own schema:
 *
 * - a username in, a login code out, and that code alone signs in after;
 * - the code is kept only as a hash, and a replaced code stops working, along
 *   with every session the old one opened;
 * - an email and a password make an account at once, no code sent anywhere;
 * - a Google sign-in with that address later takes the account from whoever
 *   typed it, unless something else had already proven it.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
const SECRET = "test-session-secret-0123456789abcdef";

vi.mock("@/lib/env.server", () => ({
  env: (name: string) => (name === "SESSION_SECRET" ? SECRET : undefined),
  getEnv: () => ({ bananto: db, SESSION_SECRET: SECRET }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

vi.mock("@/lib/rate-limit.server", () => ({
  consumeRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0, remaining: 99 })),
  rateLimitResponse: vi.fn(),
  clientAddress: () => "203.0.113.7",
}));

/* Referral attribution rides on every sign-in; it is not under test here. */
vi.mock("@/lib/referral/service.server", () => ({
  bindAttributionToUser: vi.fn(async () => undefined),
}));

const { Route } = await import("./auth");
const { findOrCreateOAuthUser } = await import("@/lib/db.server");

const handlers = Route.options.server!.handlers as unknown as {
  GET: (ctx: { request: Request }) => Promise<Response>;
  POST: (ctx: { request: Request }) => Promise<Response>;
};

const URL_AUTH = "https://banan.to/api/auth";

/** The session cookie a response set, as a browser would send it back. */
const cookieFrom = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

const post = (payload: Record<string, unknown>, cookie = "") =>
  handlers.POST({
    request: new Request(URL_AUTH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(payload),
    }),
  });

const me = async (cookie: string) => {
  const res = await handlers.GET({
    request: new Request(URL_AUTH, { headers: { cookie, "x-forwarded-proto": "https" } }),
  });
  return ((await res.json()) as { user: Record<string, unknown> | null }).user;
};

const row = (username: string) =>
  db.raw.prepare(`SELECT * FROM users WHERE lower(username) = ?`).get(username.toLowerCase()) as
    Record<string, unknown> | undefined;

beforeAll(async () => {
  // The schema the Worker builds on first use.
  const { d1Ready } = await import("@/lib/db.server");
  (globalThis as Record<string, unknown>)["__TEST_D1__"] = db;
  expect(await d1Ready()).toBe(true);
});

describe("a username in, a login code out", () => {
  it("says which usernames can be had, and why not", async () => {
    expect(await (await post({ action: "username_check", username: "ali_gamer" })).json()).toEqual({
      available: true,
      username: "ali_gamer",
    });
    const reserved = await (await post({ action: "username_check", username: "Admin" })).json();
    expect(reserved).toMatchObject({ available: false, problem: "reserved" });
    const short = await (await post({ action: "username_check", username: "ab" })).json();
    expect(short).toMatchObject({ available: false, problem: "short" });
  });

  let code = "";
  let cookie = "";

  it("creates the account and hands back a code — once, and only as a hash in the database", async () => {
    const res = await post({ action: "code_register", username: "Ali_Gamer" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: Record<string, unknown>; code: string };
    code = body.code;
    cookie = cookieFrom(res);

    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(body.user).toMatchObject({
      username: "ali_gamer",
      provider: "code",
      hasLoginCode: true,
    });
    expect(body.user).not.toHaveProperty("loginCodeHash");
    expect(cookie).toMatch(/^banana_session=/);

    const stored = row("ali_gamer")!;
    expect(stored["login_code_hash"]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(code.replace(/-/g, ""));
    expect(stored["email"]).toMatch(/@code\.banana\.local$/);
    expect(stored["password_hash"]).toBe("");
  });

  it("gives a name to one account only, whatever its case", async () => {
    const res = await post({ action: "code_register", username: "ALI_GAMER" });
    expect(res.status).toBe(409);
    expect(
      (
        db.raw
          .prepare(`SELECT COUNT(*) AS n FROM users WHERE lower(username) = 'ali_gamer'`)
          .get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
  });

  it("is signed in at once, and records when the member says they kept the code", async () => {
    expect(await me(cookie)).toMatchObject({ username: "ali_gamer" });
    expect((await me(cookie))?.["loginCodeSavedAt"]).toBeUndefined();
    expect((await post({ action: "code_saved" }, cookie)).status).toBe(200);
    expect((await me(cookie))?.["loginCodeSavedAt"]).toEqual(expect.any(String));
  });

  it("signs in with the code alone, however it was copied", async () => {
    const handwritten = code.toLowerCase().replace(/-/g, " ").replace(/0/g, "o");
    const res = await post({ action: "code_login", code: handwritten });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { username: string } }).user.username).toBe("ali_gamer");
    expect(await me(cookieFrom(res))).toMatchObject({ username: "ali_gamer" });

    expect((await post({ action: "code_login", code: "AAAA-BBBB-CCCC-DDDD" })).status).toBe(401);
    expect((await post({ action: "code_login", code: "not a code" })).status).toBe(401);
  });

  it("replaces the code: the old one and its sessions stop, the new one works", async () => {
    const res = await post({ action: "code_rotate" }, cookie);
    expect(res.status).toBe(200);
    const fresh = ((await res.json()) as { code: string }).code;
    expect(fresh).not.toBe(code);

    expect((await post({ action: "code_login", code })).status).toBe(401);
    expect((await post({ action: "code_login", code: fresh })).status).toBe(200);

    // Another device signed in with the old code is signed out…
    expect(await me(cookie)).toBeNull();
    // …and the device that asked for the new code carries on.
    expect(await me(cookieFrom(res))).toMatchObject({ username: "ali_gamer" });
    expect((await me(cookieFrom(res)))?.["loginCodeSavedAt"]).toBeUndefined();
  });
});

describe("an email and a password, with no code sent anywhere", () => {
  it("makes the account and signs it in at once", async () => {
    const res = await post({
      action: "register",
      name: "Sara",
      email: "Sara@Example.com",
      password: "banana-2026",
    });
    expect(res.status).toBe(200);
    const user = ((await res.json()) as { user: Record<string, unknown> }).user;
    expect(user).toMatchObject({ email: "sara@example.com", provider: "password", name: "Sara" });
    expect(user["emailVerifiedAt"]).toBeUndefined();
    expect(await me(cookieFrom(res))).toMatchObject({ email: "sara@example.com" });

    const login = await post({
      action: "login",
      identifier: "sara@example.com",
      password: "banana-2026",
    });
    expect(login.status).toBe(200);
  });

  it("refuses a taken address, a malformed one, and a short password", async () => {
    expect(
      (await post({ action: "register", email: "sara@example.com", password: "banana-2026" }))
        .status,
    ).toBe(409);
    expect(
      (await post({ action: "register", email: "sara@", password: "banana-2026" })).status,
    ).toBe(400);
    expect(
      (await post({ action: "register", email: "x@code.banana.local", password: "banana-2026" }))
        .status,
    ).toBe(400);
    expect(
      (await post({ action: "register", email: "new@example.com", password: "short" })).status,
    ).toBe(400);
  });

  it("hands the account to the address's owner when they arrive through Google", async () => {
    // Someone typed sara@example.com with a password of their own; Google proves who owns it.
    const user = await findOrCreateOAuthUser({
      provider: "google",
      providerId: "google-sara",
      email: "sara@example.com",
      name: "Sara",
    });
    expect(user.provider).toBe("google");
    expect(user.emailVerifiedAt).toEqual(expect.any(String));
    expect(user.passwordHash).toBe("");
    const login = await post({
      action: "login",
      identifier: "sara@example.com",
      password: "banana-2026",
    });
    expect(login.status).toBe(401);
  });

  it("but keeps the password of an account a verified phone already proved", async () => {
    db.raw
      .prepare(
        `INSERT INTO users (id, name, email, password_hash, phone, phone_verified_at, provider, settings, addresses, favorites, created_at)
         VALUES ('usr_phone1', 'Omar', 'omar@example.com', 'hash-omar', '+9647700000001', '2026-01-01T00:00:00Z', 'password', '{}', '[]', '[]', '2026-01-01T00:00:00Z')`,
      )
      .run();
    const user = await findOrCreateOAuthUser({
      provider: "google",
      providerId: "google-omar",
      email: "omar@example.com",
      name: "Omar",
    });
    expect(user.id).toBe("usr_phone1");
    expect(user.passwordHash).toBe("hash-omar");
  });
});
