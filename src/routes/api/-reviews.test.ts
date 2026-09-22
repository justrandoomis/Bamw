/**
 * @vitest-environment node
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__TEST_D1__"] = db;

let viewer: { id: string; isAdmin?: boolean } | undefined = { id: "usr_buyer" };

vi.mock("@/lib/env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__TEST_D1__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

vi.mock("@/lib/session.server", () => ({
  getSessionUser: vi.fn(async () => viewer),
  requireUser: vi.fn(async () => {
    if (!viewer) throw new Response("unauthorized", { status: 401 });
    return viewer;
  }),
  requireAdmin: vi.fn(async () => {
    if (!viewer?.isAdmin) throw new Response("forbidden", { status: 403 });
    return viewer;
  }),
}));

vi.mock("@/lib/rate-limit.server", () => ({
  consumeRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

vi.mock("@/lib/telegram-notifications.server", () => ({
  getUserTelegramChatId: vi.fn(async () => null),
}));

let route: typeof import("./reviews");

type Handler = (ctx: { request: Request }) => Promise<Response>;
const handlers = () =>
  route.Route.options.server!.handlers as unknown as {
    GET: Handler;
    POST: Handler;
    PATCH: Handler;
  };

const post = (payload: Record<string, unknown>) =>
  handlers().POST({
    request: new Request("https://banan.to/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  });

const get = (query: string) =>
  handlers().GET({ request: new Request(`https://banan.to/api/reviews${query}`) });

const now = "2026-09-20T12:00:00.000Z";

function seedOrder(input: { id?: string; userId?: string; productId?: string; status?: string }) {
  const id = input.id ?? "ord_1";
  const userId = input.userId ?? "usr_buyer";
  const productId = input.productId ?? "prd_game";
  const status = input.status ?? "completed";
  const order = {
    id,
    code: `BN-${id}`,
    userId,
    userName: "المشتري",
    items: [
      {
        id: `itm_${id}`,
        productId,
        title: "Nintendo Game",
        kind: "account",
        quantity: 1,
        unitPrice: 10_000,
      },
    ],
    total: 10_000,
    currency: "IQD",
    status,
    paymentStatus: "paid",
    createdAt: now,
    updatedAt: now,
    events: [],
  };
  db.raw
    .prepare(
      `INSERT INTO orders
         (id, code, user_id, doc, status, payment_status, total, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'paid', 10000, ?, ?)`,
    )
    .run(id, order.code, userId, JSON.stringify(order), status, now, now);
  db.raw
    .prepare(
      `INSERT INTO order_items_snapshot
         (id, order_id, product_id, title, price_iqd, quantity, options_json, created_at)
       VALUES (?, ?, ?, 'Nintendo Game', 10000, 1, '{}', ?)`,
    )
    .run(`snap_${id}`, id, productId, now);
  return order;
}

/**
 * How many rows a table holds, or zero when the table was never created.
 *
 * `review_rewards` and `coupons` are made lazily by whatever mints a reward.
 * Now that nothing on this endpoint does, the tables can legitimately be
 * absent — and "absent" is the strongest form of "nothing was minted", so it
 * must read as zero rather than throw.
 */
