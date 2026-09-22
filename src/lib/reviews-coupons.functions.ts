import { createServerFn } from "@tanstack/react-start";
import { readCouponUsage } from "./coupon-usage.server";
import { z } from "zod";
import { d1First } from "./db.server";
import { requireAppAuth, authed } from "./auth.middleware";
import {
  COUPON_REFUSAL_MESSAGE,
  checkCoupon,
  couponDiscount,
  rowToCoupon,
  type CouponRow,
} from "./coupons";

/*
  `submitProductReview` and `approveReview` were here, and nothing imported
  either of them. Production agrees: `review_cooldowns`, the only table
  `approveReview` ever wrote, holds zero rows.

  They are gone rather than rewired because what they did is now wrong as well
  as dead. `approveReview` minted a coupon from `Math.random()`, took the
  discount from whatever the caller passed, and checked a cooldown table
  nothing else maintained; the reward is now minted by
  `issueApprovedReviewReward`, which is the only place the weekly limit is
  enforced. The submission is `submitOrderReviewGroup`, which writes one row
  per product tied by a group id and demands the Instagram proof.

  See `/api/admin/review-submissions` and `/api/order-review`.
*/

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
