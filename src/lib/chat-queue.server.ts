import {
  listThreads,
  getThread,
  saveThread,
  appendMessage,
  getMessages,
  getAdminAvailabilityStatus,
} from "./db.server";
import { d1All } from "./d1.server";
import { chatRealtime } from "./chat-realtime.server";
import type { Thread, ChatMessage } from "./types";

/** Message bodies are untyped JSON; keep only a real string for the preview. */
function previewText(message: ChatMessage): string | undefined {
  const text = message.body?.["text"];
  return typeof text === "string" ? text : undefined;
}

/**
 * Determines whether a thread is a pure automated AI assistant chat
 * that should be hidden from the admin inbox.
 */
export function isPureAutomatedThread(t: Thread): boolean {
  // If it's linked to an order, it's NOT pure automated
  if (t.orderId) return false;

  // If human support was explicitly requested
  if (t.humanRequested || t.needsAdmin) return false;

  // If admin manually paused AI or took over
  if (t.aiPaused) return false;

  // If the mode is anything that requires admin attention
  if (
    t.mode === "ADMIN_ACTIVE" ||
    t.mode === "ADMIN_ONLY" ||
    t.mode === "ORDER_PREPARATION" ||
    t.mode === "WAITING_FOR_ADMIN" ||
    t.mode === "ESCALATED"
  ) {
    return false;
  }

  // If chatType is GENERAL_SUPPORT or DELIVERY or ORDER_SUPPORT
  if (
    t.chatType === "GENERAL_SUPPORT" ||
    t.chatType === "DELIVERY" ||
    t.chatType === "ORDER_SUPPORT"
  ) {
    return false;
  }

  // Pure automated support: chatType is AUTOMATED_SUPPORT or mode is AI_ACTIVE without admin flags
  return t.chatType === "AUTOMATED_SUPPORT" || t.mode === "AI_ACTIVE" || (!t.chatType && !t.mode);
}

/**
 * Returns true if the thread should be visible in the Admin Inbox.
 */
export function isAdminThread(t: Thread): boolean {
  return !isPureAutomatedThread(t);
}

export interface QueueMetrics {
  isQueueEligible: boolean;
  position: number;
  aheadCount: number;
  estimatedMinutesMin: number;
  estimatedMinutesMax: number;
  estimatedMinutesText: string;
  status: "active" | "queued" | "snoozed" | "serving_now" | "not_queued";
  adminStatus: "available" | "busy" | "offline";
  workingHoursText?: string;
  deliveryStage?:
    | "in_queue"
    | "preparing_now"
    | "awaiting_login_proof"
    | "proof_received"
    | "awaiting_otp"
    | "otp_sent"
    | "completed"
    | "general_active";
  stageLabel?: string;
  accountSentAt?: string | null;
  proofReceivedAt?: string | null;
  otpSentAt?: string | null;
  lastCustomerActivityAt?: string | null;
  lastAdminActivityAt?: string | null;
  activeDeliveryItemId?: string | null;
  activeOrderItemId?: string | null;
  proofUrl?: string | null;
}

// Throttle processInactivityAndQueue so it doesn't run concurrently
let isProcessing = false;
let lastProcessedTime = 0;

/**
 * Scans open threads and enforces real server-side lifecycle rules:
 * 1. Suppresses ALL inactivity postponement and warnings whenever:
 *    - Account credentials have been sent and waiting for user login proof (awaiting_login_proof)
 *    - Login proof has been uploaded and waiting for admin OTP (proof_received)
 *    - Admin is actively working on the order or thread (WAITING_FOR_ADMIN, ORDER_PREPARATION)
 * 2. Does NOT spam multiple 5m/7m/9m warning messages into the chat.
 * 3. Gracefully closes non-order general support tickets only if inactive for >15 minutes in WAITING_FOR_USER mode.
 */
