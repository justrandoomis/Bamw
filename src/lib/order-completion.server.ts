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
import { d1All, d1Run, d1RunChanges, getD1 } from "./d1.server";
import { appendMessage, getOrder, saveOrder } from "./db.server";
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
  /** False when the status was already complete; missing follow-ups may still be repaired. */
  changed: boolean;
}

/**
 * Claim the status transition in D1 before any once-only follow-up runs.
 *
 * Two admins can press complete from two isolates at the same instant. A
 * read-then-upsert lets both believe they won; this conditional update lets
 * only the caller that still sees the exact previous status write the
 * completed document. The loser reloads the winner's document and repairs the
 * idempotent follow-ups without writing a second event/history row.
 */
async function persistCompletionTransition(
  previous: Order,
  completed: Order,
): Promise<CompleteOrderResult> {
  if (!getD1()) {
    const latest = await getOrder(previous.id);
    if (latest?.status === "completed") return { order: latest, changed: false };
    if (latest?.status === "cancelled") return { order: latest, changed: false };
    await saveOrder(completed);
    return { order: completed, changed: true };
  }

  const claimed = await d1RunChanges(
    `UPDATE orders
     SET doc = ?, status = 'completed', updated_at = ?
     WHERE id = ? AND status = ?`,
    JSON.stringify(completed),
    completed.updatedAt,
    previous.id,
    previous.status,
  );
  if (claimed === 1) return { order: completed, changed: true };

  const latest = await getOrder(previous.id);
  if (!latest) throw new Error("ORDER_NOT_FOUND");
  if (latest.status === "completed" || latest.status === "cancelled") {
    return { order: latest, changed: false };
  }
  throw new Error("ORDER_COMPLETION_CONFLICT");
}

/**
 * Move an order to `completed`, once.
 *
 * Idempotent by design: a second call never moves `completedAt`, duplicates a
 * history row, or pays a reward twice. Deterministic message ids also let that
 * retry repair a follow-up that failed after the status was persisted.
 */
export async function completeOrder(
  order: Order,
  options: CompleteOrderOptions,
): Promise<CompleteOrderResult> {
  if (order.status === "cancelled") return { order, changed: false };

  const now = options.now ?? new Date().toISOString();
  const previousStatus = order.status;
  let changed = order.status !== "completed";

  let next: Order = changed
    ? {
        ...order,
        status: "completed",
        completedAt: order.completedAt || now,
        autoCompleteAt: undefined,
        ...(options.auto ? { autoCompletedAt: order.autoCompletedAt || now } : {}),
        ...(options.role === "USER"
          ? { customerConfirmedAt: order.customerConfirmedAt || now }
          : {}),
        items: order.items.map((item) => ({
          ...item,
          deliveredAt: item.deliveredAt || now,
          completedAt: item.completedAt || now,
        })),
        updatedAt: now,
        events: [
          ...(order.events ?? []),
          {
            type: options.auto ? "order_auto_completed" : "order_completed",
            at: now,
            payload: { by: options.by, role: options.role },
          },
        ],
      }
    : order;

  if (changed) {
    const persisted = await persistCompletionTransition(order, next);
    next = persisted.order;
    changed = persisted.changed;
    if (next.status === "cancelled") return { order: next, changed: false };
  }

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

  if (changed) {
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
  }

  /*
    The order is finished, so a referral reward on it is finally earned.
    
    Here rather than in the admin's button or the hour-long timer because this
    function is the single completion gateway. The reward ledger owns its
    idempotency, so a retry can repair a failed payout without paying twice.
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

  if (next.threadId) {
    try {
      await appendMessage(next.threadId, {
        senderRole: options.role === "USER" ? "user" : "system",
        kind: "order_completed",
        clientMessageId: `order-completed-${next.id}`,
        body: { text: options.message, code: next.code, autoCompleted: Boolean(options.auto) },
      });
    } catch (err) {
      console.warn("[order-completion:completion_message_failed]", { orderId: next.id }, err);
    }

    try {
      // Always ensure the deterministic card exists. Older completions stamped
      // `ratingCardSentAt` before the append succeeded; trusting that stamp
      // made the missing card impossible to repair.
      await appendMessage(next.threadId, {
        senderRole: "assistant",
        senderName: "الدعم الآلي",
        kind: "review_request",
        clientMessageId: `order-review-request-${next.id}`,
        body: {
          orderId: next.id,
          orderCode: next.code,
          items: next.items.map((item) => ({
            id: item.id,
            // Same chain as every other surface: the order's own items.
            title: orderItemTitleOf(item),
            image: item.image,
            productId: item.productId,
          })),
          text: "نسعد جداً بتقييمك لتجربة الشراء وجودة الخدمة ⭐",
        },
      });
      if (!next.ratingCardSentAt) {
        next = { ...next, ratingCardSentAt: now, updatedAt: now };
        await saveOrder(next);
      }
    } catch (err) {
      console.warn("[order-completion:review_card_failed]", { orderId: next.id }, err);
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
    const { promptForReview } = await import("./review-reward.server");
    /*
      Through the shared claim, not straight to the invitation. Completion is
      one of three triggers the owner named — the customer confirming, the
      thirty-minute timer after the last OTP, and an admin completing by hand —
      and a customer who was already asked by the timer must not be asked twice
      when the order then completes.
    */
    await promptForReview(next, "completed", { now: options.now ?? undefined });
  } catch (err) {
    console.warn("[order-completion:review_invite_failed]", { orderId: order.id }, err);
  }

  /*
    The timer has nothing left to do: the order is finished and the invitation
    above has been claimed. Clearing it also keeps the minute sweep's index
    small, since only unfinished orders stay in it.
  */
  try {
    await d1Run(`UPDATE orders SET review_prompt_at = NULL WHERE id = ?`, order.id);
  } catch {
    // The column may predate this deploy on a database that has not healed yet.
  }

  return { order: next, changed };
}

