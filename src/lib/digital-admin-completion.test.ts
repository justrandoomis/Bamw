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
const accountTools = read("src/components/admin/inbox/AccountToolsModal.tsx");
const inboxView = read("src/components/admin/inbox/AdminInboxView.tsx");
const manualDialog = read("src/components/admin/inbox/ManualCompletionDialog.tsx");

const NOW = "2026-09-20T12:00:00.000Z";

let completeOrder: typeof import("./order-completion.server").completeOrder;
let completeDigitalOrderAndNext: typeof import("./order-delivery-items.server").completeDigitalOrderAndNext;
let completeDigitalOrderManually: typeof import("./order-delivery-items.server").completeDigitalOrderManually;
let sendDeliveryOtp: typeof import("./order-delivery-items.server").sendDeliveryOtp;
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
  completeDigitalOrderManually = deliveryModule.completeDigitalOrderManually;
  sendDeliveryOtp = deliveryModule.sendDeliveryOtp;
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
  /*
    REVERSED, DELIBERATELY.

    This asserted that checkout decided whether to take the money from
    `isFullyDigitalOrder(items)` — the same classifier the delivery queue uses.
    Sharing it was the point, and sharing it was the bug: one boolean was
    answering two unrelated questions, and the answer to «does this need a
    delivery slot?» was being used for «has this been paid for?».

    One physical line in the cart therefore made the whole order — games and
    all — `unpaid`, with nothing taken from the wallet, while the cart screen
    had just promised «إتمام الدفع عبر المحفظة» and shown the balance it was
    about to reduce. That is the hole the owner reported.

    The classifier still decides FULFILMENT, which is what it is for, and this
    test still holds it in place for the queue. Payment is no longer one of its
    jobs.
  */
  it("uses the shared digital-kind classifier for fulfilment, and not for payment", () => {
    expect(orders).not.toContain("const needsWalletPayment = isFullyDigitalOrder(items)");
    expect(orders).toContain("isFullyDigitalOrder(order.items)");
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

/*
  The manual door, and the guarantees it must not weaken.

  The owner's complaint: «أنا أرسلت الكود بشكل يدوي فيجب أن يكون هنالك إكمال
  الطلب أيضا بشكل يدوي». A code sent over WhatsApp leaves the delivery slot at
  `sent` forever, because only `sendDeliveryOtp` can move it on and it was never
  called — so the strict button refuses for the rest of the order's life.
*/
describe("completing an order that was delivered by hand", () => {
  /** An order whose only slot is `sent`: credentials went out, the code did not. */
  async function seedDeliveredByHand(id: string) {
    const value = order({ id, threadId: `thr-${id}` });
    seedOrder(value);
    seedThread(`thr-${id}`, id);
    await ensureDigitalDeliverySchema();
    const { ensureOrderDeliveryRecords } = await import("./order-delivery-items.server");
    await ensureOrderDeliveryRecords(value);
    db.raw
      .prepare(`UPDATE order_delivery_items SET status = 'sent', sent_at = ? WHERE order_id = ?`)
      .run(NOW, id);
    return value;
  }

  it("is exactly what the strict button refuses, with no side effect", async () => {
    await seedDeliveredByHand("stuck");

    await expect(
      completeDigitalOrderAndNext({
        orderId: "stuck",
        adminId: "adm-1",
        adminName: "Admin",
        now: NOW,
      }),
    ).rejects.toThrow("DELIVERY_ITEMS_NOT_TERMINAL");

    const after = await getOrder("stuck");
    expect(after?.status).toBe("processing");
    expect(
      scalar(`SELECT COUNT(*) AS value FROM order_status_history WHERE order_id = 'stuck'`),
    ).toBe(0);
  });

  it("completes it, and claims no OTP anywhere in the database", async () => {
    /*
      The load-bearing assertion. A manual completion is an admin asserting the
      customer was served; it must never leave a record saying this system sent
      a code it did not send.
    */
    await seedDeliveredByHand("manual");

    const result = await completeDigitalOrderManually({
      orderId: "manual",
      adminId: "adm-1",
      adminName: "Admin",
      reason: "أرسلت الكود عبر واتساب بعد تعذر الإرسال من الأداة",
      confirmText: "BN-manual",
      now: NOW,
    });

    expect(result.order.status).toBe("completed");
    expect(result.forcedDeliveryItems).toHaveLength(1);
    expect(result.forcedDeliveryItems[0]!.from).toBe("sent");
    expect(
      scalar(`SELECT COUNT(*) AS value FROM order_delivery_items
              WHERE order_id = 'manual' AND otp_sent_at IS NOT NULL`),
    ).toBe(0);
    expect(
      scalar(`SELECT COUNT(*) AS value FROM order_delivery_items
              WHERE order_id = 'manual' AND status = 'completed'`),
    ).toBe(1);
  });

  it("refuses a mistyped order code, and changes nothing", async () => {
    await seedDeliveredByHand("typo");

    await expect(
      completeDigitalOrderManually({
        orderId: "typo",
        adminId: "adm-1",
        adminName: "Admin",
        reason: "سبب كافٍ الطول تماماً",
        confirmText: "BN-wrong",
        now: NOW,
      }),
    ).rejects.toThrow("MANUAL_COMPLETION_CONFIRMATION_MISMATCH");

    expect((await getOrder("typo"))?.status).toBe("processing");
    expect(
      scalar(`SELECT COUNT(*) AS value FROM order_delivery_items
              WHERE order_id = 'typo' AND status = 'sent'`),
    ).toBe(1);
  });

  it("refuses a reason too short to explain anything", async () => {
    await seedDeliveredByHand("terse");

    await expect(
      completeDigitalOrderManually({
        orderId: "terse",
        adminId: "adm-1",
        adminName: "Admin",
        reason: "تم",
        confirmText: "BN-terse",
        now: NOW,
      }),
    ).rejects.toThrow("MANUAL_COMPLETION_REASON_REQUIRED");

    expect((await getOrder("terse"))?.status).toBe("processing");
  });

  it("refuses while a delivery complaint is open", async () => {
    /*
      An open complaint is exactly when nobody may force-close. The strict path
      refuses here and so must this one.
    */
    await seedDeliveredByHand("disputed");
    db.raw
      .prepare(
        `INSERT INTO order_delivery_issues (id, order_id, opened_by_user_id, status, created_at)
         VALUES ('iss-1', 'disputed', 'usr-disputed', 'open', ?)`,
      )
      .run(NOW);

    await expect(
      completeDigitalOrderManually({
        orderId: "disputed",
        adminId: "adm-1",
        adminName: "Admin",
        reason: "أرسلت الكود يدوياً عبر واتساب",
        confirmText: "BN-disputed",
        now: NOW,
      }),
    ).rejects.toThrow("ORDER_HAS_OPEN_DELIVERY_ISSUE");

    expect(
      scalar(`SELECT COUNT(*) AS value FROM order_delivery_items
              WHERE order_id = 'disputed' AND status = 'completed'`),
    ).toBe(0);
  });

  it("completes once, however many times the button is pressed", async () => {
    await seedDeliveredByHand("twice");
    const args = {
      orderId: "twice",
      adminId: "adm-1",
      adminName: "Admin",
      reason: "أرسلت الكود يدوياً بعد عطل الأداة",
      confirmText: "BN-twice",
      now: NOW,
    };

    await completeDigitalOrderManually(args);
    const second = await completeDigitalOrderManually(args);

    expect(second.order.status).toBe("completed");
    expect(second.forcedDeliveryItems).toHaveLength(0);
    expect(
      scalar(`SELECT COUNT(*) AS value FROM order_status_history
              WHERE order_id = 'twice' AND new_status = 'completed'`),
    ).toBe(1);
  });

  it("archives a pasted line that matched nothing, without destroying it", async () => {
    const value = await seedDeliveredByHand("orphan");
    db.raw
      .prepare(
        `INSERT INTO order_delivery_items
           (id, order_id, order_item_id, product_id, slot_number, kind, status,
            username, created_at, updated_at)
         VALUES ('orphan:1', 'orphan', NULL, NULL, NULL, 'account', 'needs_mapping',
                 'ttxx7834', ?, ?)`,
      )
      .run(NOW, NOW);
    expect(value.id).toBe("orphan");

    const result = await completeDigitalOrderManually({
      orderId: "orphan",
      adminId: "adm-1",
      adminName: "Admin",
      reason: "سطر ملصق لم يطابق أي عنصر، والتسليم تم يدوياً",
      confirmText: "BN-orphan",
      now: NOW,
    });

    expect(result.archivedUnmappedItems).toEqual(["orphan:1"]);
    const row = db.raw
      .prepare(`SELECT archived_at, username FROM order_delivery_items WHERE id = 'orphan:1'`)
      .get() as { archived_at: string | null; username: string | null };
    expect(row.archived_at).toBeTruthy();
    // Archived, not deleted: what the admin pasted is still there.
    expect(row.username).toBe("ttxx7834");
  });
});

describe("the strict door cannot grow a bypass", () => {
  it("takes no parameter that would skip its own gate", () => {
    /*
      A `force` flag would leave every assertion about the strict path green
      while gutting what they assert — the guard still present, merely skipped.
      That is why the manual path is a second function, and why this reads the
      strict one's source for the words that would betray a flag.
    */
    const start = delivery.indexOf("export async function completeDigitalOrderAndNext");
    const end = delivery.indexOf("async function moveOrderToAwaitingConfirmation");
    const body = delivery.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(body).not.toMatch(/\bforce\b/i);
    expect(body).not.toMatch(/\boverride\b/i);
    expect(body).not.toMatch(/\bmanual\b/i);
  });

  it("offers the manual door on every surface that offers the strict one", () => {
    /*
      The owner got stuck because the only way out of a hand-delivered order
      depended on which surface they happened to be looking at. All four now
      reach the same dialog.
    */
    for (const [name, source] of [
      ["ActiveConversation", conversation],
      ["AccountToolsModal", accountTools],
      ["OrderPreviewDrawer", preview],
    ] as const) {
      expect(source, name).toContain("إكمال يدوي");
      expect(source, name).toMatch(/onCompleteOrderManually|onCompleteManually/);
    }
    expect(inboxView).toContain("ManualCompletionDialog");
    expect(inboxView).toContain('action: "complete_digital_manual"');
  });

  it("keeps the strict button untouched where the manual one was added", () => {
    // Two separate buttons, two separate labels, two separate server actions.
    expect(conversation).toContain("<span>إكمال الطلب والانتقال للتالي</span>");
    expect(conversation).toContain("<span>إكمال يدوي</span>");
    expect(inboxView).toContain('action: "complete_digital_and_next"');
  });

  it("is a plain yes or no, and still cannot carry a credential", () => {
    /*
      THIS TEST USED TO REQUIRE THE OPPOSITE, and the reversal is the owner's.

      It demanded that the dialog make the admin TYPE the order's code and
      compose a reason of at least ten characters, and that it refuse until
      both were present. The owner asked for «نعم أو لا». So the typing is
      gone, and what is asserted here is what was actually protective:

        - the dialog is still a separate, deliberate step, not a button in a
          strip — it renders and it asks;
        - the confirmation the SERVER checks is unchanged. The client sends
          the order code it has been displaying at the top of the dialog all
          along, rather than asking a human to copy a string from one line of
          one screen to another, which tests the same thing more reliably;
        - a reason still reaches the audit, prefilled and visible before «نعم»
          so nothing is recorded that the admin has not read, and never empty;
        - and no field here can carry a credential. That is the guarantee this
          door exists to keep, and it is the one thing that does not bend.
    */
    expect(manualDialog).toContain("نعم، أكمل الطلب");
    expect(manualDialog).toContain(">\n            لا\n          </button>");
    expect(manualDialog).toContain("confirmText: orderCode");
    expect(manualDialog).toContain("DEFAULT_MANUAL_REASON");
    expect(manualDialog).toContain("MANUAL_REASON_MIN");

    // The server rule itself is untouched — the dialog cannot relax it.
    expect(delivery).toContain(
      'if (!confirmText || confirmText !== String(order.code ?? "").trim())',
    );

    /*
      No credential, by construction. The visible copy does mention OTP — to
      say that none was sent — so this asserts on the FIELDS, which is the
      property that matters.
    */
    expect(manualDialog).not.toMatch(/type="password"/);
    const fields = manualDialog.match(/useState[^\n]*/g) || [];
    expect(fields.join("\n")).not.toMatch(/password|username|otp|code\b/i);
    // One free-text box, for the reason, and no <input> at all any more.
    expect(manualDialog.match(/<input/g) || []).toHaveLength(0);
    expect(manualDialog.match(/<textarea/g) || []).toHaveLength(1);
  });

  it("keeps the manual function outside the slice the strict assertions read", () => {
    /*
      The slice above ends at `moveOrderToAwaitingConfirmation`. A function
      placed inside that window would be swept into the strict-gate assertions
      and could satisfy them while the real gate was gone.
    */
    expect(delivery.indexOf("export async function completeDigitalOrderManually")).toBeGreaterThan(
      delivery.indexOf("async function moveOrderToAwaitingConfirmation"),
    );
  });

  it("routes the manual door through its own action, and audits ids only", () => {
    expect(adminRoute).toContain('case "complete_digital_manual"');
    const start = adminRoute.indexOf('case "complete_digital_manual"');
    /*
      Bound the slice to this case alone. A fixed character count runs past the
      closing brace into `case "delete_order"` and beyond, so the secret check
      below would be reading somebody else's handler.
    */
    const nextCase = adminRoute.indexOf('case "', start + 10);
    const body = adminRoute.slice(start, nextCase > start ? nextCase : adminRoute.length);
    expect(body).toContain("confirmText");
    expect(body).toContain("reason");
    expect(body).toContain("complete_digital_order_manually");

    /*
      The audit row records which slots moved, never what was in them. Read the
      code with the comments stripped: the comment above the INSERT names the
      fields it refuses to store, and a naive text search would flag that
      promise as if it were a leak.
    */
    const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/username|password|\bpin\b|otp/i);
  });

  it("enforces the confirmation and the reason before it writes anything", () => {
    /*
      The route hands both values straight to the function, which is where they
      belong: a check in the handler can be bypassed by any other caller. So
      the ordering that matters is inside the function — both must be refused
      before the first UPDATE.
    */
    const start = delivery.indexOf("export async function completeDigitalOrderManually");
    const body = delivery.slice(start, delivery.indexOf("export async function", start + 10));
    expect(body.indexOf("MANUAL_COMPLETION_CONFIRMATION_MISMATCH")).toBeLessThan(
      body.indexOf("UPDATE order_delivery_items"),
    );
    expect(body.indexOf("MANUAL_COMPLETION_REASON_REQUIRED")).toBeLessThan(
      body.indexOf("UPDATE order_delivery_items"),
    );
    // And it forces rows to `completed`, never to `otp_sent`.
    expect(body).toContain("status = 'completed'");
    expect(body).not.toContain("otp_sent_at =");
    expect(body).not.toMatch(/status = 'otp_sent'/);
  });
});

/*
  What happens in the gap between one account and the next.

  The owner asked for two things, and both are about that gap. When another
  account is already prepared, the member should get it STRAIGHT after this
  OTP, instead of waiting for the admin to come back to the tool — the gap was
  minutes on a busy evening and the member spent them watching a queue. And
  when the OTP was the last one, the order is finished, so it should finish
  rather than sit in the queue until somebody notices.

  The rule underneath both, and the thing these tests are really for: the OTP
  has already gone out and cannot be taken back, so NOTHING that follows may
  undo it or report it as a failure.
*/
describe("the OTP that ends one account, and what follows it", () => {
  /** An order with `slots` games, every slot waiting on its OTP. */
  async function seedAwaitingOtp(id: string, slots: number) {
    const value = order({ id, threadId: `thr-${id}`, kinds: Array(slots).fill("game") });
    seedOrder(value);
    seedThread(`thr-${id}`, id);
    await ensureDigitalDeliverySchema();
    const { ensureOrderDeliveryRecords } = await import("./order-delivery-items.server");
    await ensureOrderDeliveryRecords(value);
    db.raw
      .prepare(
        `UPDATE order_delivery_items
         SET status = 'proof_received', sent_at = ?, proof_received_at = ?
         WHERE order_id = ?`,
      )
      .run(NOW, NOW, id);
    return value;
  }

  const rows = (orderId: string) =>
    db.raw
      .prepare(
        `SELECT id, status FROM order_delivery_items
         WHERE order_id = ? AND archived_at IS NULL ORDER BY slot_number`,
      )
      .all(orderId) as Array<{ id: string; status: string }>;

  it("completes the order when the LAST OTP goes out", async () => {
    await seedAwaitingOtp("last", 1);
    const [only] = rows("last");

    const result = await sendDeliveryOtp({
      orderId: "last",
      deliveryItemId: only!.id,
      code: "123456",
      adminId: "adm-1",
      adminName: "Admin",
    });

    expect(result.orderFinished).toBe(true);
    expect((await getOrder("last"))?.status).toBe("completed");
  });

  it("does NOT complete the order while another slot still owes its OTP", async () => {
    await seedAwaitingOtp("partial", 2);
    const [first] = rows("partial");

    const result = await sendDeliveryOtp({
      orderId: "partial",
      deliveryItemId: first!.id,
      code: "123456",
      adminId: "adm-1",
      adminName: "Admin",
    });

    expect(result.orderFinished).toBeFalsy();
    expect((await getOrder("partial"))?.status).not.toBe("completed");
    // And the OTP it was asked to send is the one thing that definitely happened.
    expect(rows("partial")[0]?.status).toBe("otp_sent");
  });

  it("never reports the OTP as failed because what follows it failed", async () => {
    /*
      The order is fully digital and its last slot reaches a terminal state, so
      the completion attempt runs — and it is made to fail by opening a
      delivery issue, which `completeDigitalOrderAndNext` refuses outright.
      The OTP must still be sent, recorded, and reported as a success.
    */
    await seedAwaitingOtp("blocked", 1);
    const [only] = rows("blocked");
    const blocked = await getOrder("blocked");
    const { saveOrder } = await import("./db.server");
    await saveOrder({ ...blocked!, deliveryIssueOpenedAt: NOW });

    const result = await sendDeliveryOtp({
      orderId: "blocked",
      deliveryItemId: only!.id,
      code: "123456",
      adminId: "adm-1",
      adminName: "Admin",
    });

    expect(result.orderFinished).toBeFalsy();
    expect(rows("blocked")[0]?.status).toBe("otp_sent");
    expect((await getOrder("blocked"))?.status).not.toBe("completed");
  });

  it("still refuses to send an OTP for a slot that has no proof", async () => {
    /*
      The guard this whole path rests on, asserted again next to the new
      behaviour: chaining a send and closing an order are things that happen
      AFTER a legitimate OTP, and must not become a way to reach either
      without one.
    */
    await seedAwaitingOtp("noproof", 1);
    const [only] = rows("noproof");
    db.raw
      .prepare(
        `UPDATE order_delivery_items SET status = 'ready', proof_received_at = NULL WHERE id = ?`,
      )
      .run(only!.id);

    await expect(
      sendDeliveryOtp({
        orderId: "noproof",
        deliveryItemId: only!.id,
        code: "123456",
        adminId: "adm-1",
        adminName: "Admin",
      }),
    ).rejects.toThrow("DELIVERY_PROOF_REQUIRED");

    expect(rows("noproof")[0]?.status).toBe("ready");
    expect((await getOrder("noproof"))?.status).not.toBe("completed");
  });

  it("refuses an empty code, before anything else happens", async () => {
    await seedAwaitingOtp("empty", 1);
    const [only] = rows("empty");

    await expect(
      sendDeliveryOtp({
        orderId: "empty",
        deliveryItemId: only!.id,
        code: "   ",
        adminId: "adm-1",
        adminName: "Admin",
      }),
    ).rejects.toThrow("OTP_REQUIRED");

    expect(rows("empty")[0]?.status).toBe("proof_received");
  });
});