export async function processInactivityAndQueue(): Promise<void> {
  const nowMs = Date.now();
  // Don't run more frequently than once every 5 seconds
  if (isProcessing || nowMs - lastProcessedTime < 5000) return;

  isProcessing = true;
  lastProcessedTime = nowMs;

  try {
    const allThreads = await listThreads();
    const openThreads = allThreads.filter((t) => t.status === "open" && t.mode !== "RESOLVED");

    for (const thread of openThreads) {
      // 1. Check Regular Human Support (GENERAL_SUPPORT without Order)
      const isGeneralSupport =
        (thread.chatType === "GENERAL_SUPPORT" || !thread.orderId) &&
        thread.chatType !== "ORDER_SUPPORT" &&
        thread.chatType !== "DELIVERY";

      if (isGeneralSupport && (thread.mode === "WAITING_FOR_USER" || thread.lastAdminMessageAt)) {
        // Only consider inactivity if thread is explicitly WAITING_FOR_USER and not waiting for admin
        if (
          thread.needsAdmin ||
          thread.mode === "WAITING_FOR_ADMIN" ||
          thread.mode === "ADMIN_ACTIVE"
        ) {
          continue;
        }

        const lastActivity =
          thread.lastAdminMessageAt ||
          thread.lastAdminActivityAt ||
          thread.lastMessageAt ||
          thread.createdAt;
        const diffMs = nowMs - new Date(lastActivity).getTime();

        // 15 Minutes Inactivity Rule for general support tickets
        if (diffMs >= 15 * 60 * 1000 && thread.mode !== "AI_ACTIVE") {
          const autoCloseMsg = await appendMessage(thread.id, {
            senderRole: "system",
            kind: "system",
            body: {
              text: "تم تحويل المحادثة إلى الدعم الآلي لعدم وجود نشاط. يمكنك التحدث مع المساعد الآلي أو طلب الدعم البشري في أي وقت.",
            },
          });

          /*
            The mode goes back to the assistant; the *kind* does not.

            This used to rewrite `chatType` to `AUTOMATED_SUPPORT`, which
            retroactively relabelled a conversation somebody had with a person
            as a conversation with the bot — the badge in the member's history
            changed under them, and the record of a human support ticket
            stopped existing as one.

            It matters far more now that bot threads expire after 24 hours and
            are then deleted: a human support conversation relabelled here
            would have been swept away with them. `chatType` is what the
            expiry reads, so it is what must stay true.
          */
          await saveThread({
            ...thread,
            status: "closed",
            mode: "AI_ACTIVE",
            aiPaused: false,
            needsAdmin: false,
            humanRequested: false,
            lastMessageAt: autoCloseMsg.createdAt,
            lastMessagePreview: previewText(autoCloseMsg),
          });

          await chatRealtime.broadcast(thread.id, {
            type: "thread.updated",
            payload: { threadId: thread.id, status: "closed", mode: "AI_ACTIVE" },
          });
          continue;
        }
      }

      // 2. Check Order Fulfillment Queue (ORDER_SUPPORT or with orderId)
      const isOrderSupport =
        Boolean(thread.orderId) ||
        thread.chatType === "ORDER_SUPPORT" ||
        thread.chatType === "DELIVERY";

      if (isOrderSupport && thread.status === "open") {
        // Check if there are active delivery items in D1
        let deliveryItems: Array<{ status: string; sent_at?: string; proof_received_at?: string }> =
          [];
        if (thread.orderId && (await import("./d1.server").then(m => m.d1Ready()))) {
          try {
            deliveryItems = await d1All<{
              status: string;
              sent_at?: string;
              proof_received_at?: string;
            }>(
              `SELECT status, sent_at, proof_received_at FROM order_delivery_items WHERE order_id = ? AND archived_at IS NULL`,
              thread.orderId,
            );
          } catch {
            deliveryItems = [];
          }
        }

        const hasSentAwaitingProof = deliveryItems.some((item) => item.status === "sent");
        const hasProofReceived = deliveryItems.some((item) => item.status === "proof_received");
        const hasActiveOtp = deliveryItems.some((item) => item.status === "otp_sent");

        // CRITICAL RULE:
        // NEVER send inactivity warnings or snooze if:
        // - Waiting for customer login proof (awaiting_login_proof)
        // - Waiting for admin OTP (proof_received)
        // - Waiting for admin action (needsAdmin, WAITING_FOR_ADMIN, ORDER_PREPARATION)
        // - OTP has been sent and testing (otp_sent)
        if (
          hasSentAwaitingProof ||
          hasProofReceived ||
          hasActiveOtp ||
          thread.needsAdmin ||
          thread.mode === "WAITING_FOR_ADMIN" ||
          thread.mode === "ORDER_PREPARATION" ||
          thread.mode === "ADMIN_ACTIVE"
        ) {
          continue;
        }

        // Only if the thread is purely in WAITING_FOR_USER for a custom inquiry and completely silent for > 20 minutes:
        const lastAdminTime = thread.lastAdminMessageAt || thread.lastAdminActivityAt;
        if (!lastAdminTime) continue;

        const diffMs = nowMs - new Date(lastAdminTime).getTime();
        const diffMinutes = Math.floor(diffMs / 60000);

        if (diffMinutes >= 20 && thread.queueStatus !== "snoozed") {
          const nowIso = new Date().toISOString();
          const snoozeMsg = await appendMessage(thread.id, {
            senderRole: "system",
            kind: "system",
            body: {
              text: "⏸️ تم تأجيل دورك في طابور التجهيز لعدم وجود نشاط. عند عودتك وإرسال أي رسالة، سيتم استئناف خدمتك فوراً.",
            },
          });

          await saveThread({
            ...thread,
            queueStatus: "snoozed",
            queueSnoozedAt: nowIso,
            mode: "WAITING_FOR_USER",
            lastMessageAt: snoozeMsg.createdAt,
            lastMessagePreview: previewText(snoozeMsg),
          });

          await chatRealtime.broadcast(thread.id, {
            type: "thread.updated",
            payload: { threadId: thread.id, queueStatus: "snoozed" },
          });
        }
      }
    }
  } catch (err) {
    console.error("[processInactivityAndQueue] error:", err);
  } finally {
    isProcessing = false;
  }
}

