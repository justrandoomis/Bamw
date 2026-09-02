/**
 * @vitest-environment node
 */
/**
 * Registering for a game that is not out yet, end to end against a real
 * SQLite database created by the application's own schema.
 *
 * The store used to sell pre-orders outright: a priced product with a future
 * release date and nothing refusing the order. This is the other half of the
 * fix — what the customer gets instead of a purchase.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__TEST_D1__"] = db;

let viewer: { id: string; isAdmin: boolean } | undefined;

const UNRELEASED = {
  id: "prd_xeno3",
  title: "Xenoblade Chronicles 3 – Nintendo Switch 2 Edition",
  price: 12500,
  releaseDate: "2099-12-03",
};
const RELEASED = { id: "prd_odyssey", title: "Super Mario Odyssey", price: 25000, releaseDate: "2017-10-27" };

vi.mock("@/lib/env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__TEST_D1__"] }),
  getBinding: () => undefined,
}));

vi.mock("@/lib/session.server", () => ({
  getSessionUser: vi.fn(async () => viewer),
  requireUser: vi.fn(async () => {
    if (!viewer) throw new Error("unauthorised");
    return viewer;
  }),
  requireAdmin: vi.fn(async () => viewer),
}));

vi.mock("@/lib/rate-limit.server", () => ({
  consumeRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  rateLimitResponse: vi.fn(),
}));

vi.mock("@/lib/db.server", () => ({
  getStore: vi.fn(async () => ({ products: [UNRELEASED, RELEASED] })),
}));

const { Route } = await import("./release-alerts");

const handlers = Route.options.server!.handlers as unknown as {
  GET: (ctx: { request: Request }) => Promise<Response>;
  POST: (ctx: { request: Request }) => Promise<Response>;
  DELETE: (ctx: { request: Request }) => Promise<Response>;
};

const url = "https://banan.to/api/release-alerts";

const register = (productId: string) =>
  handlers.POST({
    request: new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId }),
    }),
  });

const unregister = (productId: string) =>
  handlers.DELETE({ request: new Request(`${url}?productId=${productId}`, { method: "DELETE" }) });

const list = async () => {
  const res = await handlers.GET({ request: new Request(url) });
  expect(res.status).toBe(200);
  return (await res.json()).alerts as Record<string, any>[];
};

beforeAll(async () => {
  const { ensureSchema } = await import("@/lib/d1.server");
  await ensureSchema();
});

beforeEach(() => {
  db.raw.exec("DELETE FROM product_release_alerts");
  viewer = { id: "usr_9", isAdmin: false };
});

describe("registering for a release", () => {
  it("records the game, its title and its date", async () => {
    const res = await register(UNRELEASED.id);
    expect(res.status).toBe(200);

    const [alert] = await list();
    expect(alert!.productId).toBe(UNRELEASED.id);
    expect(alert!.productTitle).toContain("Xenoblade");
    expect(alert!.releaseDate).toBe("2099-12-03");
    expect(alert!.notifiedAt).toBeNull();
  });

  it("treats a second tap as the same registration, not a duplicate", async () => {
    await register(UNRELEASED.id);
    await register(UNRELEASED.id);
    expect(await list()).toHaveLength(1);
  });

  it("refuses a game that is already out — nothing would ever fire", async () => {
    const res = await register(RELEASED.id);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("already_released");
    expect(await list()).toEqual([]);
  });

  it("refuses a product that does not exist", async () => {
    expect((await register("prd_nope")).status).toBe(404);
  });

  it("needs a product id", async () => {
    expect((await register("")).status).toBe(400);
  });

  it("lets the customer cancel", async () => {
    await register(UNRELEASED.id);
    expect((await unregister(UNRELEASED.id)).status).toBe(200);
    expect(await list()).toEqual([]);
  });
});

describe("whose list is whose", () => {
  it("shows a customer only their own registrations", async () => {
    await register(UNRELEASED.id);

    viewer = { id: "usr_other", isAdmin: false };
    expect(await list()).toEqual([]);

    viewer = { id: "usr_9", isAdmin: false };
    expect(await list()).toHaveLength(1);
  });

  it("gives a signed-out visitor an empty list rather than an error", async () => {
    viewer = undefined;
    const res = await handlers.GET({ request: new Request(url) });
    expect(res.status).toBe(200);
    expect((await res.json()).alerts).toEqual([]);
  });
});