function countRows(table: string): number {
  try {
    return (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  } catch {
    return 0;
  }
}

beforeAll(async () => {
  const { ensureSchema } = await import("@/lib/d1.server");
  await ensureSchema();
  route = await import("./reviews");
});

beforeEach(() => {
  for (const table of [
    "review_rewards",
    "coupon_user_usage",
    "coupon_redemptions",
    "coupons",
    "product_reviews",
    "order_items_snapshot",
    "orders",
    "users",
  ]) {
    try {
      db.raw.exec(`DELETE FROM ${table}`);
    } catch {
      // review_rewards is created lazily on the first submission.
    }
  }
  db.raw
    .prepare(
      `INSERT INTO users
         (id, name, email, password_hash, username, is_admin, provider, settings,
          addresses, favorites, created_at)
       VALUES (?, ?, ?, 'x', ?, ?, 'password', '{}', '[]', '[]', ?)`,
    )
    .run("usr_buyer", "المشتري", "buyer@example.com", "buyer", 0, now);
  db.raw
    .prepare(
      `INSERT INTO users
         (id, name, email, password_hash, username, is_admin, provider, settings,
          addresses, favorites, created_at)
       VALUES (?, ?, ?, 'x', ?, ?, 'password', '{}', '[]', '[]', ?)`,
    )
    .run("usr_other", "آخر", "other@example.com", "other", 0, now);
  db.raw
    .prepare(
      `INSERT INTO users
         (id, name, email, password_hash, username, is_admin, provider, settings,
          addresses, favorites, created_at)
       VALUES (?, ?, ?, 'x', ?, ?, 'password', '{}', '[]', '[]', ?)`,
    )
    .run("usr_admin", "المدير", "admin@example.com", "admin", 1, now);
  viewer = { id: "usr_buyer" };
});

describe("verified review publication", () => {
  it("publishes a completed buyer review, preserves its image, and returns a usable 1,000 IQD code", async () => {
    seedOrder({});
    const imageUrl = "/api/files/reviews/usr_buyer/abc123.webp";

    const response = await post({
      productId: "prd_game",
      orderId: "ord_1",
      rating: 5,
      comment: "تجربة ممتازة",
      imageUrl,
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as any;

    expect(payload.status).toBe("approved");
    expect(payload.isBuyer).toBe(true);
    expect(payload.review.screenshot_url).toBe(imageUrl);
    /*
      No code from this endpoint any more.

      It publishes a plain star rating, which is what `ProductReviews.tsx`
      posts. A code is earned through the two-step submission an admin
      approves; minting here would be a door that skips both the Instagram
      proof and the admin.
    */
    expect(payload.reward).toBeUndefined();
    expect(countRows("review_rewards")).toBe(0);
    expect(countRows("coupons")).toBe(0);

    const stored = db.raw
      .prepare(
        `SELECT status, order_id, screenshot_url, review_due_at, approved_by
         FROM product_reviews`,
      )
      .get() as any;
    expect(stored).toMatchObject({
      status: "approved",
      order_id: "ord_1",
      screenshot_url: imageUrl,
      review_due_at: null,
      approved_by: "system:verified_purchase",
    });
  });

  it("is idempotent across a retried submission", async () => {
    seedOrder({});
    const input = { productId: "prd_game", orderId: "ord_1", rating: 5, comment: "ممتاز" };
    const first = (await (await post(input)).json()) as any;
    const second = (await (await post(input)).json()) as any;

    expect(second.review.id).toBe(first.review.id);
    expect((db.raw.prepare(`SELECT COUNT(*) AS n FROM product_reviews`).get() as any).n).toBe(1);
    // Retried or not, this endpoint mints nothing.
    expect(countRows("review_rewards")).toBe(0);
    expect(countRows("coupons")).toBe(0);
  });

  /*
    The "repairs a legacy reward coupon" case was removed with the mint it
    tested: this endpoint no longer creates or repairs a coupon, so there is
    nothing here to exercise. The repair itself still exists and is still
    reached — from `issueApprovedReviewReward`, on an admin's approval — and is
    covered there.
  */

  it("rejects unfinished, foreign, and product-mismatched orders", async () => {
    seedOrder({ id: "ord_waiting", status: "processing" });
    expect((await post({ productId: "prd_game", orderId: "ord_waiting", rating: 5 })).status).toBe(
      409,
    );

    seedOrder({ id: "ord_other", userId: "usr_other" });
    expect((await post({ productId: "prd_game", orderId: "ord_other", rating: 5 })).status).toBe(
      403,
    );

    seedOrder({ id: "ord_different", productId: "prd_other" });
    expect(
      (await post({ productId: "prd_game", orderId: "ord_different", rating: 5 })).status,
    ).toBe(403);

    expect((db.raw.prepare(`SELECT COUNT(*) AS n FROM product_reviews`).get() as any).n).toBe(0);
  });

  it("refuses a review image uploaded by another member", async () => {
    seedOrder({});
    const response = await post({
      productId: "prd_game",
      orderId: "ord_1",
      rating: 5,
      imageUrl: "/api/files/reviews/usr_other/stolen.webp",
    });
    expect(response.status).toBe(400);
    expect((db.raw.prepare(`SELECT COUNT(*) AS n FROM product_reviews`).get() as any).n).toBe(0);
  });

  it("still publishes a genuine legacy pending review — and pays nothing for it", async () => {
    seedOrder({});
    db.raw
      .prepare(
        `INSERT INTO product_reviews
           (id, product_id, user_id, order_id, rating, comment, status, is_auto_review,
            review_due_at, created_at, updated_at)
         VALUES ('rev_legacy_real', 'prd_game', 'usr_buyer', NULL, 4, 'رأي قديم حقيقي',
                 'pending', 0, NULL, ?, ?)`,
      )
      .run(now, now);

    const { reconcilePendingVerifiedReviews } = await import("@/lib/reviews.server");
    const result = await reconcilePendingVerifiedReviews();

    expect(result).toMatchObject({ scanned: 1, published: 1, errors: 0 });
    const reviews = db.raw.prepare(`SELECT * FROM product_reviews`).all() as any[];
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      id: "rev_legacy_real",
      order_id: "ord_1",
      status: "approved",
      approved_by: "system:verified_purchase",
    });
    /*
      The legacy row still publishes — members who rated before the popup
      existed keep their reviews — but a cron no longer hands out a 1,000 IQD
      code for finding one.
    */
    expect(countRows("review_rewards")).toBe(0);
    expect(countRows("coupons")).toBe(0);
  });

  it("leaves a submission from the popup alone, and still takes the legacy row", async () => {
    /*
      THE guard for the owner's requirement.

      This cron runs every minute, publishes what it selects as approved, and
      used to mint a coupon for it. A review submitted through the two-step
      popup must be invisible to it, or the admin's approval queue empties
      itself within sixty seconds and the coupons are gone before anyone sees
      the card. Two independent guards keep it out — the distinct status and
      the group id — and this test fails if either is removed.
    */
    seedOrder({});
    db.raw
      .prepare(
        `INSERT INTO product_reviews
           (id, product_id, user_id, order_id, rating, comment, status, is_auto_review,
            review_group_id, review_due_at, created_at, updated_at)
         VALUES ('rev_from_popup', 'prd_game', 'usr_buyer', 'ord_1', 5, 'تسليم ممتاز',
                 'pending', 0, 'rev_grp_abc', NULL, ?, ?)`,
      )
      .run(now, now);
    db.raw
      .prepare(
        `INSERT INTO product_reviews
           (id, product_id, user_id, order_id, rating, comment, status, is_auto_review,
            review_group_id, review_due_at, created_at, updated_at)
         VALUES ('rev_legacy', 'prd_game2', 'usr_buyer', NULL, 4, 'رأي قديم',
                 'pending', 0, NULL, NULL, ?, ?)`,
      )
      .run(now, now);

    const { reconcilePendingVerifiedReviews } = await import("@/lib/reviews.server");
    await reconcilePendingVerifiedReviews();

    const popup = db.raw
      .prepare(`SELECT status, approved_by, approved_at FROM product_reviews WHERE id = ?`)
      .get("rev_from_popup") as any;
    expect(popup).toMatchObject({ status: "pending", approved_by: null, approved_at: null });
    expect(countRows("review_rewards")).toBe(0);
    expect(countRows("coupons")).toBe(0);
  });

  it("repairs the reward entitlement for an order completed before the unified flow", async () => {
    seedOrder({});
    const { reconcileCompletedOrderReviewFollowups } =
      await import("@/lib/order-completion.server");

    const result = await reconcileCompletedOrderReviewFollowups(now);

    /*
      The amplifier, defused.

      This query used to also match "an order with no reward row". That was a
      sound question while completion minted a reward — a missing row meant a
      missed completion — and it stopped being sound the moment the code became
      something an admin issues: nearly every completed order the shop has ever
      taken has no reward row, forever, so the every-minute cron would re-run
      the whole completion path on a fresh batch of them without end.

      What remains is the question still worth asking: was this customer ever
      invited to rate the order. An order with no conversation cannot be
      invited, so it is not scanned, and nothing is minted either way.
    */
    expect(result).toMatchObject({ scanned: 0, repaired: 0, errors: 0 });
    expect(countRows("review_rewards")).toBe(0);
  });
});