/**
 * Handle a customer sending a message in a snoozed queue thread:
 * Re-enters the queue at the end with queued status.
 */
export async function handleCustomerQueueReentry(thread: Thread): Promise<Thread> {
  const isOrderOrHuman =
    Boolean(thread.orderId) ||
    thread.chatType === "ORDER_SUPPORT" ||
    thread.chatType === "DELIVERY" ||
    thread.chatType === "GENERAL_SUPPORT";

  if (!isOrderOrHuman) return thread;

  const nowIso = new Date().toISOString();
  const wasSnoozed = thread.queueStatus === "snoozed";

  const updated: Thread = {
    ...thread,
    queueStatus: "queued",
    queueEnteredAt: nowIso, // Enters at the end of the queue
    inactivityReminders: [], // Reset reminders
    mode: thread.orderId ? "ORDER_PREPARATION" : "WAITING_FOR_ADMIN",
    needsAdmin: true,
    aiPaused: true,
  };

  if (wasSnoozed) {
    await appendMessage(thread.id, {
      senderRole: "system",
      kind: "system",
      body: {
        text: "👋 مرحباً بعودتك! تم إدراج طلبك في طابور التجهيز مجدداً، وسيتم خدمتك حال وصول دورك في الطابور.",
      },
    });
  }

  return saveThread(updated);
}

/**
 * Skip a customer in the queue (move to the end).
 */
export async function skipQueueCustomer(threadId: string): Promise<Thread | null> {
  const thread = await getThread(threadId);
  if (!thread) return null;

  const nowIso = new Date().toISOString();
  await appendMessage(thread.id, {
    senderRole: "system",
    kind: "system",
    body: {
      text: "تم تأجيل دورك في طابور التجهيز من قبل المشرف وسيتم استئنافه لاحقاً.",
    },
  });

  const updated = await saveThread({
    ...thread,
    queueStatus: "snoozed",
    queueSnoozedAt: nowIso,
    queueEnteredAt: nowIso, // Pushed to back
    mode: "WAITING_FOR_USER",
  });

  await chatRealtime.broadcast(thread.id, {
    type: "thread.updated",
    payload: { threadId: thread.id, queueStatus: "snoozed" },
  });

  return updated;
}

/**
 * Resume a customer in the queue manually (bring to front/active).
 */
