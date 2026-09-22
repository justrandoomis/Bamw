/**
 * «أنا السابع في الطابور ولا أحد أمامي».
 *
 * The queue was built from every open conversation that carried an order id,
 * and a conversation stays open long after its order is delivered — that is
 * what lets a customer come back and ask about it. So every order the shop had
 * ever completed was still standing in the queue, the count only grew, and a
 * customer whose order was the only one being worked on was told they were
 * seventh.
 *
 * The queue is a list of work, so these pin it to the state of the work.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { Thread } from "./types";

const world = {
  threads: [] as Thread[],
  unfinished: new Set<string>(),
};

vi.mock("./db.server", () => ({
  listOpenThreads: async () => world.threads,
  listUnfinishedOrderIds: async () => world.unfinished,
  findThreadByIdOrOrder: async (ref: string) =>
    world.threads.find((t) => t.id === ref || t.orderId === ref),
  getThread: async (id: string) => world.threads.find((t) => t.id === id),
  saveThread: async () => {},
  appendMessage: async () => {},
  getMessages: async () => [],
  getAdminAvailabilityStatus: async () => ({
    isAvailable: true,
    workingHoursText: "٢٤ ساعة",
  }),
}));

vi.mock("./d1.server", () => ({ d1All: async () => [], d1Ready: async () => false }));
vi.mock("./chat-realtime.server", () => ({ chatRealtime: { publish: async () => {} } }));

const { calculateQueueMetrics } = await import("./chat-queue.server");

/** A thread for an order, the shape the queue reads. */
function thread(id: string, orderId: string, minutesAgo: number): Thread {
  const at = new Date(Date.UTC(2026, 0, 1, 12, 0, 0) - minutesAgo * 60_000).toISOString();
  return {
    id,
    orderId,
    userId: "usr_1",
    status: "open",
    mode: "ORDER_PREPARATION",
    chatType: "DELIVERY",
    createdAt: at,
    queueEnteredAt: at,
    lastMessageAt: at,
  } as unknown as Thread;
}

beforeEach(() => {
  world.threads = [];
  world.unfinished = new Set();
});

describe("the position a customer is shown", () => {
  it("does not count conversations whose orders are finished", () => {
    /*
      Six delivered orders and one being worked on. The complaint, exactly:
      before this, the seventh thread was told it was seventh.
    */
    world.threads = [
      thread("thr_1", "ord_1", 600),
      thread("thr_2", "ord_2", 500),
      thread("thr_3", "ord_3", 400),
      thread("thr_4", "ord_4", 300),
      thread("thr_5", "ord_5", 200),
      thread("thr_6", "ord_6", 100),
      thread("thr_7", "ord_7", 5),
    ];
    world.unfinished = new Set(["ord_7"]);

    return calculateQueueMetrics("thr_7").then((metrics) => {
      expect(metrics.position).toBe(1);
      expect(metrics.aheadCount).toBe(0);
      expect(metrics.status).toBe("serving_now");
      expect(metrics.estimatedMinutesText).toBe("دورك الآن");
    });
  });

  it("still counts the people who really are ahead", async () => {
    world.threads = [
      thread("thr_old", "ord_old", 900),
      thread("thr_a", "ord_a", 30),
      thread("thr_b", "ord_b", 20),
      thread("thr_c", "ord_c", 10),
    ];
    world.unfinished = new Set(["ord_a", "ord_b", "ord_c"]);

    const metrics = await calculateQueueMetrics("thr_c");
    expect(metrics.position).toBe(3);
    expect(metrics.aheadCount).toBe(2);
    expect(metrics.status).toBe("queued");
  });

  it("puts nobody in a queue for an order that is already done", async () => {
    /*
      The other half of the same fault. Telling a customer whose order is
      complete that they are first in the queue is as wrong as telling them
      they are seventh — there is no queue for them to be in.
    */
    world.threads = [thread("thr_done", "ord_done", 60)];
    world.unfinished = new Set();

    const metrics = await calculateQueueMetrics("thr_done");
    expect(metrics.isQueueEligible).toBe(false);
    expect(metrics.position).toBe(0);
    expect(metrics.status).toBe("not_queued");
    expect(metrics.estimatedMinutesText).toBe("غير مدرج بالطابور");
  });

  it("keeps a conversation that belongs to no order at all", async () => {
    /*
      A general support thread has no order to ask about. Dropping it would
      have emptied the queue of the conversations that legitimately wait in it.
    */
    const support = {
      id: "thr_support",
      userId: "usr_2",
      status: "open",
      mode: "ORDER_PREPARATION",
      chatType: "DELIVERY",
      createdAt: "2026-01-01T11:00:00.000Z",
      queueEnteredAt: "2026-01-01T11:00:00.000Z",
      lastMessageAt: "2026-01-01T11:00:00.000Z",
    } as unknown as Thread;
    world.threads = [support];
    world.unfinished = new Set();

    const metrics = await calculateQueueMetrics("thr_support");
    expect(metrics.isQueueEligible).toBe(true);
    expect(metrics.position).toBe(1);
  });

  it("reports the admin busy from the real queue, not from history", async () => {
    /*
      `adminStatus` is derived from the same list. Ten delivered orders used to
      make the admin look permanently «مشغول» to every customer in the shop.
    */
    world.threads = Array.from({ length: 10 }, (_, i) => thread(`thr_${i}`, `ord_${i}`, 100 - i));
    world.unfinished = new Set(["ord_9"]);

    const metrics = await calculateQueueMetrics("thr_9");
    expect(metrics.adminStatus).toBe("available");
  });
});