/**
 * Repair review cards and 1,000-IQD reward entitlements for orders completed
 * before the unified completion path existed (or interrupted mid-follow-up).
 * The query selects only orders missing a durable reward or deterministic card
 * and the normal completion service performs the idempotent repair.
 */
export async function reconcileCompletedOrderReviewFollowups(
  now = new Date().toISOString(),
  limit = 25,
): Promise<{ scanned: number; repaired: number; errors: number }> {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit) || 25));
  const { ensureReviewRewardSchema } = await import("./review-reward.server");
  await ensureReviewRewardSchema();

  const rows = await d1All<{ id: string; thread_id: string | null }>(
    `WITH completed_orders AS (
       SELECT o.id,
              COALESCE(
                (
                  SELECT owned.id FROM threads AS owned
                  WHERE owned.id = NULLIF(json_extract(
                    CASE WHEN json_valid(o.doc) THEN o.doc ELSE '{}' END,
                    '$.threadId'
                  ), '')
                    AND owned.order_id = o.id
                  LIMIT 1
                ),
                (
                  SELECT t.id FROM threads AS t
                  WHERE t.order_id = o.id
                  ORDER BY t.last_message_at DESC LIMIT 1
                )
              ) AS thread_id
       FROM orders AS o
       WHERE o.status = 'completed'
     )
     /*
       The missing-invitation branch, and only that.

       This used to also match "reward.order_id IS NULL" -- an order with no
       reward row. That was a sound question while completion minted a reward:
       a missing row meant a missed completion. It stopped being sound the
       moment the coupon became something an admin issues after approving a
       review, because then nearly every completed order the shop has ever
       taken has no reward row, forever, and this cron would re-run the whole
       completion path on a fresh batch of them every single minute.

       The OR made the removal clean: the remaining branch asks the question
       that is still worth asking — was this customer ever invited to rate the
       order — and answers it from the message that invitation writes.
     */
     SELECT completed_orders.id, completed_orders.thread_id
     FROM completed_orders
     WHERE completed_orders.thread_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM messages AS message
         WHERE message.thread_id = completed_orders.thread_id
           AND message.client_message_id = 'order-review-request-' || completed_orders.id
       )
     ORDER BY completed_orders.id ASC
     LIMIT ?`,
    boundedLimit,
  );

  const result = { scanned: rows.length, repaired: 0, errors: 0 };
  for (const row of rows) {
    try {
      const stored = await getOrder(row.id);
      if (!stored || stored.status !== "completed") continue;
      const order = row.thread_id ? { ...stored, threadId: row.thread_id } : stored;
      await completeOrder(order, {
        by: "system:review-followup-repair",
        role: "SYSTEM",
        note: "إصلاح بطاقة التقييم وكوبون الطلب المكتمل",
        message: "✅ طلبك مكتمل. أضف تقييمك من البطاقة التالية.",
        now,
      });
      result.repaired += 1;
    } catch (error) {
      result.errors += 1;
      console.warn("[order-completion:review_followup_repair_failed]", {
        orderId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
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
