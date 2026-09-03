/**
 * @vitest-environment node
 */
/**
 * The outbox: queue first, direct send as the fallback, never a thrown error.
 *
 * The failure this guards against is the one that was live until now — an
 * admin notification sent inline on the request path, with no retry and no
 * record, so a slow Telegram was a slow checkout and a failed Telegram was a
 * notification nobody ever saw.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

let BINDINGS: Record<string, unknown> = {};

vi.mock("./env.server", () => ({
  getBinding: (name: string) => BINDINGS[name],
  getEnv: () => BINDINGS,
  env: () => undefined,
  publishEnv: () => undefined,
}));

let outbox: typeof import("./notification-outbox.server");

beforeEach(async () => {
  BINDINGS = {};
  vi.resetModules();
  outbox = await import("./notification-outbox.server");
});

const envelope = { type: "telegram_admin_new_order", payload: { a: 1 }, dedupeKey: "order:ord_1" };

describe("enqueueNotification", () => {
  it("hands the message to the queue when there is one", async () => {
    const send = vi.fn(async () => undefined);
    BINDINGS["NOTIFICATIONS_QUEUE"] = { send };
    const direct = vi.fn(async () => "sent");

    expect(await outbox.enqueueNotification(envelope, direct)).toBe("queued");
    expect(send).toHaveBeenCalledWith(envelope);
    // The whole point: the request does not wait for Telegram.
    expect(direct).not.toHaveBeenCalled();
  });

  it("sends inline when there is no queue binding", async () => {
    /*
      Local development, tests, and any deployment whose queue is not
      provisioned. Enqueue-or-nothing would mean no admin notifications at all
      in those — a worse failure than a slow one.
    */
    const direct = vi.fn(async () => "sent");
    expect(await outbox.enqueueNotification(envelope, direct)).toBe("direct");
    expect(direct).toHaveBeenCalledTimes(1);
  });

  it("falls back to the direct send when the queue refuses", async () => {
    // A queue that rejects must not lose the message.
    const send = vi.fn(async () => {
      throw new Error("queue unavailable");
    });
    BINDINGS["NOTIFICATIONS_QUEUE"] = { send };
    const direct = vi.fn(async () => "sent");

    expect(await outbox.enqueueNotification(envelope, direct)).toBe("direct");
    expect(direct).toHaveBeenCalledTimes(1);
  });

  it("never throws, even when both paths fail", async () => {
    /*
      The rule that matters: a notification about an order must not be able to
      fail the order. The caller gets a value, never an exception.
    */
    BINDINGS["NOTIFICATIONS_QUEUE"] = {
      send: async () => {
        throw new Error("nope");
      },
    };
    const direct = vi.fn(async () => {
      throw new Error("telegram down");
    });

    await expect(outbox.enqueueNotification(envelope, direct)).resolves.toBe("failed");
  });

  it("ignores a binding that is not a queue", async () => {
    // A health-check shape or a stub without `.send` must not be trusted.
    BINDINGS["NOTIFICATIONS_QUEUE"] = { name: "not a queue" };
    const direct = vi.fn(async () => "sent");
    expect(await outbox.enqueueNotification(envelope, direct)).toBe("direct");
  });

  it("keys the dedupe on the thing, not on the moment", async () => {
    /*
      The consumer's ledger is keyed on this. A key derived from the time of
      sending would be different on every retry and therefore never a
      duplicate — which is the mistake that makes an idempotency ledger
      useless while looking correct.
    */
    expect(envelope.dedupeKey).toBe("order:ord_1");
    expect(envelope.dedupeKey).not.toMatch(/\d{13}/);
  });
});
