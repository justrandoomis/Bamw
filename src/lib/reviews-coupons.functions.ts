import { createServerFn } from "@tanstack/react-start";
import { readCouponUsage } from "./coupon-usage.server";
import { z } from "zod";
import {
  d1All,
  d1First,
  d1Run,
  d1Batch,
  randomId,
  createAuditLog,
  findUserById,
} from "./db.server";
import { requireAppAuth, requireAdmin, authed } from "./auth.middleware";
import {
  COUPON_REFUSAL_MESSAGE,
  checkCoupon,
  couponDiscount,
  rowToCoupon,
  type CouponRow,
} from "./coupons";
import type { ProductReview, Coupon } from "./types";

/**
 * Submit a review for a product linked to an order.
 */
export const submitProductReview = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator(
    z.object({
      productId: z.string(),
      orderId: z.string(),
      rating: z.number().min(1).max(5),
      comment: z.string().min(5),
      screenshotUrl: z.string().optional(),
      instagramProofUrl: z.string().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const userId = authed(context).userId;
    const now = new Date().toISOString();

    const reviewId = randomId("rev");
    await d1Run(
      `INSERT INTO product_reviews (id, product_id, user_id, order_id, rating, comment, screenshot_url, instagram_proof_url, status, is_auto_review, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      reviewId,
      data.productId,
      userId,
      data.orderId,
      data.rating,
      data.comment,
      data.screenshotUrl || null,
      data.instagramProofUrl || null,
      now,
      now,
    );

    await createAuditLog(userId, "submit_review", "product_review", reviewId);
    return { success: true, reviewId };
  });

/**
 * Approve a review and grant a coupon if eligible.
 */
export const approveReview = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(
    z.object({
      reviewId: z.string(),
      couponSettings: z
        .object({
          discountType: z.enum(["percentage", "fixed"]),
          discountValue: z.number().positive(),
          expirationDays: z.number().default(7),
        })
        .optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const adminId = authed(context).userId;
    const now = new Date().toISOString();

    const review = await d1First<ProductReview>(
      `SELECT * FROM product_reviews WHERE id = ? AND status = 'pending'`,
      data.reviewId,
    );

    if (!review) throw new Error("Review not found or already processed");

    // Check Cooldown: Once per 7 days
    const cooldown = await d1First<{ last_rewarded_at: string }>(
      `SELECT last_rewarded_at FROM review_cooldowns WHERE user_id = ?`,
      review.userId,
    );

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const isEligibleForCoupon = !cooldown || cooldown.last_rewarded_at < sevenDaysAgo;

    let couponCode = null;

    // Start Batch
    const batch: { sql: string; params: unknown[] }[] = [
      {
        sql: `UPDATE product_reviews SET status = 'approved', approved_at = ?, approved_by = ?, updated_at = ? WHERE id = ?`,
        params: [now, adminId, now, data.reviewId],
      },
    ];

    if (isEligibleForCoupon && data.couponSettings) {
      couponCode = `REV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const expirationAt = new Date(
        Date.now() + data.couponSettings.expirationDays * 24 * 60 * 60 * 1000,
      ).toISOString();

      batch.push({
        sql: `INSERT INTO coupons (id, code, discount_type, discount_value, expiration_at, usage_limit, per_user_limit, eligible_users, is_active, created_at)
              VALUES (?, ?, ?, ?, ?, 1, 1, ?, 1, ?)`,
        params: [
          randomId("cpn"),
          couponCode,
          data.couponSettings.discountType,
          data.couponSettings.discountValue,
          expirationAt,
          JSON.stringify([review.userId]),
          now,
        ],
      });

      batch.push({
        sql: `INSERT INTO review_cooldowns (user_id, last_rewarded_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_rewarded_at = excluded.last_rewarded_at`,
        params: [review.userId, now],
      });
    }

    await d1Batch(batch);
    await createAuditLog(
      adminId,
      "approve_review",
      "product_review",
      data.reviewId,
      { oldStatus: "pending" },
      { newStatus: "approved", couponGranted: !!couponCode },
    );

    return { success: true, couponCode };
  });

/**
 * Validate a coupon code server-side.
 */
export const validateCoupon = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator(
    z.object({
      code: z.string(),
      orderAmount: z.number(),
      targetProductId: z.string().optional(),
      items: z.array(
        z.object({
          productId: z.string(),
          categoryId: z.string().optional().default(""),
          kind: z.string().optional(),
          unitPrice: z.number().optional(),
          quantity: z.number().optional(),
          title: z.string().optional(),
          /* The selection, so the cart preview agrees with checkout about an
             offline-account restriction. Advisory only: checkout re-reads it
             from the catalogue. */
          optionId: z.string().optional(),
          optionName: z.string().optional(),
          typeId: z.string().optional(),
          typeName: z.string().optional(),
          offerKind: z.string().optional(),
        }),
      ),
    }),
  )
  .handler(async ({ data, context }) => {
    const userId = authed(context).userId;

    const row = await d1First<CouponRow>(
      `SELECT * FROM coupons WHERE code = ? AND is_active = 1`,
      data.code.trim().toUpperCase(),
    );
    if (!row) return { valid: false, message: COUPON_REFUSAL_MESSAGE.inactive };

    // The row is snake_case; reading it as a `Coupon` shape
    const coupon = rowToCoupon(row);

    // Same counters checkout reads, so the cart can never promise a discount
    // checkout will then refuse.
    const [usage, lifetimeSingleItem] = await Promise.all([
      readCouponUsage(coupon.id, userId),
      d1First<{ total: number }>(
        `SELECT COUNT(*) as total FROM coupon_redemptions WHERE user_id = ? AND (coupon_type = 'single_item_percent' OR coupon_type = 'single_game_50')`,
        userId,
      ),
    ]);

    const verdict = checkCoupon({
      coupon,
      userId,
      orderAmount: data.orderAmount,
      items: data.items,
      globalUses: usage.globalUses,
      userUses: usage.userUses,
      lifetimeSingleItemUses: Number(lifetimeSingleItem?.total ?? 0),
      targetProductId: data.targetProductId,
    });
    if (!verdict.ok) {
      return { valid: false, message: COUPON_REFUSAL_MESSAGE[verdict.reason] };
    }

    const discountRes = couponDiscount(coupon, data.orderAmount, data.items, data.targetProductId);

    return {
      valid: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        eligibleProducts: coupon.eligibleProducts,
        onlyDigitalProducts: coupon.onlyDigitalProducts,
        isStackable: coupon.isStackable,
        oncePerUserLifetime: coupon.oncePerUserLifetime,
        ...(coupon.maxDiscountAmount !== undefined
          ? { maxDiscountAmount: coupon.maxDiscountAmount }
          : {}),
        discountAmount: discountRes.discount,
        targetProductId: discountRes.targetProductId
          ? String(discountRes.targetProductId)
          : undefined,
        targetTitle: discountRes.targetTitle,
        singleUnitPrice: discountRes.singleUnitPrice,
      },
    };
  });
