import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  getMessages,
  appendMessage,
  getThread,
  saveThread,
  listThreads,
  listThreadsByUser,
  findUserById,
} from "./db.server";
import { requireAdmin, requireAppAuth, authed } from "./auth.middleware";
import { ChatMessage, Thread, MessageKind, ThreadMode } from "./types";
import {
  isAdminThread,
  processInactivityAndQueue,
  skipQueueCustomer,
  resumeQueueCustomer,
} from "./chat-queue.server";

export const getMyThreads = createServerFn({ method: "GET" })
  .middleware([requireAppAuth])
  .handler(async ({ context }) => {
    const userId = authed(context).userId;
    if (!userId) return [] as Thread[];
    const threads = await listThreadsByUser(userId);
    return threads || [];
  });

export const getAdminThreads = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    // Process automatic inactivity checks and queue updates
    await processInactivityAndQueue();

    const all = await listThreads();
    // Exclude purely automated AI assistant threads. Only show admin / order / human requests.
    const adminVisible = (all || []).filter(isAdminThread);

    return adminVisible.map((t) => ({
      ...t,
      userName: t.userName || "عميل بدون اسم",
      subject: t.subject || (t.chatType === "AUTOMATED_SUPPORT" ? "الدعم الآلي" : "محادثة الدعم"),
      lastMessagePreview: t.lastMessagePreview || "لا توجد رسائل",
    })) as Thread[];
  });

export const skipQueueThread = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(z.object({ threadId: z.string() }))
  .handler(async ({ data }) => {
    return await skipQueueCustomer(data.threadId);
  });

export const resumeQueueThread = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(z.object({ threadId: z.string() }))
  .handler(async ({ data }) => {
    return await resumeQueueCustomer(data.threadId);
  });

export const sendQueueReminder = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(
    z.object({
      threadId: z.string(),
      text: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const thread = await getThread(data.threadId);
    if (!thread) throw new Error("Thread not found");

    const reminderText =
      data.text?.trim() ||
      "⏳ تنبيه من المشرف: نرجو الرد لتأكيد البيانات وإكمال تسليم طلبك في أسرع وقت.";

    const msg = await appendMessage(data.threadId, {
      senderRole: "admin",
      senderName: "المشرف",
      kind: "text",
      body: { text: reminderText },
    });

    thread.lastMessageAt = msg.createdAt;
    thread.lastMessagePreview = reminderText;
    thread.lastAdminMessageAt = msg.createdAt;
    thread.mode = "WAITING_FOR_USER";
    await saveThread(thread);

    // `body` is Record<string, unknown>, which the server-fn serializer rejects.
    // Same widening the paginated reader below already uses.
    return { success: true, message: { ...msg, body: (msg.body || {}) as Record<string, any> } };
  });

export const getThreadMessages = createServerFn({ method: "GET" })
  .middleware([requireAppAuth])
  .validator(
    z.object({
      threadId: z.string(),
      before: z.string().optional(),
      limit: z.number().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { threadId, before, limit } = data;
    const { user, userId } = context;
    if (!userId) throw new Error("Unauthorized");

    const thread = await getThread(threadId);
    if (!thread) {
      return { messages: [] as ChatMessage[], hasMore: false, nextCursor: null };
    }

    const isAdmin = Boolean(user?.isAdmin);
    if (!isAdmin && thread.userId !== userId) {
      throw new Error("Forbidden: Access denied to this conversation");
    }

    const { getPaginatedMessages } = await import("./db.server");
    const result = await getPaginatedMessages(threadId, { before, limit: limit || 10 });

    return {
      messages: result.messages.map((m) => ({
        ...m,
        id: String(m.id),
        body: (m.body || {}) as Record<string, any>,
      })),
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    };
  });

export const markThreadAsRead = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator(z.object({ threadId: z.string() }))
  .handler(async ({ data, context }) => {
    const { threadId } = data;
    const { user, userId } = context;
    if (!userId) throw new Error("Unauthorized");

    const thread = await getThread(threadId);
    if (!thread) return { success: false, error: "Thread not found" };

    const isAdmin = Boolean(user?.isAdmin);
    if (!isAdmin && thread.userId !== userId) {
      throw new Error("Forbidden");
    }

    const now = new Date().toISOString();
    if (isAdmin) {
      thread.adminLastReadAt = now;
      thread.needsAdmin = false;
    } else {
      thread.userLastReadAt = now;
    }
    await saveThread(thread);
    return { success: true, thread };
  });

export const setThreadStatus = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(
    z.object({
      threadId: z.string(),
      status: z.enum(["open", "closed"]),
    }),
  )
  .handler(async ({ data }) => {
    const thread = await getThread(data.threadId);
    if (!thread) throw new Error("Thread not found");

    thread.status = data.status;
    if (data.status === "closed") {
      thread.mode = "RESOLVED";
      thread.needsAdmin = false;
    }
    await saveThread(thread);
    return thread;
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator(
    z.object({
      threadId: z.string(),
      text: z.string().optional(),
      kind: z.string().optional(),
      body: z.record(z.string(), z.any()).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { user, userId } = context;
    if (!userId) throw new Error("Unauthorized");

    const thread = await getThread(data.threadId);
    if (!thread) throw new Error("Thread not found");

    const isAdmin = Boolean(user?.isAdmin);
    if (!isAdmin && thread.userId !== userId) {
      throw new Error("Forbidden");
    }

    const msg = await appendMessage(data.threadId, {
      senderRole: isAdmin ? "admin" : "user",
      senderName: isAdmin ? "المشرف" : user.name || "العميل",
      kind: (data.kind as MessageKind) || "text",
      body: { ...data.body, text: data.text },
    });

    thread.lastMessageAt = new Date().toISOString();
    thread.lastMessagePreview =
      data.text ||
      (data.kind === "credentials"
        ? "بيانات الحساب"
        : data.kind === "otp"
          ? "كود التحقق"
          : data.kind === "instructions"
            ? "تعليمات التشغيل"
            : "مرفق");

    if (isAdmin) {
      thread.mode = "ADMIN_ACTIVE";
      thread.needsAdmin = false;
    } else if (thread.mode === "WAITING_FOR_USER") {
      thread.mode = "ADMIN_ACTIVE";
    }

    await saveThread(thread);
    return { ...msg, body: msg.body as Record<string, any> };
  });

export const setThreadMode = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(
    z.object({
      threadId: z.string(),
      mode: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const thread = await getThread(data.threadId);
    if (!thread) throw new Error("Thread not found");

    thread.mode = data.mode as ThreadMode;
    await saveThread(thread);
    return thread;
  });
