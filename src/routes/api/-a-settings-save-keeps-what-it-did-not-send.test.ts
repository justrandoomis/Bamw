/**
 * @vitest-environment node
 *
 * «إعدادات السعر» sends its own four keys, and nothing else.
 *
 * `/api/data` POST used to spread the patch over the store — `{ ...prev,
 * ...patch }` — so a `settings` it carried REPLACED the shop's settings, and
 * one save on that screen erased the referral programme, the banana market's
 * configuration, the shop's name and the banana earn rate. Through the real
 * handler and a real database: a screen owns the keys it sends.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__SETTINGS_SAVE_D1__"] = db;

vi.mock("@/lib/env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__SETTINGS_SAVE_D1__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

vi.mock("@/lib/session.server", () => ({
  getSessionUser: vi.fn(async () => ({ id: "usr_admin", isAdmin: true })),
  requireUser: vi.fn(async () => ({ id: "usr_admin", isAdmin: true })),
  requireAdmin: vi.fn(async () => ({ id: "usr_admin", isAdmin: true })),
}));

type Handler = (ctx: { request: Request }) => Promise<Response>;
let post: Handler;

const save = (patch: Record<string, unknown>) =>
  post({
    request: new Request("https://banan.to/api/data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  });

beforeAll(async () => {
  const { ensureSchema } = await import("@/lib/d1.server");
  await ensureSchema();
  post = ((await import("./data")).Route.options.server!.handlers as { POST: Handler }).POST;
});

describe("a settings save", () => {
  it("keeps every key it did not send", async () => {
    expect(
      (
        await save({
          settings: {
            storeName: "بنانتو",
            banana_reward_rate: 6.8,
            referral: { enabled: true, stackWithCoupon: false },
            deliveryBase: 5000,
          },
        })
      ).status,
    ).toBe(200);

    // What «إعدادات السعر» sends: its own four keys.
    const answer = await save({
      settings: {
        dinarPerBanana: 1000,
        usdExchangeRate: 1500,
        deliveryBase: 6000,
        deliveryExceptions: [{ city: "البصرة", price: 7000 }],
      },
    });
    expect(answer.status).toBe(200);

    const { getStoreMeta, invalidateStoreCache } = await import("@/lib/db.server");
    invalidateStoreCache?.();
    const settings = (await getStoreMeta()).settings as Record<string, unknown>;
    expect(settings).toMatchObject({
      storeName: "بنانتو",
      banana_reward_rate: 6.8,
      referral: { enabled: true, stackWithCoupon: false },
      deliveryBase: 6000,
      deliveryExceptions: [{ city: "البصرة", price: 7000 }],
    });
  });

  it("still replaces a section that is not settings", async () => {
    await save({ banners: [{ id: "b1", image: "https://cdn.example/a.webp" }] });
    await save({ banners: [] });
    const { getStoreMeta, invalidateStoreCache } = await import("@/lib/db.server");
    invalidateStoreCache?.();
    expect((await getStoreMeta()).banners ?? []).toEqual([]);
  });
});
