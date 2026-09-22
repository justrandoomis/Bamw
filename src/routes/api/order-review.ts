import { createFileRoute } from "@tanstack/react-router";

import { getStoreMeta } from "@/lib/db.server";
import { d1All, d1First, getD1 } from "@/lib/d1.server";
import { body, guard, json } from "@/lib/http.server";
import { mergeContent, safeHttpUrl } from "@/lib/content";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";
import {
  REVIEW_COMMENT_MAX,
  REVIEW_COMMENT_MIN,
  ensureReviewsSchema,
  submitOrderReviewGroup,
} from "@/lib/reviews.server";
import { requireUser } from "@/lib/session.server";
import type { StoreDoc } from "@/lib/types";

/**
 * The two-step review the customer fills in, and what the sheet needs to draw
 * it: which products are being reviewed, where the Instagram post is, and
 * whether they already sent one.
 *
 * Nothing here issues a code. The submission lands as `awaiting_admin` and an
 * admin decides — which is the whole point of the change: the code is earned,
 * not handed out by a timer.
 */

/** The shop's pinned post, and the words the owner wants on each step. */
async function reviewPrompt() {
  const store = (await getStoreMeta()) as StoreDoc & { content?: unknown };
  const content = mergeContent(store.content);
  const prompt = content.reviewPrompt;
  return {
    // `safeHttpUrl` so an admin typo cannot put a `javascript:` link on a
    // button the customer is told to press.
    instagramPostUrl: safeHttpUrl(prompt?.instagram_post_url ?? ""),
    stepOneNote: prompt?.step_one_note_ar ?? "",
    stepTwoNote: prompt?.step_two_note_ar ?? "",
  };
}

export const Route = createFileRoute("/api/order-review")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          const orderId = new URL(request.url).searchParams.get("orderId") || "";
          if (!getD1() || !orderId) {
            return json({ error: "الطلب غير متاح" }, { status: 404 });
          }
          await ensureReviewsSchema();

          /*
            `awaiting_customer_confirmation` as well as `completed`: the
            half-hour trigger asks for the review before the sixty-minute timer
            finishes the order, and the sheet it opens must not then refuse.
          */
          const order = await d1First<{ id?: string; code?: string; user_id?: string }>(
            `SELECT id, code, user_id FROM orders
             WHERE id = ? AND status IN ('completed', 'awaiting_customer_confirmation')`,
            orderId,
          );
          // `d1First` answers with a truthy empty object when there is no
          // binding, so test a field rather than the row.
          if (!order?.id || order.user_id !== user.id) {
            return json({ error: "الطلب غير متاح" }, { status: 404 });
          }

          const products = await d1All<{
            product_id: string;
            title: string;
            image_url: string | null;
          }>(
            `SELECT product_id, title, image_url FROM order_items_snapshot
             WHERE order_id = ? ORDER BY created_at ASC`,
            orderId,
          );

          /*
            An order placed before the snapshot table existed has no rows
            there. `submitOrderReviewGroup` already falls back to the order
            document; without the same fallback here the sheet would list no
            products while the submission behind it covered several.
          */
          if (products.length === 0) {
            const doc = await d1First<{ doc?: string }>(
              `SELECT doc FROM orders WHERE id = ?`,
              orderId,
            );
            try {
              const parsed = JSON.parse(String(doc?.doc ?? "{}")) as {
                items?: { productId?: unknown; title?: unknown; image?: unknown }[];
              };
              for (const item of parsed.items ?? []) {
                const id = String(item.productId ?? "").trim();
                if (!id) continue;
                products.push({
                  product_id: id,
                  title: String(item.title ?? id),
                  image_url: item.image ? String(item.image) : null,
                });
              }
            } catch {
              // A document that will not parse leaves the list empty, which
              // the sheet renders as no products rather than as an error.
            }
          }

          const existing = await d1First<{
            review_group_id?: string | null;
            status?: string;
            rejection_reason?: string | null;
            created_at?: string;
          }>(
            `SELECT review_group_id, status, rejection_reason, created_at
             FROM product_reviews
             WHERE order_id = ? AND user_id = ? AND review_group_id IS NOT NULL
             ORDER BY created_at DESC LIMIT 1`,
            orderId,
            user.id,
          );

          const seen = new Set<string>();
          return json({
            orderId,
            orderCode: order.code ?? "",
            products: products
              .filter((row) => {
                const id = String(row.product_id ?? "");
                if (!id || seen.has(id)) return false;
                seen.add(id);
                return true;
              })
              .map((row) => ({
                productId: row.product_id,
                title: row.title,
                imageUrl: row.image_url ?? null,
              })),
            submission: existing?.status
              ? {
                  status: existing.status,
                  // A refusal is told to the customer; that is what makes it
                  // possible to send a better one.
                  rejectionReason:
                    existing.status === "rejected" ? (existing.rejection_reason ?? null) : null,
                  createdAt: existing.created_at ?? null,
                }
              : null,
            limits: { commentMin: REVIEW_COMMENT_MIN, commentMax: REVIEW_COMMENT_MAX },
            ...(await reviewPrompt()),
          });
        }),

      POST: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          const throttle = await consumeRateLimit(
            request,
            "order-review-submit",
            10,
            24 * 60 * 60,
            user.id,
          );
          if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);
          if (!getD1()) return json({ error: "قاعدة البيانات غير متاحة" }, { status: 503 });

          const input = await body<Record<string, unknown>>(request);
          const result = await submitOrderReviewGroup({
            userId: user.id,
            orderId: String(input["orderId"] ?? ""),
            rating: Number(input["rating"] ?? 0),
            comment: String(input["comment"] ?? ""),
            deliveryMediaUrl: String(input["mediaUrl"] ?? ""),
            instagramProofUrl: String(input["instagramProofUrl"] ?? ""),
          });

          if (result.ok) {
            return json({
              ok: true,
              groupId: result.groupId,
              products: result.products,
              message: "تم إرسال تقييمك. بعد موافقة الإدارة يصلك كود الخصم.",
            });
          }

          const messages: Record<string, string> = {
            order_not_found: "الطلب غير متاح",
            order_not_completed: "يمكن التقييم بعد اكتمال الطلب فقط",
            comment_too_short: `اكتب رأيك بما لا يقل عن ${REVIEW_COMMENT_MIN} أحرف`,
            invalid_rating: "اختر تقييماً من ١ إلى ٥",
            media_required: "أرفق صورة أو مقطعاً لتسليم المنتجات",
            invalid_media: "الملف المرفق غير صالح",
            proof_required: "أرفق صورة تعليقك على منشور الإنستغرام",
            invalid_proof: "صورة إثبات التعليق غير صالحة",
            already_submitted: "لديك تقييم لهذا الطلب قيد المراجعة أو تمت الموافقة عليه",
            no_products: "لا توجد منتجات في هذا الطلب",
          };
          const status =
            result.reason === "order_not_found"
              ? 404
              : result.reason === "already_submitted"
                ? 409
                : 400;
          return json(
            { error: messages[result.reason] ?? "تعذر إرسال التقييم", code: result.reason },
            { status },
          );
        }),
    },
  },
});
