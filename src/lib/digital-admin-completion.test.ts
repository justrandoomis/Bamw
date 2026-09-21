/**
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";
import type { Order, ProductKind, Thread } from "./types";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__DIGITAL_COMPLETION_TEST_D1__"] = db;

vi.mock("./env.server", () => ({
  env: () => undefined,
  getEnv: () => ({
    bananto: (globalThis as Record<string, unknown>)["__DIGITAL_COMPLETION_TEST_D1__"],
  }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

vi.mock("./storage.server", () => ({
  listKeys: async () => [],
  mutateJson: async () => undefined,
  readJson: async (_key: string, fallback: unknown) => fallback,
  writeJson: async () => undefined,
}));

vi.mock("./whatsapp.server", () => ({ sendWhatsappMessage: async () => undefined }));
vi.mock("./telegram-notifications.server", () => ({
  getUserTelegramChatId: async () => null,
}));
vi.mock("./telegram.server", () => ({
  escapeHtml: (value: string) => value,
  sendTelegramMessage: async () => ({ ok: true }),
  telegramMiniAppDeepLink: (path: string) => `https://example.test/${path}`,
}));
vi.mock("./review-reward.server", () => ({
  sendReviewInvitation: async () => null,
}));
vi.mock("./referral/rewards.server", () => ({
  approveRewardsForOrder: async () => ({ approved: 0 }),
}));
vi.mock("./referral/notifications.server", () => ({
  notifyReferralApproved: async () => undefined,
}));
vi.mock("./chat-realtime.server", () => ({
  chatRealtime: { broadcast: () => undefined },
}));

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const delivery = read("src/lib/order-delivery-items.server.ts");
const completion = read("src/lib/order-completion.server.ts");
const adminRoute = read("src/routes/api/admin.orders.ts");
const orders = read("src/lib/orders.server.ts");
const conversation = read("src/components/admin/inbox/ActiveConversation.tsx");
const preview = read("src/components/admin/inbox/OrderPreviewDrawer.tsx");

const NOW = "2026-09-20T12:00:00.000Z";

let completeOrder: typeof import("./order-completion.server").completeOrder;
let completeDigitalOrderAndNext: typeof import("./order-delivery-items.server").completeDigitalOrderAndNext;
let ensureDigitalDeliverySchema: typeof import("./order-delivery-items.server").ensureDigitalDeliverySchema;
let getOrder: typeof import("./db.server").getOrder;

function order(input: {
  id: string;
  kinds?: ProductKind[];
  threadId?: string;
  terminal?: boolean;
  createdAt?: string;
}): Order {
  const kinds = input.kinds ?? ["game"];
  const createdAt = input.createdAt ?? NOW;
  return {
    id: input.id,
    code: `BN-${input.id}`,
    userId: `usr-${input.id}`,
    userName: `Buyer ${input.id}`,
    threadId: input.threadId ?? "",
    items: kinds.map((kind, index) => ({
      id: `item-${input.id}-${index}`,
      productId: `product-${input.id}-${index}`,
      title: `Product ${input.id} ${index}`,
      kind,
      quantity: 1,
      unitPrice: 10_000,
      ...(input.terminal ? { verificationCodeSentAt: createdAt } : {}),
    })),
    total: kinds.length * 10_000,
    currency: "IQD",
    status: "processing",
    paymentStatus: "paid",
    needsAddress: kinds.some((kind) => kind === "hardware" || kind === "physical"),
    createdAt,
    updatedAt: createdAt,
    events: [],
  };
}

function seedOrder(value: Order): void {
  db.raw
    .prepare(
      `INSERT INTO orders (
        id, code, user_id, doc, status, payment_status, total,
        created_at, updated_at, source, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', ?)`,
    )
    .run(
      value.id,
      value.code,
      value.userId,
      JSON.stringify(value),
      value.status,
      value.paymentStatus,
      value.total,
      value.createdAt,
      value.updatedAt,
      value.userId,
    );

  const snapshot = db.raw.prepare(
    `INSERT INTO order_items_snapshot (
      id, order_id, product_id, title, price_iqd, quantity, options_json, image_url, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, '{}', NULL, ?)`,
  );
  for (const item of value.items) {
    snapshot.run(
      `snapshot-${item.id}`,
      value.id,
      String(item.productId),
      item.title,
      item.unitPrice,
      item.quantity,
      value.createdAt,
    );
  }
}

function seedThread(id: string, orderId: string): Thread {
  const value: Thread = {
    id,
    userId: `usr-${orderId}`,
    userName: `Buyer ${orderId}`,
    orderId,
    chatType: "ORDER_SUPPORT",
    subject: `Order ${orderId}`,
    status: "open",
    mode: "ORDER_PREPARATION",
    needsAdmin: true,
    queueStatus: "queued",
    lastMessageAt: NOW,
    createdAt: NOW,
  };
  db.raw
    .prepare(
      `INSERT INTO threads (id, user_id, order_id, doc, last_message_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, value.userId, orderId, JSON.stringify(value), value.lastMessageAt);
  return value;
}

function scalar(sql: string, ...params: unknown[]): number {
  return Number(
    (db.raw.prepare(sql).get(...(params as never[])) as { value?: number } | undefined)?.value ?? 0,
  );
}

beforeAll(async () => {
  const { ensureSchema } = await import("./d1.server");
  await ensureSchema();
  const deliveryModule = await import("./order-delivery-items.server");
  completeDigitalOrderAndNext = deliveryModule.completeDigitalOrderAndNext;
  ensureDigitalDeliverySchema = deliveryModule.ensureDigitalDeliverySchema;
  await ensureDigitalDeliverySchema();
  ({ completeOrder } = await import("./order-completion.server"));
  ({ getOrder } = await import("./db.server"));
});

beforeEach(() => {
  for (const table of [
    "order_delivery_issues",
    "order_delivery_items",
    "order_items",
    "order_items_snapshot",
    "order_status_history_v2",
    "order_status_history",
    "order_queue",
    "messages",
    "threads",
    "orders",
  ]) {
    db.raw.exec(`DELETE FROM ${table}`);
  }
  db.reset();
});

describe("admin digital completion", () => {
  it("has one explicit action wired from both order conversation surfaces", () => {
    expect(adminRoute).toContain('case "complete_digital_and_next"');
    expect(adminRoute).toContain("completeDigitalOrderAndNext({");
    expect(conversation).toContain("إكمال الطلب والانتقال للتالي");
    expect(conversation).toContain(
      "onComplete={isDigitalLinkedOrder ? onCompleteOrder : undefined}",
    );
    expect(preview).toContain("إكمال الطلب والانتقال للتالي");
  });

  it("checks every terminal delivery item and open issues before completion", () => {
    const start = delivery.indexOf("export async function completeDigitalOrderAndNext");
    const end = delivery.indexOf("async function moveOrderToAwaitingConfirmation", start);
    const body = delivery.slice(start, end);
    expect(body).toContain("isFullyDigitalOrder(order.items)");
    expect(body).toContain('throw new Error("ORDER_NOT_FULLY_DIGITAL")');
    expect(body.indexOf("hasOpenDeliveryIssue")).toBeGreaterThan(-1);
    expect(body.indexOf("strictDeliveryIsComplete")).toBeGreaterThan(-1);
    expect(body.indexOf("strictDeliveryIsComplete")).toBeLessThan(body.indexOf("completeOrder("));
    expect(body).toContain('throw new Error("DELIVERY_ITEMS_NOT_TERMINAL")');
    expect(body).toContain("nextOrder: await getNextActionableQueuedOrder");
  });

  it("does not expose the generic RESOLVED shortcut on order conversations", () => {
    expect(conversation).toContain('THREAD_MODES.filter((entry) => entry.mode !== "RESOLVED")');
    expect(conversation).toContain("{!isDigitalLinkedOrder && (");
  });
});

describe("queue and completion ownership", () => {
  it("uses the shared digital-kind classifier at checkout and repairs old queues", () => {
    expect(orders).toContain("const needsWalletPayment = isFullyDigitalOrder(items)");
    expect(delivery).toContain("export async function ensureDigitalOrderQueueEntry");
    expect(delivery).toContain("repairActiveDigitalOrderQueues");
    expect(delivery).toContain("[delivery:next_queue_candidate_failed]");
  });

  it("routes customer and automatic completion through completeOrder", () => {
    const start = delivery.indexOf("async function completeDeliveredOrder");
    const end = delivery.indexOf("export async function confirmDeliveredOrder", start);
    const body = delivery.slice(start, end);
    expect(body).toContain("await completeOrder(order");
    expect(body).not.toContain("appendRatingRequest");
    expect(body).not.toContain("sendReviewInvitation");
  });

  it("repairs review follow-ups idempotently and creates no checkout placeholders", () => {
    expect(completion).toContain("clientMessageId: `order-completed-${next.id}`");
    expect(completion).toContain("clientMessageId: `order-review-request-${next.id}`");
    expect(completion.indexOf("await appendMessage(next.threadId")).toBeLessThan(
      completion.indexOf("ratingCardSentAt: now"),
    );
    expect(orders).not.toContain("review_placeholder");
    expect(orders).not.toContain("INSERT INTO product_reviews");
  });
});

describe("digital completion against real SQLite", () => {
  it("claims one atomic completion when two admins submit the same stale order", async () => {
    const original = order({ id: "atomic" });
    seedOrder(original);
    db.raw
      .prepare(
        `INSERT INTO order_queue (id, order_id, status, created_at, updated_at)
         VALUES ('queue-atomic', ?, 'processing', ?, ?)`,
      )
      .run(original.id, NOW, NOW);

    const firstCopy = structuredClone(original);
    const secondCopy = structuredClone(original);
    const results = await Promise.all([
      completeOrder(firstCopy, {
        by: "admin-a",
        role: "ADMIN",
        note: "first",
        message: "done",
        now: "2026-09-20T12:01:00.000Z",
      }),
      completeOrder(secondCopy, {
        by: "admin-b",
        role: "ADMIN",
        note: "second",
        message: "done",
        now: "2026-09-20T12:02:00.000Z",
      }),
    ]);

    expect(results.map((result) => result.changed).sort()).toEqual([false, true]);
    expect(
      scalar(
        `SELECT COUNT(*) AS value FROM order_status_history
         WHERE order_id = ? AND new_status = 'completed'`,
        original.id,
      ),
    ).toBe(1);
    expect(
      scalar(
        `SELECT COUNT(*) AS value FROM order_status_history_v2
         WHERE order_id = ? AND new_status = 'completed'`,
        original.id,
      ),
    ).toBe(1);

    const stored = await getOrder(original.id);
    expect(stored?.status).toBe("completed");
    expect(stored?.events.filter((event) => event.type === "order_completed")).toHaveLength(1);
    expect(stored?.completedAt).toBe(results.find((result) => result.changed)?.order.completedAt);
    expect(
      db.raw.prepare(`SELECT status FROM order_queue WHERE order_id = ?`).get(original.id),
    ).toMatchObject({ status: "completed" });
  });

  it("rejects mixed orders and a mismatched conversation without side effects", async () => {
    const mixed = order({ id: "mixed", kinds: ["game", "hardware"] });
    seedOrder(mixed);

    await expect(
      completeDigitalOrderAndNext({
        orderId: mixed.id,
        adminId: "admin",
        adminName: "Admin",
      }),
    ).rejects.toThrow("ORDER_NOT_FULLY_DIGITAL");
    expect((await getOrder(mixed.id))?.status).toBe("processing");
    expect(scalar(`SELECT COUNT(*) AS value FROM order_queue WHERE order_id = ?`, mixed.id)).toBe(
      0,
    );

    const linkedThreadId = "thread-linked";
    const wrongThreadId = "thread-wrong";
    const digital = order({ id: "thread-guard", threadId: linkedThreadId, terminal: true });
    seedOrder(digital);
    seedThread(linkedThreadId, digital.id);
    seedThread(wrongThreadId, "some-other-order");

    await expect(
      completeDigitalOrderAndNext({
        orderId: digital.id,
        adminId: "admin",
        adminName: "Admin",
        threadId: wrongThreadId,
      }),
    ).rejects.toThrow("THREAD_ORDER_MISMATCH");

    expect((await getOrder(digital.id))?.status).toBe("processing");
    expect(scalar(`SELECT COUNT(*) AS value FROM order_queue WHERE order_id = ?`, digital.id)).toBe(
      0,
    );
    expect(
      db.raw.prepare(`SELECT doc FROM threads WHERE id = ?`).get(linkedThreadId),
    ).toMatchObject({ doc: expect.stringContaining('"status":"open"') });
    expect(db.raw.prepare(`SELECT doc FROM threads WHERE id = ?`).get(wrongThreadId)).toMatchObject(
      { doc: expect.stringContaining('"status":"open"') },
    );
    expect(
      scalar(`SELECT COUNT(*) AS value FROM order_status_history WHERE order_id = ?`, digital.id),
    ).toBe(0);
  });

  it("closes the finished order and returns the repaired next game queue entry", async () => {
    const currentThreadId = "thread-current";
    const nextThreadId = "thread-next";
    const current = order({
      id: "current",
      threadId: currentThreadId,
      terminal: true,
      createdAt: "2026-09-20T10:00:00.000Z",
    });
    const next = order({
      id: "next",
      threadId: nextThreadId,
      createdAt: "2026-09-20T11:00:00.000Z",
    });
    seedOrder(current);
    seedOrder(next);
    seedThread(currentThreadId, current.id);
    seedThread(nextThreadId, next.id);

    const result = await completeDigitalOrderAndNext({
      orderId: current.id,
      adminId: "admin-1",
      adminName: "Admin",
      threadId: currentThreadId,
      now: "2026-09-20T12:05:00.000Z",
    });

    expect(result.order.status).toBe("completed");
    expect(result.nextOrder).toMatchObject({ orderId: next.id, threadId: nextThreadId });
    expect(
      db.raw.prepare(`SELECT status FROM order_queue WHERE order_id = ?`).get(current.id),
    ).toMatchObject({ status: "completed" });
    expect(
      db.raw.prepare(`SELECT status FROM order_queue WHERE order_id = ?`).get(next.id),
    ).toMatchObject({ status: "waiting" });

    const currentThread = JSON.parse(
      String(
        (
          db.raw.prepare(`SELECT doc FROM threads WHERE id = ?`).get(currentThreadId) as {
            doc: string;
          }
        ).doc,
      ),
    ) as Thread;
    const nextThread = JSON.parse(
      String(
        (
          db.raw.prepare(`SELECT doc FROM threads WHERE id = ?`).get(nextThreadId) as {
            doc: string;
          }
        ).doc,
      ),
    ) as Thread;
    expect(currentThread).toMatchObject({
      status: "closed",
      mode: "RESOLVED",
      queueStatus: "completed",
      needsAdmin: false,
    });
    expect(nextThread.status).toBe("open");
    expect((await getOrder(next.id))?.status).toBe("processing");
  });
});