export async function resumeQueueCustomer(threadId: string): Promise<Thread | null> {
  const thread = await getThread(threadId);
  if (!thread) return null;

  // Set entry time to past so they are at the front of FIFO queue
  const oldIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  await appendMessage(thread.id, {
    senderRole: "system",
    kind: "system",
    body: {
      text: "تم استئناف دورك في طابور التجهيز الآن مع المشرف.",
    },
  });

  const updated = await saveThread({
    ...thread,
    queueStatus: "active",
    queueEnteredAt: oldIso,
    inactivityReminders: [],
    mode: thread.orderId ? "ORDER_PREPARATION" : "ADMIN_ACTIVE",
    needsAdmin: true,
    aiPaused: true,
  });

  await chatRealtime.broadcast(thread.id, {
    type: "thread.updated",
    payload: { threadId: thread.id, queueStatus: "active" },
  });

  return updated;
}

/**
 * Determines whether a thread is an active digital order requiring preparation and delivery.
 * Excludes human support, automated support, game requests, and general inquiries.
 */
export function isDigitalOrderPreparationThread(t: Thread): boolean {
  if (t.chatType === "GENERAL_SUPPORT" || t.chatType === "AUTOMATED_SUPPORT") return false;
  return Boolean(
    t.orderId ||
    t.chatType === "ORDER_SUPPORT" ||
    t.chatType === "DELIVERY" ||
    t.mode === "ORDER_PREPARATION",
  );
}

/**
 * Real-time queue metrics calculation based on true backend state & D1 records.
 * Strictly calculates queue position, stage, and real timestamps.
 */
