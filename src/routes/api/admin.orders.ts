import { createFileRoute } from "@tanstack/react-router";
import {
  appendMessage,
  createNotification,
  getOrder,
  listOrders,
  saveOrder,
  saveThread,
  getThread,
  deleteOrder,
  cleanupExpiredCancelledOrders,
  d1All,
  d1Batch,
  d1Execute,
  d1Ready,
  d1Run,
  randomId,
} from "@/lib/db.server";
import { body, guard, json } from "@/lib/http.server";
import { evaluateOrderAutoCompletion } from "@/lib/orders.server";
import { completeOrder, withDeliveryDeadline } from "@/lib/order-completion.server";
import {
  getDeliveryOrderState,
  mapUnmatchedDeliveryItem,
  saveDeliveryDraft,
  saveQuickPaste,
  sendDeliveryCredentials,
  sendDeliveryOtp,
  sendDigitalDeliveryCode,
} from "@/lib/order-delivery-items.server";
import { requireAdmin } from "@/lib/session.server";
import type { Order, OrderItem, OrderStatus, PaymentStatus } from "@/lib/types";
import { redactOrder } from "./orders";

type Action =
  | "stage_account_batch"
  | "release_next_account"
  | "batch_status"
  | "set_payment"
  | "set_status"
  | "cancel_order"
  | "delete_order"
  | "direct_send_credentials"
  | "stage_credentials"
  | "send_credentials"
  | "send_verification_code"
  | "delivery_quick_paste"
  | "save_delivery_draft"
  | "map_delivery_item"
  | "send_delivery_credentials"
  | "send_delivery_otp"
  | "send_delivery_code"
  | "send_instructions"
  | "mark_logged_in"
  | "mark_shipped"
  | "mark_delivered"
  | "complete_order"
  | "send_discount";

interface AdminOrderBody {
  orderId?: string;
  threadId?: string;
  action?: Action;
  itemId?: string;
  deliveryItemId?: string;
  sourceDeliveryItemId?: string;
  targetDeliveryItemId?: string;
  email?: string;
  password?: string;
  code?: string;
  pin?: string;
  rawText?: string;
  text?: string;
  title?: string;
  clientMessageId?: string;
  /** Bulk-prepared accounts for one order line. */
  accounts?: { email?: string; password?: string }[];
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
}

function patchItem(order: Order, itemId: string, patch: Partial<OrderItem>): Order {
  return {
    ...order,
    items: order.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    updatedAt: new Date().toISOString(),
  };
}

