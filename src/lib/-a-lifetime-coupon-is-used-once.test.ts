/**
 * @vitest-environment node
 */
/**
 * «مرة واحدة في العمر» means once, including under a race.
 *
 * `checkCoupon` refuses a lifetime-only coupon as soon as the member has used
 * it — «It caps the member at one use regardless of `perUserLimit`». But that
 * is a READ, and reads do not decide anything: `claimCouponUse` is the only
 * statement that consumes a use, and it was handed `perUserLimit`.
 *
 * So a coupon flagged lifetime-only with a per-user limit of three was enforced
 * at ONE by the validator and at THREE by the claim. Two checkouts in the same
 * second both read `userUses = 0`, both pass the validator, and both claim —
 * 0→1 and then 1→2 — and the member has spent their once-in-a-lifetime coupon
 * twice.
 *
 * Run against the claim itself, on real SQLite, because the whole question is
 * what happens when two writers reach one row.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__TEST_D1__"] = db;

vi.mock("@/lib/env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__TEST_D1__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

let usage: typeof import("./coupon-usage.server");

const COUPON = "cpn_lifetime";
const MEMBER = "usr_lifetime";

beforeAll(async () => {
  const { ensureSchema } = await import("@/lib/d1.server");
  await ensureSchema();
  usage = await import("./coupon-usage.server");
});

beforeEach(async () => {
  const { d1Run } = await import("@/lib/d1.server");
  await d1Run(`DELETE FROM coupon_user_usage WHERE coupon_id = ?`, COUPON);
  await d1Run(`DELETE FROM coupons WHERE id = ?`, COUPON);
  await d1Run(
    `INSERT INTO coupons (id, code, discount_type, discount_value, is_active, created_at)
     VALUES (?, ?, 'percent', 10, 1, ?)`,
    COUPON,
    "LIFETIME10",
    "2026-01-01T00:00:00.000Z",
  );
});

async function uses(): Promise<number> {
  const { d1First } = await import("@/lib/d1.server");
  const row = await d1First<{ uses: number }>(
    `SELECT uses FROM coupon_user_usage WHERE coupon_id = ? AND user_id = ?`,
    COUPON,
    MEMBER,
  );
  return Number(row?.uses ?? 0);
}

describe("the claim is what decides", () => {
  it("lets a lifetime coupon through exactly once", async () => {
    const first = await usage.claimCouponUse({ couponId: COUPON, userId: MEMBER, perUserLimit: 1 });
    const second = await usage.claimCouponUse({
      couponId: COUPON,
      userId: MEMBER,
      perUserLimit: 1,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("per_user_limit");
    expect(await uses()).toBe(1);
  });

  /*
    THE RACE, RUN. Two checkouts that both read `userUses = 0` and both reach
    the claim. Exactly one may win — that is the whole point of the claim being
    a conditional write rather than a check followed by a write.
  */
  it("lets exactly one of two simultaneous checkouts win", async () => {
    const [a, b] = await Promise.all([
      usage.claimCouponUse({ couponId: COUPON, userId: MEMBER, perUserLimit: 1 }),
      usage.claimCouponUse({ couponId: COUPON, userId: MEMBER, perUserLimit: 1 }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await uses()).toBe(1);
  });

  /*
    And the fault this test exists for: the claim used to be handed the
    coupon's `perUserLimit`, so a lifetime coupon that also carried a limit of
    three was claimable three times. With the limit passed as 3 the claim really
    does allow three — which is exactly why the CALLER must pass 1.
  */
  it("would allow three if handed a per-user limit of three", async () => {
    for (let i = 0; i < 3; i++) {
      expect(
        (await usage.claimCouponUse({ couponId: COUPON, userId: MEMBER, perUserLimit: 3 })).ok,
      ).toBe(true);
    }
    expect(await uses()).toBe(3);
  });

  it("an ordinary coupon still gets the uses its limit allows", async () => {
    expect(
      (await usage.claimCouponUse({ couponId: COUPON, userId: MEMBER, perUserLimit: 2 })).ok,
    ).toBe(true);
    expect(
      (await usage.claimCouponUse({ couponId: COUPON, userId: MEMBER, perUserLimit: 2 })).ok,
    ).toBe(true);
    expect(
      (await usage.claimCouponUse({ couponId: COUPON, userId: MEMBER, perUserLimit: 2 })).ok,
    ).toBe(false);
  });
});

describe("the checkout passes the number the validator applies", () => {
  it("claims a lifetime coupon at one, not at its per-user limit", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const orders = readFileSync(path.resolve(__dirname, "orders.server.ts"), "utf8");
    expect(orders).toContain("perUserLimit: couponCandidate.coupon.oncePerUserLifetime");
    expect(orders).not.toContain(
      "      perUserLimit: couponCandidate.coupon.perUserLimit,\n      totalLimit:",
    );
  });
});
