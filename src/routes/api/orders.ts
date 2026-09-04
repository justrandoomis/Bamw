import { createFileRoute } from "@tanstack/react-router";

import {
  getMessages,
  getOrder,
  getThread,
  listOrders,
  listOrdersByUser,
  saveOrder,
  appendMessage,
  cleanupExpiredCancelledOrders,
  d1Run,
  d1All,
  randomId,
} from "@/lib/db.server";
import { body, guard, json } from "@/lib/http.server";
import {
  AwaitingReleaseError,
  createOrderForUser,
  type CheckoutLine,
  evaluateOrderAutoCompletion,
} from "@/lib/orders.server";
import {
  confirmDeliveredOrder,
  getDeliveryOrderState,
  openDeliveryIssue,
  recordDeliveryProof,
} from "@/lib/order-delivery-items.server";
import { requireUser } from "@/lib/session.server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";
import type { Address, Order, OrderItem } from "@/lib/types";
import { redactMessageForMember, redactOrderHistoryForMember } from "@/lib/redaction";
import { isOwnUploadUrl } from "@/lib/uploads";

function redactItems(items: OrderItem[], viewer: OrderViewer) {
  return items.map(({ deliveryPasswordEnc: _hidden, unitCost, ...item }) => ({
    ...item,
    /*
      The acquisition cost of the line, kept from the buyer.

      `unitCost` is snapshotted onto every order line at checkout so that
      re-pricing a product cannot rewrite the margin on orders already placed
      — it is bookkeeping, and it was being handed to the customer who bought
      the line, on every read of their own order. The admin dashboard's profit
      chain is computed from these same lines, so it cannot simply be dropped:
      the audience decides.
    */
    ...(viewer.isAdmin && unitCost !== undefined ? { unitCost } : {}),
    hasStagedPassword: Boolean(_hidden),
  }));
}

/**
 * Who is being answered.
 *
 * Required rather than optional, so that adding a route which returns an order
 * is a decision about its audience. An optional flag defaulting either way is
 * a call site that can be written without thinking about it, and this one was.
 */
export interface OrderViewer {
  isAdmin?: boolean;
}

export function redactOrder(order: Order, viewer: OrderViewer) {
  return { ...order, items: redactItems(order!.items, viewer) };
}

async function canTransition(oldStatus: string, newStatus: string, kind: string): Promise<boolean> {
  if (kind === "preorder") {
    if (oldStatus === "purchased" && newStatus === "cancelled") return false;
  }
  if (oldStatus === "delivered" && newStatus === "preparing") return false;
  return true;
}

