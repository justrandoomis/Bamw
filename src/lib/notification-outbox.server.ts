/**
 * Admin notifications, off the request path.
 *
 * ## What was already here
 *
 * A complete queue consumer — `queue-consumer.server.ts` — with a dedupe
 * ledger in `processed_queue_messages` and exponential retry to five attempts,
 * and a `NOTIFICATIONS_QUEUE` producer binding declared in `wrangler.jsonc`.
 * Nothing had ever called `.send()` on it. Every notification was an inline,
 * fire-and-forget `fetch` on the request path with a ten-second timeout and no
 * persistence: one slow Telegram response was ten seconds of a customer's
 * checkout, and one failed send was a notification nobody ever saw.
 *
 * This is the producer that was missing.
 *
 * ## Why it still sends inline when it cannot enqueue
 *
 * The binding is absent in local development, in tests, and in any deployment
 * whose queue is not provisioned. Enqueue-or-nothing would mean no admin
 * notifications at all in those, which is a worse failure than a slow one. So
 * the queue is preferred and the direct send is the fallback — and either way
 * the caller is never made to wait for the result or told about a failure,
 * because a notification about a thing must not be able to fail the thing.
 */

import { getBinding } from "./env.server";

interface QueueLike {
  send(body: unknown): Promise<void>;
}

/** The envelope shape `queue-consumer.server.ts` already understands. */
export interface NotificationEnvelope {
  type: string;
  payload: unknown;
  /**
   * What makes a repeat a repeat.
   *
   * The consumer keys its ledger on this, so a retried queue delivery, a
   * re-sent webhook or a double-submitted form all resolve to one notification.
   * Derived from the thing being notified about — an order id, a request id —
   * never from the moment of sending, which would be different every time and
   * therefore never a duplicate.
   */
  dedupeKey: string;
}

/**
 * Hand a notification to the queue, or send it now if there is no queue.
 *
 * Never throws and never returns a failure the caller has to handle: it
 * reports which path was taken, for logs and tests.
 */
export async function enqueueNotification(
  envelope: NotificationEnvelope,
  sendDirect: () => Promise<unknown>,
): Promise<"queued" | "direct" | "failed"> {
  const queue = getBinding<QueueLike>("NOTIFICATIONS_QUEUE");
  if (queue && typeof queue.send === "function") {
    try {
      await queue.send(envelope);
      return "queued";
    } catch (error) {
      /*
        A queue that refuses the message must not lose it. Falling through to
        the direct send costs the request the latency the queue was meant to
        save, on the rare occasion it happens, and keeps the notification.
      */
      console.warn("[outbox:enqueue_failed]", {
        type: envelope.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    await sendDirect();
    return "direct";
  } catch (error) {
    console.error("[outbox:direct_send_failed]", {
      type: envelope.type,
      error: error instanceof Error ? error.message : String(error),
    });
    return "failed";
  }
}
