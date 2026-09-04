/**
 * The queue was built to retry a failed notification and never retried one.
 *
 * `notifyAdminNewOrder` and its siblings swallow their failures and return
 * `{ ok: false }`. `dispatch` awaited them, saw no exception, marked the
 * message processed and acknowledged it — so a Telegram timeout, a 429 or a
 * refused keyboard lost the notification on the first attempt, with five
 * retries and an exponential backoff sitting unused right beside it.
 *
 * A notification that was never due is different, and must not be retried
 * five times before being given up on.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const notify = {
  ok: true as boolean,
  skipped: undefined as boolean | undefined,
};

vi.mock("./db.server", () => ({
  d1First: async () => null,
  d1Run: async () => ({}),
}));

vi.mock("./env.server", () => ({
  publishEnv: () => {},
  env: () => "",
  getBinding: () => undefined,
}));

vi.mock("./scheduled-jobs.server", () => ({
  processAutoScheduledTasks: async () => {},
  processBotTrading: async () => {},
  processDigitalDeliveryMaintenance: async () => {},
}));

vi.mock("./telegram.server", () => ({ sendTelegramMessage: async () => ({ ok: true }) }));

vi.mock("./telegram-notifications.server", () => {
  const result = async () => ({ ok: notify.ok, skipped: notify.skipped });
  return {
    notifyAdminCustomerMessage: result,
    notifyAdminDiscTrade: result,
    notifyAdminGameRequest: result,
    notifyAdminNewOrder: result,
    notifyAdminUsedListing: result,
    notifyAdminWalletTopUp: result,
    notifyUserAdminMessage: result,
    notifyUserOrderStatus: result,
  };
});

function batchWith(body: unknown, attempts = 1) {
  const message = {
    id: "msg-1",
    body,
    attempts,
    acked: false,
    retried: null as null | { delaySeconds?: number },
    ack() {
      this.acked = true;
    },
    retry(options?: { delaySeconds?: number }) {
      this.retried = options ?? {};
    },
  };
  return { batch: { queue: "banana-notifications", messages: [message] }, message };
}

const anOrder = {
  type: "telegram_admin_new_order",
  dedupeKey: "order:abc",
  payload: { order: { id: "abc" }, user: { id: "u1" } },
};

beforeEach(() => {
  notify.ok = true;
  notify.skipped = undefined;
});

describe("a notification the queue could not deliver", () => {
  it("is retried rather than acknowledged", async () => {
    notify.ok = false;
    const { batch, message } = batchWith(anOrder);
    const { handleQueueBatch } = await import("./queue-consumer.server");

    await handleQueueBatch(batch as any, {});

    expect(message.retried).not.toBeNull();
    expect(message.acked).toBe(false);
  });

  it("is given up on after five attempts, not retried forever", async () => {
    notify.ok = false;
    const { batch, message } = batchWith(anOrder, 5);
    const { handleQueueBatch } = await import("./queue-consumer.server");

    await handleQueueBatch(batch as any, {});

    expect(message.retried).toBeNull();
    expect(message.acked).toBe(true);
  });
});

describe("a notification that was never due", () => {
  it("is acknowledged, not retried", async () => {
    notify.ok = false;
    notify.skipped = true;
    const { batch, message } = batchWith({
      type: "telegram_admin_customer_message",
      dedupeKey: "msg:1",
      payload: { thread: { id: "t" }, message: { senderRole: "admin" }, user: { id: "u" } },
    });
    const { handleQueueBatch } = await import("./queue-consumer.server");

    await handleQueueBatch(batch as any, {});

    expect(message.retried).toBeNull();
    expect(message.acked).toBe(true);
  });
});

describe("a notification that was delivered", () => {
  it("is acknowledged", async () => {
    const { batch, message } = batchWith(anOrder);
    const { handleQueueBatch } = await import("./queue-consumer.server");

    await handleQueueBatch(batch as any, {});

    expect(message.acked).toBe(true);
    expect(message.retried).toBeNull();
  });
});
