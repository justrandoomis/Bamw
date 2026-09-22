import { createFileRoute } from "@tanstack/react-router";

import { d1All, d1First, d1Run, ensureSchema, getD1 } from "@/lib/d1.server";
import { body, guard, json } from "@/lib/http.server";
import {
  ensureReviewsSchema,
  findCompletedPurchase,
  publishVerifiedReview,
  type ProductReviewRow,
} from "@/lib/reviews.server";
import { getSessionUser, requireAdmin, requireUser } from "@/lib/session.server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";
import { isOwnReviewImageUrl } from "@/lib/uploads";

type ReviewRow = ProductReviewRow & { is_buyer?: number | boolean };

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export const Route = createFileRoute("/api/reviews")({
  server: {
    handlers: {
      /**
       * `?productId=` → approved reviews for one product + user's own review if signed in.
       * `?scope=all`  → every review (admin moderation).
       * default       → the signed-in member's own reviews.
       */
      GET: async ({ request }) =>
        guard(async () => {
          if (!getD1()) return json({ reviews: [], summary: { count: 0, average: 0 } });
          await ensureSchema();
          await ensureReviewsSchema();
          const url = new URL(request.url);
          const productId = url.searchParams.get("productId");
          const scope = url.searchParams.get("scope");
          const user = await getSessionUser(request);

          let rows: ReviewRow[] = [];
          let myReview: ReviewRow | null = null;

          if (productId) {
            rows = await d1All<ReviewRow>(
              `SELECT r.*, u.name AS user_name FROM product_reviews r
               LEFT JOIN users u ON u.id = r.user_id
               WHERE r.product_id = ? AND r.status = 'approved' AND r.review_due_at IS NULL
               ORDER BY r.created_at DESC LIMIT 100`,
              productId,
            );

            if (user) {
              const myRows = await d1All<ReviewRow>(
                `SELECT r.*, u.name AS user_name FROM product_reviews r
                 LEFT JOIN users u ON u.id = r.user_id
                 WHERE r.product_id = ? AND r.user_id = ? AND r.review_due_at IS NULL
                 ORDER BY r.created_at DESC LIMIT 1`,
                productId,
                user.id,
              );
              if (myRows.length > 0 && myRows[0]) {
                myReview = myRows[0];
              }
            }
          } else if (scope === "all") {
            await requireAdmin(request);
            rows = await d1All<ReviewRow>(
              `SELECT r.*, u.name AS user_name FROM product_reviews r
               LEFT JOIN users u ON u.id = r.user_id
               ORDER BY r.created_at DESC LIMIT 500`,
            );
          } else if (user) {
            rows = await d1All<ReviewRow>(
              `SELECT * FROM product_reviews
               WHERE user_id = ? AND review_due_at IS NULL
               ORDER BY created_at DESC LIMIT 100`,
              user.id,
            );
          }

          const count = rows.length;
          const average = count
            ? Math.round((rows.reduce((sum, r) => sum + Number(r.rating || 0), 0) / count) * 10) /
              10
            : 0;

          const visibleRows = productId
            ? rows.map((row) => ({
                id: row.id,
                product_id: row.product_id,
                rating: row.rating,
                comment: row.comment,
                screenshot_url: row.screenshot_url ?? null,
                created_at: row.created_at,
                is_buyer: row.approved_by === "system:verified_purchase",
                user_name: row.user_name ?? null,
              }))
            : rows;

          return json({
            reviews: visibleRows,
            myReview: myReview
              ? {
                  id: myReview.id,
                  product_id: myReview.product_id,
                  rating: myReview.rating,
                  comment: myReview.comment,
                  screenshot_url: myReview.screenshot_url ?? null,
                  status: myReview.status,
                  is_buyer: myReview.approved_by === "system:verified_purchase",
                  created_at: myReview.created_at,
                  user_name: myReview.user_name ?? null,
                }
              : null,
            summary: { count, average },
          });
        }),

      /** A completed-order buyer posts (or updates) a verified review. */
      POST: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          const throttle = await consumeRateLimit(
            request,
            "review-submit",
            10,
            24 * 60 * 60,
            user.id,
          );
          if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);
          if (!getD1()) return json({ error: "قاعدة البيانات غير متاحة" }, { status: 503 });
          await ensureSchema();
          await ensureReviewsSchema();
          const input = await body<Record<string, unknown>>(request);
          const productId = clean(input["productId"], 120);
          const rawRating = Number(input["rating"]);
          const rating = Number.isFinite(rawRating) ? Math.round(rawRating) : 0;
          const comment = clean(input["comment"], 1200);
          const requestedOrderId = clean(input["orderId"], 80);
          const imageWasProvided =
            Object.prototype.hasOwnProperty.call(input, "imageUrl") ||
            Object.prototype.hasOwnProperty.call(input, "screenshotUrl");
          const screenshotUrl = clean(input["imageUrl"] ?? input["screenshotUrl"], 1000);
          if (!productId || rating < 1 || rating > 5) {
            return json({ error: "المنتج والتقييم مطلوبان" }, { status: 400 });
          }
          if (imageWasProvided && screenshotUrl && !isOwnReviewImageUrl(screenshotUrl, user.id)) {
            return json({ error: "صورة التقييم غير صالحة" }, { status: 400 });
          }

          const purchase = await findCompletedPurchase(
            user.id,
            productId,
            requestedOrderId || undefined,
          );
          if (!purchase.ok) {
            const status = purchase.reason === "order_not_completed" ? 409 : 403;
            const message =
              purchase.reason === "order_not_completed"
                ? "يمكن نشر التقييم بعد اكتمال الطلب فقط"
                : purchase.reason === "product_not_in_order"
                  ? "هذا المنتج غير موجود في الطلب المحدد"
                  : "التقييم الموثق متاح فقط لمشتري المنتج بعد اكتمال الطلب";
            return json({ error: purchase.reason, message }, { status });
          }

          const review = await publishVerifiedReview({
            userId: user.id,
            orderId: purchase.order.id,
            productId,
            rating,
            comment,
            ...(imageWasProvided ? { screenshotUrl: screenshotUrl || null } : {}),
          });

          /*
            No reward from here. This endpoint publishes a plain star rating —
            `ProductReviews.tsx` still posts to it — and a code is earned only
            through the two-step submission an admin approves. Minting here
            would leave a door that skips the Instagram proof *and* the admin.
          */
          return json({
            ok: true,
            status: "approved",
            isBuyer: true,
            review: {
              id: review.id,
              product_id: review.product_id,
              order_id: review.order_id,
              rating: review.rating,
              comment: review.comment,
              screenshot_url: review.screenshot_url,
              status: review.status,
              created_at: review.created_at,
            },
          });
        }),

      /** Admin moderation: approve / hide / delete. */
      PATCH: async ({ request }) =>
        guard(async () => {
          const admin = await requireAdmin(request);
          await ensureSchema();
          await ensureReviewsSchema();
          const input = await body<Record<string, unknown>>(request);
          const id = clean(input["id"], 80);
          const action = clean(input["action"], 20);
          if (!id) return json({ error: "معرّف غير صالح" }, { status: 400 });
          if (action === "delete") {
            await d1Run(`DELETE FROM product_reviews WHERE id = ?`, id);
          } else {
            const review = await d1First<ProductReviewRow>(
              `SELECT * FROM product_reviews WHERE id = ?`,
              id,
            );
            if (action !== "hide" && review) {
              const purchase = await findCompletedPurchase(
                review.user_id,
                review.product_id,
                review.order_id || undefined,
              );
              if (purchase.ok) {
                await publishVerifiedReview({
                  userId: review.user_id,
                  orderId: purchase.order.id,
                  productId: review.product_id,
                  rating: Math.max(1, Math.min(5, Math.round(Number(review.rating) || 0))),
                  comment: review.comment || "",
                  screenshotUrl: review.screenshot_url || null,
                });
                return json({ ok: true, verified: true });
              }
            }
            const nextStatus = action === "hide" ? "hidden" : "approved";
            const approvedAt = nextStatus === "approved" ? new Date().toISOString() : null;
            await d1Run(
              `UPDATE product_reviews
               SET status = ?, approved_at = ?, approved_by = ?, updated_at = ?
               WHERE id = ?`,
              nextStatus,
              approvedAt,
              nextStatus === "approved" ? `admin:${admin.id}` : null,
              new Date().toISOString(),
              id,
            );
          }
          return json({ ok: true });
        }),
    },
  },
});
