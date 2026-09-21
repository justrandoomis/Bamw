/**
 * @vitest-environment node
 */
/**
 * The weekly gate, against a real SQLite database rather than its source text.
 *
 * «مره واحده بالاسبوع للعميل وليس مره واحده لكل طلب» — so the thing to prove
 * is not that a customer gets one code per order, but that a customer who
 * reviews two orders in the same week is issued exactly one.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";
import type { Order } from "./types";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__REVIEW_GATE_TEST_D1__"] = db;

vi.mock("./env.server", () => ({
  env: () => undefined,
  getEnv: () => ({
    bananto: (globalThis as Record<string, unknown>)["__REVIEW_GATE_TEST_D1__"],
  }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

vi.mock("./telegram-notifications.server", () => ({ getUserTelegramChatId: async () => null }));
vi.mock("./telegram.server", () => ({
  escapeHtml: (value: string) => value,
  sendTelegramMessage: async () => ({ ok: true }),
  telegramMiniAppDeepLink: (path: string) => `https://example.test/${path}`,
}));
vi.mock("./notification-preferences.server", () => ({
  memberAllowsNotification: async () => true,
}));

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-09-01T00:00:00.000Z");
const at = (days: number) => new Date(T0 + days * DAY).toISOString();

let issueApprovedReviewReward: typeof import("./review-reward.server").issueApprovedReviewReward;

function order(id: string, userId: string): Order {
  return {
    id,
    code: `BN-${id}`,
    userId,
    userName: "Buyer",
    threadId: "",
    items: [],
    total: 10_000,
    currency: "IQD",
    status: "completed",
    paymentStatus: "paid",
    needsAddress: false,
    createdAt: at(0),
    updatedAt: at(0),
    events: [],
  };
}

const codesFor = (userId: string) =>
  db.raw
    .prepare(`SELECT coupon_code FROM review_rewards WHERE user_id = ? ORDER BY issued_at ASC`)
    .all(userId) as { coupon_code: string }[];

beforeAll(async () => {
  const { ensureSchema } = await import("./d1.server");
  await ensureSchema();
  ({ issueApprovedReviewReward } = await import("./review-reward.server"));
  // Warm the module's schema guard once, against this database.
  const { ensureReviewRewardSchema } = await import("./review-reward.server");
  await ensureReviewRewardSchema();
});

beforeEach(() => {
  for (const table of ["review_rewards", "review_reward_cooldowns", "coupons"]) {
    db.raw.exec(`DELETE FROM ${table}`);
  }
  db.reset();
});

describe("one code per customer per week", () => {
  it("issues the first one", async () => {
    const outcome = await issueApprovedReviewReward(order("ord1", "usr_a"), { now: at(0) });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reward.amountIqd).toBe(1000);
    expect(outcome.reward.code).toMatch(/^REV-/);
    // And the coupon exists, bound to that one customer.
    const coupon = db.raw
      .prepare(`SELECT eligible_users, usage_limit FROM coupons WHERE code = ?`)
      .get(outcome.reward.code) as { eligible_users: string; usage_limit: number };
    expect(JSON.parse(coupon.eligible_users)).toEqual(["usr_a"]);
    expect(coupon.usage_limit).toBe(1);
  });

  it("refuses a second order by the same customer inside the week", async () => {
    await issueApprovedReviewReward(order("ord1", "usr_a"), { now: at(0) });
    const second = await issueApprovedReviewReward(order("ord2", "usr_a"), { now: at(3) });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("cooldown");
    if (second.reason !== "cooldown") return;
    expect(second.nextEligibleAt).toBe(at(7));
    // The rule is per customer, so the second order has no entitlement at all.
    expect(codesFor("usr_a")).toHaveLength(1);
  });

  it("issues again once the week has passed", async () => {
    await issueApprovedReviewReward(order("ord1", "usr_a"), { now: at(0) });
    const later = await issueApprovedReviewReward(order("ord2", "usr_a"), { now: at(7) });

    expect(later.ok).toBe(true);
    expect(codesFor("usr_a")).toHaveLength(2);
  });

  it("does not let one customer's week block another's", async () => {
    await issueApprovedReviewReward(order("ord1", "usr_a"), { now: at(0) });
    const other = await issueApprovedReviewReward(order("ord2", "usr_b"), { now: at(1) });

    expect(other.ok).toBe(true);
    expect(codesFor("usr_b")).toHaveLength(1);
  });

  it("returns the same code when the same order is approved twice", async () => {
    const first = await issueApprovedReviewReward(order("ord1", "usr_a"), { now: at(0) });
    const again = await issueApprovedReviewReward(order("ord1", "usr_a"), { now: at(1) });

    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.reward.code).toBe(first.reward.code);
    expect(again.alreadyIssued).toBe(true);
    /*
      And it did not spend the week again: a re-approval of the same order is
      not a second reward, so the customer's next order is still gated by the
      original claim rather than by this one.
    */
    const claim = db.raw
      .prepare(`SELECT last_issued_at FROM review_reward_cooldowns WHERE user_id = ?`)
      .get("usr_a") as { last_issued_at: string };
    expect(claim.last_issued_at).toBe(at(0));
  });

  it("gives the week back when nothing was minted", async () => {
    /*
      The claim is taken before the coupon exists. If the mint then fails and
      the claim stayed, the customer would be locked out for a week having
      received nothing — the worst of both outcomes.
    */
    const failed = await issueApprovedReviewReward(
      { ...order("ord1", "usr_a"), status: "processing" },
      { now: at(0) },
    );
    expect(failed.ok).toBe(false);

    const rows = db.raw
      .prepare(`SELECT COUNT(*) AS n FROM review_reward_cooldowns WHERE user_id = ?`)
      .get("usr_a") as { n: number };
    expect(rows.n).toBe(0);

    // And the very next approval works.
    const next = await issueApprovedReviewReward(order("ord2", "usr_a"), { now: at(0) });
    expect(next.ok).toBe(true);
  });

  it("issues for an order still awaiting confirmation", async () => {
    /*
      The thirty-minute trigger asks for the review before the sixty-minute
      timer completes the order. An approval that minted nothing there would
      tell the admin it worked while the customer got no code.
    */
    const outcome = await issueApprovedReviewReward(
      { ...order("ord1", "usr_a"), status: "awaiting_customer_confirmation" },
      { now: at(0) },
    );
    expect(outcome.ok).toBe(true);
  });
});
