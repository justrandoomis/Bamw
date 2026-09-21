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
    expect(payload.reward).toMatchObject({ amountIqd: 1000 });
    expect(payload.reward.code).toMatch(/^REV-/);

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

    const couponRow = db.raw
      .prepare(`SELECT * FROM coupons WHERE code = ?`)
      .get(payload.reward.code);
    expect(couponRow).toBeTruthy();
    const { rowToCoupon, checkCoupon } = await import("@/lib/coupons");
    const coupon = rowToCoupon(couponRow);
    const cart = [{ productId: "anything", unitPrice: 10_000, quantity: 1, kind: "account" }];
    expect(
      checkCoupon({
        coupon,
        userId: "usr_buyer",
        orderAmount: 10_000,
        items: cart,
        globalUses: 0,
        userUses: 0,
      }),
    ).toMatchObject({ ok: true });
    expect(
      checkCoupon({
        coupon,
        userId: "usr_other",
        orderAmount: 10_000,
        items: cart,
        globalUses: 0,
        userUses: 0,
      }),
    ).toEqual({ ok: false, reason: "not_eligible" });
  });

  it("returns the approved review image to the public product and the admin", async () => {
    seedOrder({});
    const imageUrl = "/api/files/reviews/usr_buyer/review-image.webp";
    await post({ productId: "prd_game", orderId: "ord_1", rating: 4, imageUrl });

    viewer = undefined;
    const publicResponse = await get("?productId=prd_game");
    const publicPayload = (await publicResponse.json()) as any;
    expect(publicPayload.reviews).toHaveLength(1);
    expect(publicPayload.reviews[0].screenshot_url).toBe(imageUrl);

    viewer = { id: "usr_admin", isAdmin: true };
    const adminResponse = await get("?scope=all");
    const adminPayload = (await adminResponse.json()) as any;
    expect(adminPayload.reviews).toHaveLength(1);
    expect(adminPayload.reviews[0].screenshot_url).toBe(imageUrl);
  });

  it("promotes the matching legacy placeholder instead of showing or duplicating it", async () => {
    seedOrder({});
    db.raw
      .prepare(
        `INSERT INTO product_reviews
           (id, product_id, user_id, order_id, rating, comment, status, is_auto_review,
            review_due_at, created_at, updated_at)
         VALUES ('rev_placeholder', 'prd_game', 'usr_buyer', 'ord_1', 5, '', 'pending', 0,
                 '2026-09-23T12:00:00.000Z', ?, ?)`,
      )
      .run(now, now);

    const before = await get("?productId=prd_game");
    const beforePayload = (await before.json()) as any;
    expect(beforePayload.reviews).toHaveLength(0);
    expect(beforePayload.myReview).toBeNull();

    const response = await post({
      productId: "prd_game",
      orderId: "ord_1",
      rating: 3,
      comment: "تمت كتابة الرأي فعلاً",
    });
    expect(response.status).toBe(200);
    const rows = db.raw.prepare(`SELECT * FROM product_reviews`).all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "rev_placeholder",
      rating: 3,
      status: "approved",
      review_due_at: null,
    });
  });

  it("is idempotent across a retried submission", async () => {
    seedOrder({});
    const input = { productId: "prd_game", orderId: "ord_1", rating: 5, comment: "ممتاز" };
    const first = (await (await post(input)).json()) as any;
    const second = (await (await post(input)).json()) as any;

    expect(second.reward.code).toBe(first.reward.code);
    expect((db.raw.prepare(`SELECT COUNT(*) AS n FROM product_reviews`).get() as any).n).toBe(1);
    expect((db.raw.prepare(`SELECT COUNT(*) AS n FROM review_rewards`).get() as any).n).toBe(1);
    expect((db.raw.prepare(`SELECT COUNT(*) AS n FROM coupons`).get() as any).n).toBe(1);
  });

  it("repairs a legacy reward coupon whose old row used a code-derived id", async () => {
    seedOrder({});
    const input = { productId: "prd_game", orderId: "ord_1", rating: 5 };
    const first = (await (await post(input)).json()) as any;
    db.raw
      .prepare(`UPDATE coupons SET id = ? WHERE code = ?`)
      .run(`cpn_${first.reward.code}`, first.reward.code);

    const second = (await (await post(input)).json()) as any;

    expect(second.reward.code).toBe(first.reward.code);
    expect((db.raw.prepare(`SELECT COUNT(*) AS n FROM coupons`).get() as any).n).toBe(1);
    expect(
      db.raw.prepare(`SELECT discount_value FROM coupons WHERE code = ?`).get(first.reward.code),
    ).toMatchObject({ discount_value: 1000 });
  });

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

  it("publishes a genuine legacy pending review and rewards it without duplicating the row", async () => {
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
    expect((db.raw.prepare(`SELECT COUNT(*) AS n FROM review_rewards`).get() as any).n).toBe(1);
  });

  it("repairs the reward entitlement for an order completed before the unified flow", async () => {
    seedOrder({});
    const { reconcileCompletedOrderReviewFollowups } =
      await import("@/lib/order-completion.server");

    const result = await reconcileCompletedOrderReviewFollowups(now);

    expect(result).toMatchObject({ scanned: 1, repaired: 1, errors: 0 });
    const reward = db.raw
      .prepare(`SELECT user_id, amount_iqd FROM review_rewards WHERE order_id = 'ord_1'`)
      .get() as any;
    expect(reward).toMatchObject({ user_id: "usr_buyer", amount_iqd: 1000 });
  });
});