export const Route = createFileRoute("/api/admin/orders")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          await requireAdmin(request);
          const url = new URL(request.url);
          const deliveryOrderId = url.searchParams.get("orderId");
          if (deliveryOrderId && url.searchParams.get("delivery") === "1") {
            try {
              return json({ state: await getDeliveryOrderState(deliveryOrderId) });
            } catch (error) {
              const code = error instanceof Error ? error.message : "DELIVERY_STATE_FAILED";
              console.error("[admin.orders:delivery_state_failed]", {
                orderId: deliveryOrderId,
                code,
              });
              return json(
                {
                  error:
                    code === "DELIVERY_PRODUCT_TITLE_MISSING" ||
                    code === "DELIVERY_PRODUCT_RELATION_MISSING"
                      ? "تعذر تحميل اسم لعبة موثوق من عناصر الطلب. تم تسجيل الخطأ للمراجعة."
                      : "تعذر تحميل بيانات تجهيز الطلب من D1.",
                  code,
                },
                { status: code === "ORDER_NOT_FOUND" ? 404 : 500 },
              );
            }
          }
          // Background auto-cleanup for expired cancelled orders (cancelled >= 7 days ago)
          void cleanupExpiredCancelledOrders().catch((e) =>
            console.warn("[admin.orders:cleanup_warn]", e),
          );
          const orders = await listOrders();
          return json({ orders: orders.map(redactOrder) });
        }),
      DELETE: async ({ request }) =>
        guard(async () => {
          const admin = await requireAdmin(request);
          const url = new URL(request.url);
          let orderId = url.searchParams.get("orderId") || url.searchParams.get("id");
          if (!orderId) {
            const bodyData = (await body<{ orderId?: string; id?: string }>(request).catch(
              () => ({}),
            )) as { orderId?: string; id?: string };
            orderId = bodyData.orderId || bodyData.id || "";
          }
          if (!orderId) return json({ error: "معرّف الطلب مطلوب" }, { status: 400 });

          const order = await getOrder(orderId);
          if (!order) return json({ error: "الطلب غير موجود" }, { status: 404 });

          // Reject deletion if active and paid (must be cancelled/refunded first)
          if (order.paymentStatus === "paid" && order.status !== "cancelled") {
            return json(
              { error: "لا يمكن حذف طلب مدفوع ونشط. يجب إلغاء الطلب واسترجاع الرصيد أولاً." },
              { status: 400 },
            );
          }

          await deleteOrder(orderId);

          // Record audit log
          try {
            await d1Run(
              `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              randomId("aud"),
              admin.id,
              "delete_order",
              "order",
              orderId,
              JSON.stringify({ code: order.code, status: order.status, total: order.total }),
              new Date().toISOString(),
            );
          } catch {
            // Ignore if schema mismatch
          }

          return json({ success: true, message: "تم حذف الطلب وجميع البيانات المرتبطة بنجاح" });
        }),
      POST: async ({ request }) =>
        guard(async () => {
          const admin = await requireAdmin(request);
          const adminName = admin.name || "الإدارة";
          const data = await body<AdminOrderBody>(request);
          let order = data.orderId ? await getOrder(data.orderId) : undefined;
          if (!order && data.threadId) {
            const thread = await getThread(data.threadId);
            if (thread?.orderId) {
              order = await getOrder(thread.orderId);
            }
          }
          if (!order) return json({ error: "الطلب غير موجود" }, { status: 404 });
          const now = new Date().toISOString();
          let next: Order = order;
          // Set when a delivery action finished the order, so the response can
          // tell the admin UI where to go next.
          let deliveryCompletion:
            import("@/lib/order-delivery.server").DeliveryCompletion | undefined;

          switch (data.action) {
            case "delivery_quick_paste": {
              if (!data.rawText?.trim()) {
                return json({ error: "نص اللصق السريع مطلوب" }, { status: 400 });
              }
              const result = await saveQuickPaste(order.id, data.rawText);
              return json({ success: true, ...result });
            }
            case "save_delivery_draft": {
              if (!data.deliveryItemId) {
                return json({ error: "معرف عنصر التسليم مطلوب" }, { status: 400 });
              }
              const state = await saveDeliveryDraft({
                orderId: order.id,
                deliveryItemId: data.deliveryItemId,
                username: String(data.email ?? ""),
                password: String(data.password ?? ""),
              });
              return json({ success: true, state });
            }
            case "map_delivery_item": {
              if (!data.sourceDeliveryItemId || !data.targetDeliveryItemId) {
                return json({ error: "عنصر المصدر وخانة اللعبة مطلوبان" }, { status: 400 });
              }
              const state = await mapUnmatchedDeliveryItem({
                orderId: order.id,
                sourceDeliveryItemId: data.sourceDeliveryItemId,
                targetDeliveryItemId: data.targetDeliveryItemId,
              });
              return json({ success: true, state });
            }
            case "send_delivery_credentials": {
              if (!data.deliveryItemId) {
                return json({ error: "معرف عنصر التسليم مطلوب" }, { status: 400 });
              }
              const result = await sendDeliveryCredentials({
                orderId: order.id,
                deliveryItemId: data.deliveryItemId,
                adminId: admin.id,
                adminName,
                threadId: data.threadId,
              });
              return json({ success: true, ...result });
            }
            case "send_delivery_otp": {
              if (!data.deliveryItemId || !data.code?.trim()) {
                return json({ error: "عنصر التسليم وكود OTP مطلوبان" }, { status: 400 });
              }
              const result = await sendDeliveryOtp({
                orderId: order.id,
                deliveryItemId: data.deliveryItemId,
                code: data.code,
                adminId: admin.id,
                adminName,
                threadId: data.threadId,
              });
              return json({ success: true, ...result });
            }
            case "send_delivery_code": {
              if (!data.deliveryItemId || !data.code?.trim()) {
                return json({ error: "عنصر التسليم والكود مطلوبان" }, { status: 400 });
              }
              const result = await sendDigitalDeliveryCode({
                orderId: order.id,
                deliveryItemId: data.deliveryItemId,
                code: data.code,
                pin: data.pin,
                adminId: admin.id,
                adminName,
                threadId: data.threadId,
              });
              return json({ success: true, ...result });
            }
            case "delete_order": {
              if (order.paymentStatus === "paid" && order.status !== "cancelled") {
                return json(
                  { error: "لا يمكن حذف طلب مدفوع ونشط. يجب إلغاء الطلب واسترجاع الرصيد أولاً." },
                  { status: 400 },
                );
              }

              await deleteOrder(order.id);

              try {
                await d1Run(
                  `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
                  randomId("aud"),
                  admin.id,
                  "delete_order",
                  "order",
                  order.id,
                  JSON.stringify({ code: order.code, status: order.status, total: order.total }),
                  now,
                );
              } catch {
                // Ignore if schema mismatch
              }

              return json({ success: true, message: "تم حذف الطلب وجميع البيانات المرتبطة بنجاح" });
            }
            case "set_payment": {
              next = { ...order, paymentStatus: data.paymentStatus ?? "paid", updatedAt: now };
              /*
                An order that has now been paid moves its referral reward from
                `eligible` to `pending` — owed, but not yet paid out. The money
                only reaches the referrer when the order is completed.
              */
              if (next.paymentStatus === "paid") {
                try {
                  const { markRewardsPending } = await import("@/lib/referral/rewards.server");
                  await markRewardsPending(order.id);
                  const { notifyReferralPending } = await import(
                    "@/lib/referral/notifications.server"
                  );
                  if (next.referral) await notifyReferralPending(next);
                } catch (referralErr) {
                  console.warn("[set_payment:referral_pending_err]", referralErr);
                }
              }
              await appendMessage(order.threadId, {
                senderRole: "admin",
                senderName: adminName,
                kind: "system",
                body: {
                  text:
                    next.paymentStatus === "paid"
                      ? "تم تأكيد الدفع ✅ جاري تجهيز طلبك."
                      : next.paymentStatus === "rejected"
                        ? "لم نتمكن من تأكيد الدفع، الرجاء مراجعة الإيصال."
                        : "الإيصال قيد المراجعة.",
                },
              });
              break;
            }
            case "set_status": {
              if (data.status === "completed" || data.status === "awaiting_customer_confirmation") {
                const delivery = await getDeliveryOrderState(order);
                if (delivery.progress.total > 0) {
                  return json(
                    {
                      error:
                        "حالة الطلب الرقمي بعد التسليم تُحدد فقط من آخر OTP ثم تأكيد العميل أو مهلة الساعة",
                    },
                    { status: 409 },
                  );
                }
              }
              next = { ...order, status: data.status ?? order.status, updatedAt: now };
              break;
            }
            case "cancel_order": {
              if (order.status === "cancelled") {
                return json({ error: "الطلب ملغي بالفعل" }, { status: 400 });
              }

              // 1. Determine if this order was paid via wallet and calculate refund amount
              let wasPaidByWallet = false;
              let refundAmount = 0;

              if (await d1Ready()) {
                const payments = await d1All<{ amount: number }>(
                  `SELECT amount FROM wallet_transactions 
                   WHERE (order_id = ? OR order_id = ? OR description LIKE ?) 
                     AND (kind = 'payment' OR amount < 0) 
                   ORDER BY created_at ASC LIMIT 1`,
                  order.id,
                  order.code,
                  `%${order.code}%`,
                );

                if (payments.length > 0) {
                  wasPaidByWallet = true;
                  refundAmount = Math.abs(Number(payments[0]?.amount || 0));
                } else if (order.paymentStatus === "paid") {
                  wasPaidByWallet = true;
                  refundAmount = Number(order.total || 0);
                }
              } else {
                wasPaidByWallet = order.paymentStatus === "paid";
                refundAmount = Number(order.total || 0);
              }

              // 2. Check Idempotency: has this order already received an order_refund transaction?
              let alreadyRefunded = false;
              if (wasPaidByWallet && (await d1Ready())) {
                const refunds = await d1All<{ id: string }>(
                  `SELECT id FROM wallet_transactions 
                   WHERE (order_id = ? OR order_id = ? OR reference_id = ? OR (reference_type = 'order_refund' AND reference_id = ?)) 
                     AND (kind = 'order_refund' OR kind = 'refund') 
                   LIMIT 1`,
                  order.id,
                  order.code,
                  order.id,
                  order.id,
                );
                alreadyRefunded = refunds.length > 0;
              }

              // 3. Execute atomic transaction
              if (wasPaidByWallet && refundAmount > 0 && !alreadyRefunded) {
                if (await d1Ready()) {
                  try {
                    const refundTxId = randomId("wtx");
                    const refundDesc = `استرجاع مبلغ الطلب الملغي #${order.code}`;
                    await d1Batch([
                      {
                        sql: `UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + ? WHERE id = ?`,
                        params: [refundAmount, order.userId],
                      },
                      {
                        sql: `INSERT INTO wallet_transactions (id, user_id, kind, amount, description, order_id, reference_type, reference_id, created_at)
                              VALUES (?, ?, 'order_refund', ?, ?, ?, 'order_refund', ?, ?)`,
                        params: [
                          refundTxId,
                          order.userId,
                          refundAmount,
                          refundDesc,
                          order.id,
                          order.id,
                          now,
                        ],
                      },
                      {
                        sql: `UPDATE orders SET status = 'cancelled', payment_status = 'rejected', updated_at = ?, cancelled_at = ? WHERE id = ?`,
                        params: [now, now, order.id],
                      },
                    ]);
                  } catch (refundErr: any) {
                    console.error("[cancel_order:d1_batch_error]", refundErr);
                    return json(
                      {
                        error: `فشل استرجاع المبلغ وإلغاء الطلب: ${refundErr?.message || "خطأ أثناء تحديث قاعدة البيانات"}`,
                      },
                      { status: 500 },
                    );
                  }
                } else {
                  // Non-D1 fallback
                  try {
                    const { updateUser, createWalletTransaction } = await import("@/lib/db.server");
                    await updateUser(order.userId, (u) => ({
                      ...u,
                      walletBalance: (u.walletBalance || 0) + refundAmount,
                    }));
                    await createWalletTransaction({
                      userId: order.userId,
                      kind: "refund",
                      amount: refundAmount,
                      description: `استرجاع مبلغ الطلب الملغي #${order.code}`,
                      orderId: order.id,
                    });
                  } catch (err: any) {
                    return json(
                      { error: `فشل استرجاع المبلغ: ${err?.message || "خطأ غير متوقع"}` },
                      { status: 500 },
                    );
                  }
                }
              } else {
                // Not paid by wallet or already refunded - simply cancel order in DB
                if (await d1Ready()) {
                  try {
                    await d1Execute(
                      `UPDATE orders SET status = 'cancelled', updated_at = ?, cancelled_at = ? WHERE id = ?`,
                      now,
                      now,
                      order.id,
                    );
                  } catch (err: any) {
                    console.warn("[cancel_order:update_orders_err]", err);
                  }
                }
              }

              // 4. Update memory representation and write to JSON/D1 doc
              next = {
                ...order,
                status: "cancelled",
                paymentStatus: wasPaidByWallet ? ("rejected" as any) : order.paymentStatus,
                cancelledAt: now,
                updatedAt: now,
              };

              try {
                await saveOrder(next);
              } catch (saveErr) {
                console.error("[cancel_order:saveOrder_err]", saveErr);
              }

              /*
                A cancelled order earns nobody a referral reward.

                A reward still waiting is simply refused; one already paid is
                clawed back with its own wallet entry. Both are idempotent, so
                cancelling an order twice cannot debit twice. The refunded and
                paid amounts are passed so a partial refund takes back the same
                share of the reward rather than all of it.
              */
              try {
                const { reverseRewardsForOrder } = await import("@/lib/referral/rewards.server");
                const reversal = await reverseRewardsForOrder({
                  order: { id: order.id, code: order.code },
                  refundedIqd: refundAmount,
                  paidIqd: Number(order.total || 0),
                  reason: "order_cancelled",
                });
                if (reversal.reversed > 0) {
                  const { notifyReferralReversed } = await import(
                    "@/lib/referral/notifications.server"
                  );
                  await notifyReferralReversed({ id: order.id });
                }
              } catch (referralErr) {
                console.error("[cancel_order:referral_reversal_err]", referralErr);
              }

              // 5. Send system message to order chat
              if (order.threadId) {
                try {
                  await appendMessage(order.threadId, {
                    senderRole: "system",
                    kind: "system",
                    body: {
                      text: wasPaidByWallet
                        ? `تم إلغاء الطلب من قبل الإدارة. تم استرجاع مبلغ (${refundAmount.toLocaleString()} IQD) بالكامل إلى محفظتك بنجاح.`
                        : "تم إلغاء الطلب من قبل الإدارة.",
                    },
                  });
                } catch {
                  // Ignore thread message error
                }
              }

              // 6. In-app user notification
              try {
                // Through the shared helper: this wrote a `link` column the
                // table does not have, so the customer was never told their
                // order had been cancelled and refunded.
                await createNotification(
                  order.userId,
                  "تم إلغاء الطلب واسترجاع المبلغ",
                  wasPaidByWallet
                    ? `تم إلغاء طلبك #${order.code} وإرجاع مبلغ ${refundAmount.toLocaleString()} IQD إلى محفظتك بنجاح.`
                    : `تم إلغاء طلبك #${order.code} من قبل الإدارة.`,
                  `/orders`,
                  "order_cancelled",
                );
              } catch {
                // Ignore notification table errors
              }

              // 7. Audit log & status history
              try {
                await d1Run(
                  `INSERT INTO order_status_history (id, order_id, old_status, new_status, changed_by, note, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
                  randomId("osh"),
                  order.id,
                  order.status,
                  "cancelled",
                  admin.id,
                  "إلغاء الطلب من قبل المشرف" +
                    (wasPaidByWallet ? ` مع استرجاع ${refundAmount} IQD` : ""),
                  now,
                );
                await d1Run(
                  `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
                  randomId("aud"),
                  admin.id,
                  "cancel_order",
                  "order",
                  order.id,
                  JSON.stringify({
                    code: order.code,
                    refunded: wasPaidByWallet ? refundAmount : 0,
                  }),
                  now,
                );
              } catch {
                // Ignore audit log error
              }

              return json({ order: redactOrder(next), success: true });
            }
            case "direct_send_credentials": {
              if (!data.itemId || !data.email || !data.password) {
                return json(
                  { error: "اسم المستخدم وكلمة المرور ومعرف عنصر الطلب مطلوبة" },
                  { status: 400 },
                );
              }
              const state = await getDeliveryOrderState(order);
              const candidates = state.deliveryItems.filter(
                (entry) =>
                  entry.orderItemId === data.itemId &&
                  ["draft", "ready"].includes(entry.status) &&
                  (!entry.username || entry.username === data.email),
              );
              if (candidates.length !== 1) {
                return json(
                  { error: "اختر delivery_item_id المحدد؛ لا يمكن تخمين خانة الكمية" },
                  { status: 409 },
                );
              }
              await saveDeliveryDraft({
                orderId: order.id,
                deliveryItemId: candidates[0]!.id,
                username: data.email,
                password: data.password,
              });
              const result = await sendDeliveryCredentials({
                orderId: order.id,
                deliveryItemId: candidates[0]!.id,
                adminId: admin.id,
                adminName,
                threadId: data.threadId,
              });
              return json({ success: true, ...result });
            }
            case "stage_credentials": {
              if (!data.itemId || !data.email || !data.password) {
                return json(
                  { error: "اسم المستخدم وكلمة المرور ومعرف عنصر الطلب مطلوبة" },
                  { status: 400 },
                );
              }
              const state = await getDeliveryOrderState(order);
              const candidates = state.deliveryItems.filter(
                (entry) =>
                  entry.orderItemId === data.itemId &&
                  ["draft", "ready"].includes(entry.status) &&
                  (!entry.username || entry.username === data.email),
              );
              if (candidates.length !== 1) {
                return json(
                  { error: "اختر delivery_item_id المحدد؛ لا يمكن تخمين خانة الكمية" },
                  { status: 409 },
                );
              }
              const nextState = await saveDeliveryDraft({
                orderId: order.id,
                deliveryItemId: candidates[0]!.id,
                username: data.email,
                password: data.password,
              });
              return json({ success: true, state: nextState });
            }
            case "send_credentials": {
              const state = await getDeliveryOrderState(order);
              const candidates = state.deliveryItems.filter(
                (entry) => entry.orderItemId === data.itemId && entry.status === "ready",
              );
              if (candidates.length !== 1) {
                return json(
                  { error: "اختر حسابًا جاهزًا واحدًا عبر delivery_item_id" },
                  { status: 409 },
                );
              }
              const result = await sendDeliveryCredentials({
                orderId: order.id,
                deliveryItemId: candidates[0]!.id,
                adminId: admin.id,
                adminName,
                threadId: data.threadId,
              });
              return json({ success: true, ...result });
            }
            /* ----------------------- batch account prep ----------------------- */
            case "stage_account_batch": {
              return json(
                {
                  error:
                    "تم إيقاف الدفعة المشتركة لهذا المسار؛ استخدم Quick Paste لإنشاء delivery_item مستقل لكل حساب",
                },
                { status: 409 },
              );
            }

            case "release_next_account": {
              return json(
                { error: "إطلاق الحسابات يتم الآن من سجل delivery_item الجاهز فقط" },
                { status: 409 },
              );
            }

            case "batch_status": {
              return json({ state: await getDeliveryOrderState(order) });
            }

            case "send_verification_code": {
              const code = String(data.code ?? "").trim();
              if (!code) {
                return json({ error: "يرجى إدخال كود التحقق (OTP)" }, { status: 400 });
              }
              const state = await getDeliveryOrderState(order);
              let deliveryItemId = data.deliveryItemId;
              if (!deliveryItemId && data.itemId) {
                const candidates = state.deliveryItems.filter(
                  (entry) => entry.orderItemId === data.itemId && entry.status === "proof_received",
                );
                if (candidates.length === 1) deliveryItemId = candidates[0]!.id;
                if (candidates.length > 1) {
                  return json(
                    {
                      error: "يوجد أكثر من حساب لهذا المنتج؛ اختر الحساب المحدد من تبويبات التسليم",
                    },
                    { status: 409 },
                  );
                }
              }
              if (!deliveryItemId) {
                return json(
                  {
                    error:
                      "تعذر تحديد delivery_item_id من إثبات الدخول؛ لن يتم اختيار لعبة عشوائياً",
                  },
                  { status: 400 },
                );
              }
              const result = await sendDeliveryOtp({
                orderId: order.id,
                deliveryItemId,
                code,
                adminId: admin.id,
                adminName,
                threadId: data.threadId,
              });
              return json({ success: true, ...result });
            }
            case "send_instructions": {
              await appendMessage(order.threadId, {
                senderRole: "admin",
                senderName: adminName,
                kind: "instructions",
                body: { text: data.text ?? "" },
              });
              break;
            }
            case "mark_logged_in": {
              return json(
                {
                  error:
                    "تسجيل الدخول يُثبت الآن بصورة مرتبطة بـ delivery_item_id، ولا يطلق حسابًا مشتركًا",
                },
                { status: 409 },
              );
            }
            case "mark_shipped": {
              if (!data.itemId) return json({ error: "missing_fields" }, { status: 400 });
              next = patchItem(order, data.itemId, { shippedAt: now });
              next = { ...next, status: "delivering" };
              await appendMessage(order.threadId, {
                senderRole: "admin",
                senderName: adminName,
                kind: "shipping_update",
                body: { text: data.text ?? "تم شحن طلبك 🚚" },
              });
              break;
            }
            case "mark_delivered": {
              if (!data.itemId) return json({ error: "missing_fields" }, { status: 400 });
              next = patchItem(order, data.itemId, { deliveredAt: now });
              await appendMessage(order.threadId, {
                senderRole: "admin",
                senderName: adminName,
                kind: "shipping_update",
                body: { text: data.text ?? "تم تسليم طلبك ✅" },
              });
              break;
            }
            case "complete_order": {
              /*
                One owner, and idempotent.
              const delivery = await getDeliveryOrderState(order);
              if (delivery.progress.total > 0) {
                return json(
                  {
                    error:
                      "لا يمكن إكمال طلب رقمي يدويًا؛ أرسل OTP لكل العناصر ثم انتظر تأكيد العميل أو الإكمال التلقائي",
                  },
                  { status: 409 },
                );
              }
              const updatedItems = order.items.map((it) => ({
                ...it,
                completedAt: it.completedAt || now,
                deliveredAt: it.deliveredAt || now,
              }));

              next = {
                ...order,
                status: "completed",
                completedAt: now,
                items: updatedItems,
                updatedAt: now,
              };

              // 1. Mark task in order queue completed
              try {
                await d1Run(
                  `UPDATE order_queue SET status = 'completed', updated_at = ? WHERE order_id = ?`,
                  now,
                  order.id,
                );

                await d1Run(
                  `INSERT INTO order_status_history (id, order_id, old_status, new_status, changed_by, note, created_at)
                   VALUES (?, ?, ?, 'completed', ?, 'تم تأكيد اكتمال الطلب من قبل الإدارة', ?)`,
                  randomId("osh"),
                  order.id,
                  order.status,
                  admin.id,
                  now,
                );

                await d1Run(
                  `INSERT INTO order_status_history_v2 (
                    id, order_id, old_status, new_status, changed_by_user_id, changed_by_role, reason, created_at
                  ) VALUES (?, ?, ?, 'completed', ?, 'ADMIN', 'Admin finalized order completion', ?)`,
                  randomId("oshv2"),
                  order.id,
                  order.status,
                  admin.id,
                  now,
                );
              } catch (err) {
                console.error("[admin:complete_order:history_failed]", err);
              }

                This used to write `completedAt: now` and post both the
                completion card and the rating request every time it ran, so a
                double-click sent the customer the same two messages twice and
                moved the completion time. `completeOrder` returns the order
                untouched when it is already finished.
              */
              const result = await completeOrder(order, {
                by: admin.id,
                role: "ADMIN",
                note: "تم تأكيد اكتمال الطلب من قبل الإدارة",
                message: data.text || "تم تسليم وإكمال الطلب بنجاح ✅",
                now,
              });
              next = result.order;

              if (result.changed) {
                const thread = await getThread(order.threadId);
                if (thread) await saveThread({ ...thread, status: "closed" });
              }
              break;
            }
            case "send_discount": {
              await appendMessage(order.threadId, {
                senderRole: "admin",
                senderName: adminName,
                kind: "discount_code",
                body: { code: data.code ?? "", text: data.text ?? "كود خصم لطلبك القادم 🎁" },
              });
              break;
            }
            default:
              return json({ error: "الإجراء المطلوب غير معروف" }, { status: 400 });
          }

          next = {
            ...next,
            events: [...(next.events || []), { type: data.action ?? "update", at: now }],
            updatedAt: now,
          };
          await saveOrder(next);

          // Notify customer via Telegram (Safe)
          try {
            const { notifyUserOrderStatus } = await import("@/lib/telegram-notifications.server");
            if (
              data.action === "set_status" ||
              data.action === "complete_order" ||
              data.action === "set_payment"
            ) {
              const statusMap: Record<string, string> = {
                paid: "تم تأكيد الدفع ✅",
                processing: "قيد التجهيز ⏳",
                delivering: "جاري التسليم 🚀",
                completed: "مكتمل بنجاح 🎉",
                cancelled: "ملغى ❌",
              };
              await notifyUserOrderStatus({
                userId: next.userId,
                order: next,
                statusText: statusMap[next.status] || next.status,
              });
            }
          } catch (err) {
            console.warn("Failed to notify user on order update", err);
          }

          return json({
            success: true,
            message: "تمت العملية بنجاح",
            order: redactOrder(next),
          });
        }),
    },
  },
});
