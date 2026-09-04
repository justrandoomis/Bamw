/**
 * Finishing an order, by hand or by the clock.
 *
 * One place decides what "completed" means and writes it, so the admin button,
 * the customer's confirmation and the hour-long timer cannot disagree — and so
 * that pressing the button twice is not two completions.
 *
 * The timing rules themselves live in `order-completion.ts`, where they are
 * pure and testable. This module supplies the two things they cannot know on
 * their own: whether the customer has something open, and how to persist the
 * transition.
 */
import { randomId } from "./crypto.server";
import { d1All, d1Run } from "./d1.server";
import { appendMessage, saveOrder } from "./db.server";
import {
  autoCompleteAt,
  isAutoCompleteDue,
  lastDeliveryAt,
  type AutoCompleteDecision,
} from "./order-completion";
import { orderItemTitleOf } from "./order-item-title";
import type { Order } from "./types";

/**
 * Is the customer waiting on us about this order?
 *
 * Any of their conversations that is escalated, or that the automated support
 * has handed to a person and nobody has picked up, counts. The order's own
 * conversation counts too: a customer who replies "this code doesn't work" has
 * raised an issue, and closing their order under them an hour later is exactly
 * the wrong answer.
 *
 * Fails *open* on a database error — better to leave an order waiting for an
 * admin than to auto-complete one that had a complaint against it.
 */