export const Route = createFileRoute("/api/orders")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          const url = new URL(request.url);
          const orderId = url.searchParams.get("orderId");

          if (orderId) {
            let order = await getOrder(orderId);
            if (!order || (order!.userId !== user.id && !user.isAdmin)) {
              return json({ error: "not_found" }, { status: 404 });
            }
            // Check 1-hour auto-completion window
            order = await evaluateOrderAutoCompletion(order!);

            const thread = await getThread(order.threadId);
            const messages = await getMessages(order.threadId);
            const history = await d1All<Record<string, unknown>>(
              `SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at DESC`,
              orderId,
            );

            return json({
              order: redactOrder(order!, user),
              thread,
              messages: user.isAdmin ? messages : messages.map(redactMessageForMember),
              history: user.isAdmin ? history : history.map(redactOrderHistoryForMember),
            });
          }

          if (user.isAdmin && url.searchParams.get("all")) {
            void cleanupExpiredCancelledOrders().catch(() => {});
          }

          const orders =
            user.isAdmin && url.searchParams.get("all")
              ? await listOrders()
              : await listOrdersByUser(user.id);
          return json({ orders: orders.map((row) => redactOrder(row, user)) });
        }),
      POST: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          const data = await body<{
            items?: CheckoutLine[];
            address?: Address;
            couponCode?: string;
            acceptedTerms?: boolean;
            idempotencyKey?: string;
            targetProductId?: string | number;
            source?: string;
            checkoutSessionId?: string;
            /*
              A referral code typed into the cart, when the signed cookie has
              none. It is a lookup key and nothing more: the referrer, the
              rate and the discount are all resolved on the server from this
              request's own cookie and from the database.
            */
            referralCode?: string;
          }>(request);
          const throttle = await consumeRateLimit(request, "order-create", 15, 15 * 60, user.id);
          if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);
          if (!Array.isArray(data.items) || data.items.length > 50) {
            return json({ error: "invalid_cart" }, { status: 400 });
          }

          if (data.acceptedTerms === false) {
            return json({ error: "terms_required" }, { status: 400 });
          }

          try {
            const order = await createOrderForUser(
              user,
              data.items ?? [],
              data.address,
              data.couponCode,
              data.acceptedTerms ?? true,
              data.idempotencyKey,
              data.targetProductId,
              data.source || "checkout_web",
              data.checkoutSessionId,
              {
                request,
                ...(typeof data.referralCode === "string" && data.referralCode.trim()
                  ? { referralCode: data.referralCode.trim().slice(0, 64) }
                  : {}),
              },
            );
            return json({ order: redactOrder(order!, user) });
          } catch (error) {
            console.error("[api:orders:create_failed]", error);
            /*
              A game that has not come out yet is refused by name, with its
              date, so the cart can say which line to remove and offer the
              release alert instead of reporting a generic failure.
            */
            if (error instanceof AwaitingReleaseError) {
              return json(
                {
                  error: "product_not_released",
                  productId: error.productId,
                  productTitle: error.productTitle,
                  releaseDate: error.releaseDate,
                },
                { status: 400 },
              );
            }
            const code = error instanceof Error ? error.message : "order_failed";
            const safe = new Set([
              "cart_empty",
              "insufficient_balance",
              "invalid_total",
              "coupon_invalid",
              "terms_required",
            ]);
            return json({ error: safe.has(code) ? code : "order_failed" }, { status: 400 });
          }
        }),
      PATCH: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          const data = await body<{
            orderId: string;
            status?: string;
            note?: string;
            address?: Address;
            action?:
              | "claim"
              | "complete"
              | "confirm_received"
              | "submit_login_proof"
              | "account_next"
              | "report_delivery_issue";
            itemId?: string;
            deliveryItemId?: string;
            imageUrl?: string;
            reason?: string;
          }>(request);

          const order = await getOrder(data.orderId);
          if (!order || (order!.userId !== user.id && !user.isAdmin))
            return json({ error: "not_found" }, { status: 404 });

          /**
           * The member attaches the screenshot proving they signed in.
           *
           * This is the step that unblocks the verification code, so it has to
           * be a first-class message on the order thread rather than a loose
           * image: staff need to see which account line it belongs to.
           */
          if (data.action === "submit_login_proof") {
            if (order!.userId !== user.id) return json({ error: "forbidden" }, { status: 403 });
            let itemId = String(data.itemId ?? "");
            let deliveryItemId = String(data.deliveryItemId ?? "");
            const imageUrl = String(data.imageUrl ?? "");

            // Only the member's own upload may be attached, never an arbitrary URL.
            if (!isOwnUploadUrl(imageUrl, user.id)) {
              return json({ error: "invalid_image" }, { status: 400 });
            }

            const state = await getDeliveryOrderState(order!);

            // Resolve exact delivery item from D1 state
            let exactDeliveryItem = deliveryItemId
              ? state.deliveryItems.find((entry) => entry.id === deliveryItemId)
              : undefined;

            if (!exactDeliveryItem && itemId) {
              const candidates = state.deliveryItems.filter(
                (entry) =>
                  entry.orderItemId === itemId &&
                  (entry.status === "sent" || entry.status === "proof_received"),
              );
              if (candidates.length === 1) {
                exactDeliveryItem = candidates[0];
              }
            }

            if (!exactDeliveryItem) {
              // Fallback to any sent delivery item in the order
              const sentCandidates = state.deliveryItems.filter((entry) => entry.status === "sent");
              if (sentCandidates.length === 1) {
                exactDeliveryItem = sentCandidates[0];
              }
            }

            if (!exactDeliveryItem) {
              return json({ error: "delivery_item_not_found" }, { status: 404 });
            }

            deliveryItemId = exactDeliveryItem.id;
            itemId = exactDeliveryItem.orderItemId || "";

            await recordDeliveryProof({
              orderId: order!.id,
              deliveryItemId,
              imageUrl,
              userId: user.id,
            });
            const next = await getOrder(order!.id);
            return json({ order: redactOrder(next || order, user) });
          }

          /**
           * The member is done with the account in hand and wants the next one.
           *
           * Whether one is waiting is the server's call: a staged account is
           * released immediately, an empty queue leaves the member waiting for
           * staff, and a finished line says so.
           */
          if (data.action === "account_next") {
            if (order!.userId !== user.id) return json({ error: "forbidden" }, { status: 403 });
            const itemId = String(data.itemId ?? "");
            if (!order!.items.some((entry) => entry.id === itemId)) {
              return json({ error: "item_not_found" }, { status: 404 });
            }

            const normalizedDelivery = await getDeliveryOrderState(order!);
            if (normalizedDelivery.progress.total > 0) {
              return json({
                released: null,
                waiting: true,
                order: redactOrder(order!, user),
                message:
                  "الحساب التالي يُرسل من سجل delivery_item مستقل عندما يصبح جاهزًا لدى الإدارة",
              });
            }

            const { markAccountRegistered, claimNextAccount, getBatchProgress } =
              await import("@/lib/account-batch.server");
            await markAccountRegistered(order!.id, itemId);
            const nextAccount = await claimNextAccount(order!.id, itemId);

            if (nextAccount && order.threadId) {
              await appendMessage(order.threadId, {
                senderRole: "admin",
                senderName: "الدعم",
                kind: "item_credentials",
                body: {
                  itemId,
                  title: order!.items.find((entry) => entry.id === itemId)?.title ?? "",
                  email: nextAccount.email,
                  ...(nextAccount.password ? { password: nextAccount.password } : {}),
                },
              });
            }

            const progress = await getBatchProgress(order!.id, itemId);
            return json({
              released: nextAccount ? nextAccount.seq : null,
              waiting: !nextAccount && progress.staged === 0 && progress.sent === 0,
              progress,
              order: redactOrder((await getOrder(order!.id)) ?? order, user),
            });
          }

          // Customer confirms receipt of order/accounts
          if (data.action === "confirm_received") {
            if (order!.userId !== user.id && !user.isAdmin) {
              return json({ error: "forbidden" }, { status: 403 });
            }

            try {
              const next = await confirmDeliveredOrder(order!.id, user.id);
              return json({ order: redactOrder(next!, user) });
            } catch (error: any) {
              const code = error instanceof Error ? error.message : "confirm_failed";
              const status = code === "ORDER_HAS_OPEN_DELIVERY_ISSUE" ? 409 : 400;
              return json(
                {
                  error: code,
                  message: "لا يمكن تأكيد الاستلام قبل اكتمال جميع عناصر التسليم.",
                },
                { status },
              );
            }
          }

          /*
            A `completeOrder` used to sit here with no `if` around it, followed
            by a `return`. It had no action of its own: `confirm_received`
            above returns on both its branches, so this could only ever be
            reached by something else — and then it completed that order and
            returned, making every handler below unreachable.

            Which is to say: a customer pressing "the code does not work"
            (`report_delivery_issue`, sent by ChatView) closed their order as
            completed instead of opening an issue. `claim` and `complete` did
            nothing for staff. An admin changing a status completed the order
            instead, skipping `canTransition` and the guard that refuses to
            complete a digital order before the customer confirms. The address
            write never ran.

            Completion has one owner — `completeOrder`, reached through
            `confirmDeliveredOrder` for a digital order and through the admin
            route otherwise — and this was a second, unguarded door into it.
          */
          if (data.action === "report_delivery_issue") {
            if (order!.userId !== user.id) return json({ error: "forbidden" }, { status: 403 });
            try {
              const next = await openDeliveryIssue({
                orderId: order!.id,
                userId: user.id,
                deliveryItemId: data.deliveryItemId,
                reason: data.reason,
              });
              return json({ order: redactOrder(next!, user) });
            } catch (error: any) {
              const code = error instanceof Error ? error.message : (error?.message || "delivery_issue_failed");
              return json({ error: code }, { status: 409 });
            }
          }

          // Staff Actions
          if (data.action === "claim") {
            if (!user.isAdmin) return json({ error: "forbidden" }, { status: 403 });
            const { claimOrderTask } = await import("@/lib/orders.server");
            await claimOrderTask(data.orderId, user.id);
            const next = await getOrder(data.orderId);
            return json({ order: redactOrder(next!, user) });
          }

          if (data.action === "complete") {
            if (!user.isAdmin) return json({ error: "forbidden" }, { status: 403 });
            const { completeOrderTask } = await import("@/lib/orders.server");
            await completeOrderTask(data.orderId, user.id);
            const next = await getOrder(data.orderId);
            return json({ order: redactOrder(next!, user) });
          }

          // Only admin can change status manually
          if (data.status && data.status !== order!.status) {
            if (!user.isAdmin) return json({ error: "forbidden" }, { status: 403 });

            if (data.status === "completed" || data.status === "awaiting_customer_confirmation") {
              const delivery = await getDeliveryOrderState(order!);
              if (delivery.progress.total > 0) {
                return json(
                  {
                    error:
                      "digital_orders_complete_only_after_customer_confirmation_or_server_timeout",
                  },
                  { status: 409 },
                );
              }
            }

            const firstKind = order!.items[0]?.kind || "account";
            if (!(await canTransition(order!.status, data.status as string, firstKind))) {
              return json({ error: "invalid_transition" }, { status: 400 });
            }

            // Log history
            await d1Run(
              `INSERT INTO order_status_history (id, order_id, old_status, new_status, changed_by, note, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              randomId("osh"),
              order!.id,
              order!.status,
              data.status,
              user.id,
              data.note || null,
              new Date().toISOString(),
            );
          }

          const next: Order = {
            ...order!,
            ...(data.status ? { status: data.status as any } : {}),
            ...(data.address ? { address: data.address } : {}),
            updatedAt: new Date().toISOString(),
          };
          await saveOrder(next!);
          return json({ order: redactOrder(next!, user) });
        }),
      DELETE: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          if (!user.isAdmin) return json({ error: "forbidden" }, { status: 403 });

          const url = new URL(request.url);
          let orderId = url.searchParams.get("orderId") || url.searchParams.get("id") || "";
          if (!orderId) {
            const bodyData = (await body<{ orderId?: string; id?: string }>(request).catch(
              () => ({}),
            )) as { orderId?: string; id?: string };
            orderId = bodyData.orderId || bodyData.id || "";
          }
          if (!orderId) return json({ error: "معرّف الطلب مطلوب" }, { status: 400 });

          const order = await getOrder(orderId);
          if (!order) return json({ error: "الطلب غير موجود" }, { status: 404 });

          if (order.paymentStatus === "paid" && order!.status !== "cancelled") {
            return json(
              { error: "لا يمكن حذف طلب مدفوع ونشط. يجب إلغاء الطلب واسترجاع الرصيد أولاً." },
              { status: 400 },
            );
          }

          const { deleteOrder } = await import("@/lib/db.server");
          await deleteOrder(orderId);

          try {
            await d1Run(
              `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              randomId("aud"),
              user.id,
              "delete_order",
              "order",
              orderId,
              JSON.stringify({ code: order!.code, status: order!.status, total: order!.total }),
              new Date().toISOString(),
            );
          } catch {
            // Ignore if schema mismatch
          }

          return json({ success: true, message: "تم حذف الطلب بنجاح" });
        }),
    },
  },
});