export async function calculateQueueMetrics(threadOrOrderId: string): Promise<QueueMetrics> {
  const availability = await getAdminAvailabilityStatus();
  const allThreads = await listThreads();

  const targetThread = allThreads.find(
    (t) => t.id === threadOrOrderId || t.orderId === threadOrOrderId,
  );

  const orderId =
    targetThread?.orderId ||
    (threadOrOrderId.startsWith("ord_") || threadOrOrderId.length > 10
      ? threadOrOrderId
      : undefined);

  // Read real D1 delivery records for this order if present
  let deliveryRows: Array<{
    id: string;
    order_item_id: string;
    status: string;
    sent_at?: string | null;
    proof_received_at?: string | null;
    proof_url?: string | null;
    otp_sent_at?: string | null;
  }> = [];

  if (orderId && (await import("./d1.server").then(m => m.d1Ready()))) {
    try {
      deliveryRows = await d1All<{
        id: string;
        order_item_id: string;
        status: string;
        sent_at?: string | null;
        proof_received_at?: string | null;
        proof_url?: string | null;
        otp_sent_at?: string | null;
      }>(
        `SELECT id, order_item_id, status, sent_at, proof_received_at, proof_url, otp_sent_at
         FROM order_delivery_items
         WHERE order_id = ? AND archived_at IS NULL
         ORDER BY id ASC`,
        orderId,
      );
    } catch {
      deliveryRows = [];
    }
  }

  // Active delivery stage resolution
  let deliveryStage: QueueMetrics["deliveryStage"] = undefined;
  let stageLabel: string | undefined = undefined;
  let accountSentAt: string | null = null;
  let proofReceivedAt: string | null = null;
  let otpSentAt: string | null = null;
  let activeDeliveryItemId: string | null = null;
  let activeOrderItemId: string | null = null;
  let proofUrl: string | null = null;

  if (deliveryRows.length > 0) {
    const sentItem = deliveryRows.find((r) => r.status === "sent");
    const proofItem = deliveryRows.find((r) => r.status === "proof_received");
    const otpItem = deliveryRows.find((r) => r.status === "otp_sent");
    const allCompleted = deliveryRows.every((r) => r.status === "completed");

    if (sentItem) {
      deliveryStage = "awaiting_login_proof";
      stageLabel = "بانتظار إثبات تسجيل الدخول";
      activeDeliveryItemId = sentItem.id;
      activeOrderItemId = sentItem.order_item_id;
      accountSentAt = sentItem.sent_at || null;
    } else if (proofItem) {
      deliveryStage = "proof_received";
      stageLabel = "تم استلام الإثبات، بانتظار OTP";
      activeDeliveryItemId = proofItem.id;
      activeOrderItemId = proofItem.order_item_id;
      accountSentAt = proofItem.sent_at || null;
      proofReceivedAt = proofItem.proof_received_at || null;
      proofUrl = proofItem.proof_url || null;
    } else if (otpItem) {
      deliveryStage = "otp_sent";
      stageLabel = "تم إرسال كود OTP";
      activeDeliveryItemId = otpItem.id;
      activeOrderItemId = otpItem.order_item_id;
      accountSentAt = otpItem.sent_at || null;
      proofReceivedAt = otpItem.proof_received_at || null;
      otpSentAt = otpItem.otp_sent_at || null;
      proofUrl = otpItem.proof_url || null;
    } else if (allCompleted) {
      deliveryStage = "completed";
      stageLabel = "مكتمل ومسلّم";
    }
  }

  // Active queue threads: open and strictly digital orders requiring preparation/delivery
  const queueThreads = allThreads.filter((t) => {
    if (t.status !== "open" || t.mode === "RESOLVED" || isPureAutomatedThread(t)) return false;
    if (t.queueStatus === "snoozed") return false;
    return isDigitalOrderPreparationThread(t);
  });

  // Sort FIFO by queueEnteredAt / createdAt
  queueThreads.sort((a, b) => {
    const timeA = new Date(a.queueEnteredAt || a.createdAt).getTime();
    const timeB = new Date(b.queueEnteredAt || b.createdAt).getTime();
    return timeA - timeB;
  });

  const index = queueThreads.findIndex(
    (t) => t.id === threadOrOrderId || t.orderId === threadOrOrderId,
  );

  const adminStatus: "available" | "busy" | "offline" = !availability.isAvailable
    ? "offline"
    : queueThreads.length > 3
      ? "busy"
      : "available";

  const lastCustomerActivityAt =
    targetThread?.lastUserMessageAt ||
    targetThread?.lastUserActivityAt ||
    ((targetThread as any)?.senderRole === "user" ? targetThread?.lastMessageAt : null) ||
    null;

  const lastAdminActivityAt =
    targetThread?.lastAdminMessageAt ||
    targetThread?.lastAdminActivityAt ||
    ((targetThread as any)?.senderRole === "admin" ? targetThread?.lastMessageAt : null) ||
    null;

  if (index === -1) {
    const isEligible = targetThread
      ? isDigitalOrderPreparationThread(targetThread)
      : Boolean(orderId);

    return {
      isQueueEligible: isEligible,
      position: isEligible ? 1 : 0,
      aheadCount: 0,
      estimatedMinutesMin: isEligible ? 1 : 0,
      estimatedMinutesMax: isEligible ? 3 : 0,
      estimatedMinutesText: isEligible ? "1 - 3 دقائق" : "غير مدرج بالطابور",
      status: isEligible ? "active" : "not_queued",
      adminStatus,
      workingHoursText: availability.workingHoursText,
      deliveryStage: deliveryStage || (isEligible ? "preparing_now" : "general_active"),
      stageLabel,
      accountSentAt,
      proofReceivedAt,
      otpSentAt,
      lastCustomerActivityAt,
      lastAdminActivityAt,
      activeDeliveryItemId,
      activeOrderItemId,
      proofUrl,
    };
  }

  const position = index + 1;
  const aheadCount = index;
  const isFirst = index === 0;
  const status = isFirst ? "serving_now" : "queued";
  const estimatedMinutesMin = isFirst ? 1 : Math.max(2, aheadCount * 2);
  const estimatedMinutesMax = isFirst ? 3 : Math.max(4, aheadCount * 3 + 2);
  const estimatedMinutesText = isFirst
    ? "دورك الآن"
    : `${estimatedMinutesMin}–${estimatedMinutesMax} دقيقة`;

  return {
    isQueueEligible: true,
    position,
    aheadCount,
    estimatedMinutesMin,
    estimatedMinutesMax,
    estimatedMinutesText,
    status,
    adminStatus,
    workingHoursText: availability.workingHoursText,
    deliveryStage: deliveryStage || (isFirst ? "preparing_now" : "in_queue"),
    stageLabel,
    accountSentAt,
    proofReceivedAt,
    otpSentAt,
    lastCustomerActivityAt,
    lastAdminActivityAt,
    activeDeliveryItemId,
    activeOrderItemId,
    proofUrl,
  };
}