export async function hasOpenIssue(order: Order): Promise<{ open: boolean; reason?: string }> {
  try {
    const rows = await d1All<{ id: string; doc: string }>(
      `SELECT id, doc FROM threads WHERE user_id = ?`,
      order.userId,
    );
    for (const row of rows) {
      let thread: Record<string, unknown>;
      try {
        thread = JSON.parse(row.doc) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (thread["status"] !== "open") continue;
      const mode = String(thread["mode"] ?? "");
      if (mode === "ESCALATED") return { open: true, reason: "escalated_thread" };
      if (thread["needsAdmin"] === true || mode === "WAITING_FOR_ADMIN") {
        return { open: true, reason: "awaiting_admin" };
      }
    }
    return { open: false };
  } catch (err) {
    console.warn("[order-completion:issue_check_failed]", { orderId: order.id }, err);
    return { open: true, reason: "issue_check_failed" };
  }
}

/**
 * Stamp when the order's last item went out, and when it will close itself.
 *
 * Derived rather than accumulated, so it stays correct if an item is delivered
 * again or a delivery is corrected.
 */
export function withDeliveryDeadline(order: Order, now = new Date().toISOString()): Order {
  const lastDelivery = lastDeliveryAt(order.items) ?? now;
  return {
    ...order,
    lastOtpSentAt: lastDelivery,
    autoCompleteAt: autoCompleteAt(lastDelivery) ?? undefined,
  };
}

export interface CompleteOrderOptions {
  /** Who finished it: an admin's id, `"customer"`, or `"system"`. */
  by: string;
  role: "ADMIN" | "USER" | "SYSTEM";
  /** Stored on the status history row. */
  note: string;
  /** Text of the completion card posted to the conversation. */
  message: string;
  auto?: boolean;
  now?: string;
}

export interface CompleteOrderResult {
  order: Order;
  /** False when the order was already complete and nothing was written. */
  changed: boolean;
}

/**
 * Move an order to `completed`, once.
 *
 * Idempotent by design: a second call on an already-completed order returns it
 * untouched. The admin button used to rewrite `completedAt` and post a fresh
 * completion card and rating request every time it was pressed, so a
 * double-click sent the customer the same two messages twice and moved the
 * completion time.
 */
export async function completeOrder(
  order: Order,
  options: CompleteOrderOptions,
): Promise<CompleteOrderResult> {
  if (order.status === "completed") return { order, changed: false };
  if (order.status === "cancelled") return { order, changed: false };

  const now = options.now ?? new Date().toISOString();
  const previousStatus = order.status;

  const next: Order = {
    ...order,
    status: "completed",
    completedAt: order.completedAt || now,
    ...(options.auto ? { autoCompletedAt: order.autoCompletedAt || now } : {}),
    ...(options.role === "USER" ? { customerConfirmedAt: order.customerConfirmedAt || now } : {}),
    items: order.items.map((item) => ({
      ...item,
      deliveredAt: item.deliveredAt || now,
      completedAt: item.completedAt || now,
    })),
    ratingCardSentAt: order.ratingCardSentAt || now,
    updatedAt: now,
    events: [
      ...(order.events ?? []),
      {
        type: options.auto ? "order_auto_completed" : "order_completed",
        at: now,
        payload: { by: options.by, role: options.role },
      },
    ],
  };

  await saveOrder(next);

  // Leave the queue. Everyone behind this order moves up.
  try {
    await d1Run(
      `UPDATE order_queue SET status = 'completed', updated_at = ? WHERE order_id = ?`,
      now,
      order.id,
    );
  } catch (err) {
    console.warn("[order-completion:queue_release_failed]", { orderId: order.id }, err);
  }

  try {
    await d1Run(
      `INSERT INTO order_status_history (id, order_id, old_status, new_status, changed_by, note, created_at)
       VALUES (?, ?, ?, 'completed', ?, ?, ?)`,
      randomId("osh"),
      order.id,
      previousStatus,
      options.by,
      options.note,
      now,
    );
    await d1Run(
      `INSERT INTO order_status_history_v2 (
        id, order_id, old_status, new_status, changed_by_user_id, changed_by_role, reason, created_at
      ) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)`,
      randomId("oshv2"),
      order.id,
      previousStatus,
      options.by,
      options.role,
      options.note,
      now,
    );
  } catch (err) {
    console.warn("[order-completion:history_failed]", { orderId: order.id }, err);
  }

  /*
    The order is finished, so a referral reward on it is finally earned.
    
    Here rather than in the admin's button or the hour-long timer because this
    function is the single place an order becomes `completed` — and because it
    already returns early for an order that was complete already, which is what
    makes paying the referrer exactly once fall out of the existing shape
    instead of needing a guard of its own.
  */
  try {
    const { approveRewardsForOrder } = await import("./referral/rewards.server");
    const paid = await approveRewardsForOrder(next);
    if (paid.approved > 0) {
      const { notifyReferralApproved } = await import("./referral/notifications.server");
      await notifyReferralApproved(next);
    }
  } catch (err) {
    console.warn("[order-completion:referral_reward_failed]", { orderId: order.id }, err);
  }

  if (order.threadId) {
    try {
      await appendMessage(order.threadId, {
        senderRole: options.role === "USER" ? "user" : "system",
        kind: "order_completed",
        body: { text: options.message, code: order.code, autoCompleted: Boolean(options.auto) },
      });

      // The rating card goes out exactly once, whoever finished the order.
      if (!order.ratingCardSentAt) {
        await appendMessage(order.threadId, {
          senderRole: "assistant",
          senderName: "الدعم الآلي",
          kind: "review_request",
          body: {
            orderId: order.id,
            orderCode: order.code,
            items: order.items.map((item) => ({
              id: item.id,
              // Same chain as every other surface: the order's own items.
              title: orderItemTitleOf(item),
              image: item.image,
              productId: item.productId,
            })),
            text: "نسعد جداً بتقييمك لتجربة الشراء وجودة الخدمة ⭐",
          },
        });
      }
    } catch (err) {
      console.warn("[order-completion:message_failed]", { orderId: order.id }, err);
    }
  }

  /*
    And tell them, where they actually are.

    The rating card above lives in the website conversation. A customer who
    finished their purchase and closed the app never sees it, which is why the
    shop was getting no ratings: the request was posted somewhere nobody was
    looking. This sends the same invitation to Telegram, with the steps to
    reach the card and the reward for using it.

    Best-effort, and after the order is already saved: a thank-you must not be
    able to fail the completion that earned it.
  */
  try {
    const { sendReviewInvitation } = await import("./review-reward.server");
    await sendReviewInvitation(next, { now: options.now ?? undefined });
  } catch (err) {
    console.warn("[order-completion:review_invite_failed]", { orderId: order.id }, err);
  }

  return { order: next, changed: true };
}

/**
 * Close the order if its hour is up and nothing is open against it.
 *
 * Returns the order unchanged in every other case, so callers can run it on
 * any read without thinking about it.
 */
export async function evaluateOrderAutoCompletion(order: Order): Promise<Order> {
  const issue = await hasOpenIssue(order);
  const decision: AutoCompleteDecision = isAutoCompleteDue({
    status: order.status,
    items: order.items,
    lastOtpSentAt: order.lastOtpSentAt ?? null,
    autoCompleteAt: order.autoCompleteAt ?? null,
    hasOpenIssue: issue.open,
  });

  if (!decision.due) {
    if (decision.reason === "open_issue") {
      console.info("[order-completion:paused]", {
        orderId: order.id,
        reason: issue.reason ?? "open_issue",
        dueAt: decision.at ?? null,
      });
    }
    return order;
  }

  const result = await completeOrder(order, {
    by: "system",
    role: "SYSTEM",
    note: "إكمال تلقائي لمرور ساعة على تسليم آخر عنصر دون اعتراض",
    message: "✅ تم إكمال الطلب تلقائياً بعد مرور ساعة على التسليم دون ملاحظات.",
    auto: true,
  });
  if (result.changed) {
    console.info("[order-completion:auto_completed]", { orderId: order.id, dueAt: decision.at });
  }
  return result.order;
}
