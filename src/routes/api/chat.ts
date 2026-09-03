import { createFileRoute } from "@tanstack/react-router";

import {
  appendMessage,
  getMessages,
  getPaginatedMessages,
  searchMessagesInThread,
  getThread,
  getOrder,
  listThreads,
  listThreadsByUser,
  saveThread,
  getAdminAvailabilityStatus,
  getAdminAvailabilityConfig,
  saveAdminAvailabilityConfig,
  findUserById,
} from "@/lib/db.server";
import { body, guard, json } from "@/lib/http.server";
import { requireUser, requireAdmin } from "@/lib/session.server";
import { buildSupportContext } from "@/lib/support-context.server";
import { suggestAdminReplies } from "@/lib/support/admin-suggestions";
import { supportAnswer } from "@/lib/support/engine";
import { imageAnswer } from "@/lib/support/images";
import { understand } from "@/lib/support/understand.server";
import { chatRealtime } from "@/lib/chat-realtime.server";
import {
  processInactivityAndQueue,
  handleCustomerQueueReentry,
  skipQueueCustomer,
  resumeQueueCustomer,
  calculateQueueMetrics,
} from "@/lib/chat-queue.server";

import type {
  MessageKind,
  ThreadMode,
  ChatType,
  AdminAvailabilityConfig,
  Thread,
  Order,
} from "@/lib/types";
import { randomId } from "@/lib/crypto.server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";
import { redactMessageForMember } from "@/lib/redaction";
import { canAccessThread } from "@/lib/thread-access";
import { isOwnUploadUrl, isVideoUploadUrl } from "@/lib/uploads";

/** Modes where the automated assistant must stay silent (read-only). */
const SILENT_MODES: ThreadMode[] = [
  "ADMIN_ONLY",
  "ORDER_PREPARATION",
  "ADMIN_ACTIVE",
  "ESCALATED",
  "WAITING_FOR_ADMIN",
];

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          const url = new URL(request.url);
          const threadId =
            url.searchParams.get("threadId") || url.searchParams.get("conversationId") || undefined;
          const orderId =
            url.searchParams.get("orderId") || url.searchParams.get("initialOrderId") || undefined;
          const streamParam = url.searchParams.get("stream");
          const actionParam = url.searchParams.get("action");
          const surfaceParam =
            url.searchParams.get("surface") === "admin" && user.isAdmin ? "admin" : "store";

          let availability: any = { isAvailable: true, workingHoursText: "" };
          try {
            availability = await getAdminAvailabilityStatus();
          } catch (availErr) {
            console.warn("[chat:GET:availability_failed]", availErr);
          }

          if (!threadId && !orderId) {
            // Store chat is always personal: even an admin only sees their own
            // threads here. All-customer inbox lives in the admin dashboard.
            let filtered: Thread[] = [];
            try {
              filtered = await listThreadsByUser(user.id);
            } catch (listErr) {
              console.error(
                `[chat:GET:listThreadsByUser_failed] user_id=${user.id} HTTP_status=500 D1_error=${listErr instanceof Error ? listErr.message : String(listErr)} endpoint=/api/chat`,
                listErr,
              );
              filtered = [];
            }

            let adminAvailabilityConfig: any = undefined;
            if (user.isAdmin) {
              try {
                adminAvailabilityConfig = await getAdminAvailabilityConfig();
              } catch (configErr) {
                console.warn("[chat:GET:adminAvailabilityConfig_failed]", configErr);
              }
            }

            return json({
              threads: filtered,
              adminAvailability: availability,
              ...(adminAvailabilityConfig ? { adminAvailabilityConfig } : {}),
            });
          }

          // Robust conversation resolution by threadId and/or orderId
          let thread: Thread | undefined = undefined;
          let linkedOrder: Order | undefined = undefined;

          // 1. Direct thread lookup
          if (threadId) {
            try {
              thread = await getThread(threadId);
            } catch (tErr) {
              console.warn(
                `[chat:GET:getThread_error] conversation_id=${threadId} user_id=${user.id} D1_error=${tErr instanceof Error ? tErr.message : String(tErr)} endpoint=/api/chat`,
                tErr,
              );
            }
          }

          // 2. Order lookup (if orderId is provided OR if threadId might be an order code/ID)
          const targetOrderId = orderId || (!thread && threadId ? threadId : undefined);
          if (targetOrderId) {
            try {
              linkedOrder = await getOrder(targetOrderId);
              if (linkedOrder && !thread && linkedOrder.threadId) {
                thread = await getThread(linkedOrder.threadId);
              }
            } catch (oErr) {
              console.warn(
                `[chat:GET:getOrder_error] order_id=${targetOrderId} user_id=${user.id} D1_error=${oErr instanceof Error ? oErr.message : String(oErr)} endpoint=/api/chat`,
                oErr,
              );
            }
          }

          // 3. If thread has orderId and linkedOrder wasn't loaded yet, load it to verify ownership
          if (thread?.orderId && !linkedOrder) {
            try {
              linkedOrder = await getOrder(thread.orderId);
            } catch (orderFetchErr) {
              console.warn("[chat:GET:fetchLinkedOrder_failed]", orderFetchErr);
            }
          }

          // 4. Auto-healing: If an order exists for the user but its support thread row was missing
          if (!thread && linkedOrder && (linkedOrder.userId === user.id || user.isAdmin)) {
            const newThreadId = linkedOrder.threadId || `thr_${linkedOrder.id}`;
            const now = new Date().toISOString();
            thread = {
              id: newThreadId,
              userId: linkedOrder.userId,
              userName: linkedOrder.userName || user.name,
              orderId: linkedOrder.id,
              chatType: "ORDER_SUPPORT",
              subject: `طلب ${linkedOrder.code}`,
              status: "open",
              mode: "ADMIN_ACTIVE",
              lastMessageAt: linkedOrder.createdAt || now,
              createdAt: linkedOrder.createdAt || now,
            };
            try {
              await saveThread(thread);
            } catch (saveErr) {
              console.warn("[chat:GET:auto_heal_thread_failed]", saveErr);
            }
          }

          // 5. Access control verification:
          // Must be owner of thread OR owner of linked order OR admin
          const isThreadOwner = thread ? thread.userId === user.id : false;
          const isOrderOwner = linkedOrder ? linkedOrder.userId === user.id : false;
          const hasAccess =
            user.isAdmin ||
            isThreadOwner ||
            isOrderOwner ||
            (thread
              ? canAccessThread({
                  viewerId: user.id,
                  isAdmin: Boolean(user.isAdmin),
                  threadUserId: thread.userId,
                  surface: surfaceParam,
                })
              : false);

          if (!thread || !hasAccess) {
            console.warn(
              `[chat:GET:not_found] conversation_id=${threadId || "none"} order_id=${orderId || linkedOrder?.id || "none"} user_id=${user.id} is_admin=${Boolean(user.isAdmin)} HTTP_status=404 endpoint=/api/chat`,
            );
            return json(
              {
                error: "not_found",
                message: "المحادثة غير موجودة أو لا تملك صلاحية الوصول إليها",
              },
              { status: 404 },
            );
          }

          // Record presence for viewer safely
          try {
            await chatRealtime.recordPresence(thread.id, user.id);
          } catch (pErr) {
            console.warn("[chat:GET:recordPresence_failed]", pErr);
          }

          // Handle Search Query
          if (actionParam === "search") {
            const q = url.searchParams.get("q") || "";
            try {
              const results = await searchMessagesInThread(thread.id, q, 30);
              return json({ results });
            } catch (sErr) {
              console.error(
                `[chat:GET:search_failed] conversation_id=${thread.id} user_id=${user.id}`,
                sErr,
              );
              return json({ results: [] });
            }
          }

          // Handle Server-Sent Events (SSE) Stream
          if (streamParam === "1" || request.headers.get("accept")?.includes("text/event-stream")) {
            const streamResponse = await chatRealtime.getStreamResponse(thread.id, request);
            if (streamResponse) {
              return streamResponse;
            }

            const currentThreadId = thread.id;
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
              start(controller) {
                // Send initial greeting event
                controller.enqueue(
                  encoder.encode(
                    `event: connected\ndata: ${JSON.stringify({ threadId: currentThreadId, time: new Date().toISOString() })}\n\n`,
                  ),
                );

                const unsubscribe = chatRealtime.subscribe(currentThreadId, (event) => {
                  try {
                    controller.enqueue(
                      encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
                    );
                  } catch {
                    // Stream closed
                  }
                });

                const pingInterval = setInterval(() => {
                  try {
                    controller.enqueue(
                      encoder.encode(
                        `event: ping\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`,
                      ),
                    );
                  } catch {
                    clearInterval(pingInterval);
                  }
                }, 15000);

                request.signal.addEventListener("abort", () => {
                  clearInterval(pingInterval);
                  unsubscribe();
                  try {
                    controller.close();
                  } catch {
                    // ignore
                  }
                });
              },
            });

            return new Response(stream, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
              },
            });
          }

          // Handle Paginated messages (default limit: 20) with graceful fallback
          const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 50);
          const before = url.searchParams.get("before") || undefined;
          const around = url.searchParams.get("around") || undefined;

          let paginated: {
            messages: any[];
            hasMore: boolean;
            nextCursor: string | null;
            totalCount: number;
          };
          try {
            paginated = await getPaginatedMessages(thread.id, { limit, before, around });
          } catch (d1Err: any) {
            console.error(
              `[chat:GET:messages_failed] conversation_id=${thread.id} order_id=${thread.orderId || "none"} user_id=${user.id} HTTP_status=500 D1_error=${d1Err?.message || String(d1Err)} endpoint=/api/chat`,
              d1Err,
            );
            // Fallback to simple message read or empty list
            try {
              const fallback = await getMessages(thread.id);
              paginated = {
                messages: fallback.slice(-limit),
                hasMore: fallback.length > limit,
                nextCursor: null,
                totalCount: fallback.length,
              };
            } catch {
              paginated = {
                messages: [],
                hasMore: false,
                nextCursor: null,
                totalCount: 0,
              };
            }
          }

          const visible = user.isAdmin
            ? paginated.messages
            : paginated.messages.map(redactMessageForMember);

          let typers: any[] = [];
          try {
            typers = (await chatRealtime.getActiveTypers(thread.id)).filter(
              (t) => t.userId !== user.id,
            );
          } catch (typerErr) {
            console.warn("[chat:GET:typers_failed]", typerErr);
          }

          let isOtherOnline = true;
          try {
            isOtherOnline = user.isAdmin
              ? await chatRealtime.isUserOnline(thread.id, thread.userId)
              : true; // In store chat, admin availability config governs
          } catch (onlineErr) {
            console.warn("[chat:GET:isUserOnline_failed]", onlineErr);
          }

          let queueMetrics: any = null;
          try {
            queueMetrics = await calculateQueueMetrics(thread.orderId || thread.id);
          } catch (qErr) {
            console.warn("[chat:calculateQueueMetrics_failed]", qErr);
          }

          let adminAvailabilityConfig: any = undefined;
          if (user.isAdmin) {
            try {
              adminAvailabilityConfig = await getAdminAvailabilityConfig();
            } catch (configErr) {
              console.warn("[chat:GET:adminAvailabilityConfig_failed]", configErr);
            }
          }

          return json({
            thread,
            messages: visible,
            hasMore: paginated.hasMore,
            nextCursor: paginated.nextCursor,
            totalCount: paginated.totalCount,
            adminAvailability: availability,
            queueMetrics,
            typers,
            isOnline: isOtherOnline,
            ...(adminAvailabilityConfig ? { adminAvailabilityConfig } : {}),
          });
        }),
      POST: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          if (!user.isAdmin) {
            const throttle = await consumeRateLimit(request, "support-chat", 90, 10 * 60, user.id);
            if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);
          }
          const data = await body<{
            action?:
              | "request_human"
              | "get_admin_availability"
              | "set_admin_availability"
              | "create_thread"
              | "typing"
              | "presence"
              | "mark_read"
              | "search"
              | "skip_queue"
              | "resume_queue"
              | "queue_reminder"
              | "reply_suggestions";
            threadId?: string;
            chatType?: ChatType;
            kind?: MessageKind;
            text?: string;
            imageUrl?: string;
            close?: boolean;
            create?: boolean;
            subject?: string;
            orderId?: string;
            isTyping?: boolean;
            clientMessageId?: string;
            q?: string;
            surface?: "store" | "admin";
            body?: any;
            /** admin availability config */
            adminAvailabilityConfig?: Partial<AdminAvailabilityConfig>;
            /** admin controls */
            mode?: ThreadMode;
            aiPaused?: boolean;
            /** client context signals */
            pageContext?: { path?: string; productId?: string; productTitle?: string };
            viewHistory?: { productId: string; title: string }[];
          }>(request);

          // Ephemeral typing
          if (data.action === "typing" && data.threadId) {
            const thread = await getThread(data.threadId);
            if (
              !thread ||
              !canAccessThread({
                viewerId: user.id,
                isAdmin: Boolean(user.isAdmin),
                threadUserId: thread.userId,
                surface: data.surface === "admin" && user.isAdmin ? "admin" : "store",
              })
            ) {
              return json({ error: "not_found" }, { status: 404 });
            }
            await chatRealtime.setTyping(
              data.threadId,
              { id: user.id, name: user.name, role: user.isAdmin ? "admin" : "user" },
              Boolean(data.isTyping),
            );
            return json({ success: true });
          }

          // Ephemeral presence heartbeat
          if (data.action === "presence" && data.threadId) {
            const thread = await getThread(data.threadId);
            if (
              !thread ||
              !canAccessThread({
                viewerId: user.id,
                isAdmin: Boolean(user.isAdmin),
                threadUserId: thread.userId,
                surface: data.surface === "admin" && user.isAdmin ? "admin" : "store",
              })
            ) {
              return json({ error: "not_found" }, { status: 404 });
            }
            await chatRealtime.recordPresence(data.threadId, user.id);
            return json({ success: true });
          }

          // Search messages
          if (data.action === "search" && data.threadId && data.q) {
            const thread = await getThread(data.threadId);
            if (
              !thread ||
              !canAccessThread({
                viewerId: user.id,
                isAdmin: Boolean(user.isAdmin),
                threadUserId: thread.userId,
                surface: data.surface === "admin" && user.isAdmin ? "admin" : "store",
              })
            ) {
              return json({ error: "not_found" }, { status: 404 });
            }
            const results = await searchMessagesInThread(data.threadId, data.q, 30);
            return json({ results });
          }

          // Mark thread as read
          if (data.action === "mark_read" && data.threadId) {
            const thread = await getThread(data.threadId);
            if (
              !thread ||
              !canAccessThread({
                viewerId: user.id,
                isAdmin: Boolean(user.isAdmin),
                threadUserId: thread.userId,
                surface: data.surface === "admin" && user.isAdmin ? "admin" : "store",
              })
            ) {
              return json({ error: "not_found" }, { status: 404 });
            }
            if (thread) {
              const now = new Date().toISOString();
              const readerRole = data.surface === "admin" && user.isAdmin ? "admin" : "user";

              if (readerRole === "admin") {
                thread.adminLastReadAt = now;
                thread.needsAdmin = false;
              } else {
                thread.userLastReadAt = now;
              }
              await saveThread(thread);
              await chatRealtime.broadcast(data.threadId, {
                type: "read.update",
                payload: {
                  threadId: thread.id,
                  readerRole,
                  readerUserId: user.id,
                  lastReadAt: now,
                },
              });
            }
            return json({ success: true });
          }

          // Availability queries / updates
          if (data.action === "get_admin_availability") {
            const availability = await getAdminAvailabilityStatus();
            return json({
              availability,
              config: user.isAdmin ? await getAdminAvailabilityConfig() : undefined,
            });
          }

          if (data.action === "set_admin_availability") {
            await requireAdmin(request);
            if (!data.adminAvailabilityConfig) {
              return json({ error: "missing_config" }, { status: 400 });
            }
            const updatedConfig = await saveAdminAvailabilityConfig(data.adminAvailabilityConfig);
            const availability = await getAdminAvailabilityStatus();
            return json({ success: true, config: updatedConfig, availability });
          }

          // Queue Actions: Skip, Resume, Reminder
          if (data.action === "skip_queue" && data.threadId) {
            await requireAdmin(request);
            const updated = await skipQueueCustomer(data.threadId);
            return json({ success: true, thread: updated });
          }

          if (data.action === "resume_queue" && data.threadId) {
            await requireAdmin(request);
            const updated = await resumeQueueCustomer(data.threadId);
            return json({ success: true, thread: updated });
          }

          // Ranked reply suggestions for the staff member answering a thread.
          if (data.action === "reply_suggestions" && data.threadId) {
            const admin = await requireAdmin(request);
            const targetThread = await getThread(data.threadId);
            if (!targetThread) return json({ error: "not_found" }, { status: 404 });

            const history = await getMessages(data.threadId);
            const owner = await findUserById(targetThread.userId);
            if (!owner) return json({ error: "not_found" }, { status: 404 });

            // The same sanitised context the automated assistant runs on, so a
            // suggestion can never contain anything the customer may not see.
            const suggestionCtx = await buildSupportContext({
              user: owner,
              thread: targetThread,
            });
            const suggestions = suggestAdminReplies({
              messages: history.map((message) => ({
                senderRole: message.senderRole,
                kind: message.kind,
                text: typeof message.body?.["text"] === "string" ? message.body["text"] : "",
                createdAt: message.createdAt,
              })),
              ctx: suggestionCtx,
            });
            return json({ suggestions, actor: admin.id });
          }

          if (data.action === "queue_reminder" && data.threadId) {
            await requireAdmin(request);
            const targetThread = await getThread(data.threadId);
            if (!targetThread) return json({ error: "not_found" }, { status: 404 });

            const reminderText =
              data.text?.trim() ||
              "⏳ تنبيه من المشرف: نرجو الرد لتأكيد البيانات وإكمال تسليم طلبك في أسرع وقت.";

            const msg = await appendMessage(data.threadId, {
              senderRole: "admin",
              senderName: user.name || "المشرف",
              kind: "text",
              body: { text: reminderText },
            });

            await saveThread({
              ...targetThread,
              lastMessageAt: msg.createdAt,
              lastMessagePreview: reminderText,
              lastAdminMessageAt: msg.createdAt,
              mode: "WAITING_FOR_USER",
            });

            return json({ success: true, message: msg });
          }

          // User requesting human support from automated support
          if (data.action === "request_human") {
            const availability = await getAdminAvailabilityStatus();
            if (!availability.isAvailable) {
              // Admin is NOT available: Never queue or set WAITING_FOR_ADMIN
              return json({
                success: false,
                isAvailable: false,
                offlineMessage: availability.offlineMessage,
                workingHoursText: availability.workingHoursText,
                currentBaghdadTime: availability.currentBaghdadTime,
              });
            }

            // Admin is available: Reuse any existing active human GENERAL_SUPPORT thread for this user (prevent duplicate tickets)
            const userThreads = await listThreadsByUser(user.id);
            let humanThread = userThreads.find(
              (t) =>
                (t.chatType === "GENERAL_SUPPORT" || (t.chatType as string) === "SUPPORT") &&
                t.status === "open" &&
                !t.orderId,
            );

            const now = new Date().toISOString();
            if (!humanThread) {
              humanThread = await saveThread({
                id: randomId("thr"),
                userId: user.id,
                userName: user.name,
                subject: "محادثة الدعم مع الإدارة",
                chatType: "GENERAL_SUPPORT",
                status: "open",
                mode: "WAITING_FOR_ADMIN",
                aiPaused: true,
                needsAdmin: true,
                lastMessageAt: now,
                createdAt: now,
              });
              await appendMessage(humanThread.id, {
                senderRole: "system",
                kind: "system",
                body: {
                  text: "تم إنشاء طلب محادثة مع الإدارة. تم وضع المحادثة بانتظار استلام أحد المشرفين.",
                },
              });
            } else {
              // Idempotency: only append notification if not already in waiting/active state
              const needsStateUpdate =
                humanThread.mode !== "WAITING_FOR_ADMIN" && humanThread.mode !== "ADMIN_ACTIVE";

              humanThread = await saveThread({
                ...humanThread,
                mode: humanThread.mode === "ADMIN_ACTIVE" ? "ADMIN_ACTIVE" : "WAITING_FOR_ADMIN",
                aiPaused: true,
                needsAdmin: true,
                lastMessageAt: now,
              });

              if (needsStateUpdate) {
                await appendMessage(humanThread.id, {
                  senderRole: "system",
                  kind: "system",
                  body: {
                    text: "طلب العميل التحدث مع الإدارة. تم وضع المحادثة بانتظار استلام المشرف.",
                  },
                });
              }
            }

            /*
              Tell the admins. This is the point of the escalation, and until
              now it was the one admin-facing event that notified nobody: the
              thread was flagged `needsAdmin` and everyone waited for the
              customer to say something else.

              Fire and forget — a Telegram outage must not turn a customer's
              request for help into an error on their screen.
            */
            void (async () => {
              try {
                const { notifyAdminHumanSupportRequest } = await import(
                  "@/lib/telegram-notifications.server"
                );
                await notifyAdminHumanSupportRequest({
                  threadId: humanThread.id,
                  user: { id: user.id, name: user.name, username: user.username },
                  lastUserText: humanThread.lastMessagePreview ?? "",
                });
              } catch (err) {
                console.error("[chat:human_support_notify_failed]", err);
              }
            })();

            return json({
              success: true,
              isAvailable: true,
              targetThreadId: humanThread.id,
              thread: humanThread,
            });
          }

          if (data.text && data.text.length > 4000) {
            return json({ error: "message_too_long" }, { status: 413 });
          }
          if (data.imageUrl && !isOwnUploadUrl(data.imageUrl, user.id)) {
            return json({ error: "invalid_image" }, { status: 400 });
          }

          // Open a new thread
          if (data.create && !data.threadId) {
            const now = new Date().toISOString();
            const requestedType: ChatType =
              data.chatType || (data.orderId ? "ORDER_SUPPORT" : "GENERAL_SUPPORT");
            const isAuto = requestedType === "AUTOMATED_SUPPORT";
            const isOrder =
              requestedType === "ORDER_SUPPORT" ||
              requestedType === "DELIVERY" ||
              Boolean(data.orderId);

            const availability = await getAdminAvailabilityStatus();
            let initialMode: ThreadMode = "ADMIN_ONLY";
            let aiPaused = true;
            let needsAdmin = false;

            if (isAuto) {
              initialMode = "AI_ACTIVE";
              aiPaused = false;
              needsAdmin = false;
            } else if (isOrder) {
              initialMode = "ORDER_PREPARATION";
              aiPaused = true;
              needsAdmin = false;
            } else {
              // GENERAL_SUPPORT
              if (availability.isAvailable) {
                initialMode = "WAITING_FOR_ADMIN";
                aiPaused = true;
                needsAdmin = true;
              } else {
                initialMode = "ADMIN_ONLY";
                aiPaused = true;
                needsAdmin = false;
              }
            }

            const created = await saveThread({
              id: randomId("thr"),
              userId: user.id,
              userName: user.name,
              orderId: data.orderId,
              subject:
                data.subject?.trim().slice(0, 120) || (isAuto ? "الدعم الآلي" : "محادثة الدعم"),
              chatType: requestedType,
              status: "open",
              mode: initialMode,
              aiPaused,
              needsAdmin,
              lastMessageAt: now,
              createdAt: now,
            });

            if (isAuto) {
              // Clean automated support without database pollution
            } else if (!isOrder && !availability.isAvailable) {
              await appendMessage(created.id, {
                senderRole: "system",
                kind: "system",
                body: {
                  text: availability.offlineMessage,
                  offlineNotice: {
                    workingHoursText: availability.workingHoursText,
                    currentBaghdadTime: availability.currentBaghdadTime,
                  },
                },
              });
            } else {
              await appendMessage(created.id, {
                senderRole: "system",
                kind: "system",
                body: {
                  text: isOrder
                    ? "تم فتح محادثة تجهيز الطلب مع الإدارة."
                    : "تم فتح محادثة الدعم مع الإدارة.",
                },
              });
            }

            return json({ thread: created, messages: await getMessages(created.id) });
          }

          const thread = data.threadId ? await getThread(data.threadId) : undefined;
          if (!thread) {
            console.error(
              `[chat:error:thread_not_found] threadId=${data.threadId} senderId=${user.id} isAdmin=${Boolean(user.isAdmin)}`,
            );
            return json(
              {
                error: "not_found",
                message: "المحادثة غير موجودة أو تم حذفها",
                conversation_id: data.threadId,
                sender_id: user.id,
                status: 404,
              },
              { status: 404 },
            );
          }

          let linkedOrder: Order | undefined = undefined;
          if (thread.orderId) {
            try {
              linkedOrder = await getOrder(thread.orderId);
            } catch (err) {
              console.warn("[chat:POST:fetchLinkedOrder_failed]", err);
            }
          }
          const isThreadOwner = thread.userId === user.id;
          const isOrderOwner = linkedOrder ? linkedOrder.userId === user.id : false;
          const hasPostAccess =
            user.isAdmin ||
            isThreadOwner ||
            isOrderOwner ||
            canAccessThread({
              viewerId: user.id,
              isAdmin: Boolean(user.isAdmin),
              threadUserId: thread.userId,
              surface: data.surface === "admin" && user.isAdmin ? "admin" : "store",
            });

          if (!hasPostAccess) {
            console.error(
              `[chat:POST:access_denied] conversation_id=${data.threadId} order_id=${thread.orderId || "none"} sender_id=${user.id} thread_owner=${thread.userId} is_admin=${Boolean(user.isAdmin)} HTTP_status=403 endpoint=/api/chat`,
            );
            return json(
              {
                error: "forbidden",
                message: "ليس لديك صلاحية الوصول لهذه المحادثة",
                conversation_id: data.threadId,
                sender_id: user.id,
                status: 403,
              },
              { status: 403 },
            );
          }

          let current = thread;

          if (
            user.isAdmin &&
            (data.close !== undefined || data.mode || data.aiPaused !== undefined || data.chatType)
          ) {
            current = await saveThread({
              ...current,
              ...(data.close !== undefined ? { status: data.close ? "closed" : "open" } : {}),
              ...(data.mode ? { mode: data.mode } : {}),
              ...(data.aiPaused !== undefined ? { aiPaused: data.aiPaused } : {}),
              ...(data.chatType ? { chatType: data.chatType } : {}),
            });
          }

          if (!data.text && !data.imageUrl && !data.body && !data.kind) {
            return json({ success: true, thread: current });
          }

          // Credentials and OTP are state transitions, not ordinary chat
          // messages. Requiring the dedicated D1 action prevents a message
          // body (or stale React state) from bypassing delivery_item_id.
          if (
            user.isAdmin &&
            (data.kind === "item_credentials" || data.kind === "item_verification_code")
          ) {
            return json(
              {
                error: "delivery_action_required",
                message: "استخدم أداة التسليم المرتبطة بـ delivery_item_id لإرسال الحساب أو OTP",
              },
              { status: 409 },
            );
          }

          // Reset user typing on send
          await chatRealtime.setTyping(
            current.id,
            { id: user.id, name: user.name, role: user.isAdmin ? "admin" : "user" },
            false,
          );

          let message;
          try {
            const senderRole =
              user.isAdmin && data.surface === "admin"
                ? "admin"
                : user.isService
                  ? "system"
                  : "user";

            message = await appendMessage(current.id, {
              senderRole,
              senderName: user.name,
              kind: data.imageUrl
                ? isVideoUploadUrl(data.imageUrl)
                  ? "video"
                  : (data.kind ?? "image")
                : (data.kind ?? "text"),
              clientMessageId: data.clientMessageId,
              body:
                data.body ||
                (data.imageUrl
                  ? { imageUrl: data.imageUrl, ...(data.text ? { text: data.text } : {}) }
                  : { text: data.text }),
            });
          } catch (appendErr: any) {
            console.error(
              `[chat:POST:appendMessage_failed] conversation_id=${current.id} sender_id=${user.id} client_message_id=${data.clientMessageId} HTTP_status=500 D1_error=`,
              appendErr?.message || appendErr,
            );
            return json(
              {
                error: "message_append_failed",
                message: "فشل إرسال الرسالة لقاعدة البيانات، يرجى إعادة المحاولة",
                conversation_id: current.id,
                sender_id: user.id,
                client_message_id: data.clientMessageId,
                status: 500,
                d1_error: appendErr?.message || String(appendErr),
              },
              { status: 500 },
            );
          }

          // Update thread lastMessageAt
          current.lastMessageAt = message.createdAt;
          current.lastMessagePreview = data.body?.title || data.text || "مرفق";
          if (!user.isAdmin) {
            current.userLastReadAt = message.createdAt;
          } else if (data.surface === "admin") {
            current.adminLastReadAt = message.createdAt;
          }

          // An admin reply always takes the conversation over and opens the thread if closed
          if (user.isAdmin && data.surface === "admin") {
            await saveThread({
              ...current,
              status: "open",
              mode: "ADMIN_ACTIVE",
              aiPaused: true,
              needsAdmin: false,
              lastAdminMessageAt: message.createdAt,
              inactivityReminders: [],
            });

            // Notify user in Telegram (Safe)
            try {
              const { notifyUserAdminMessage } =
                await import("@/lib/telegram-notifications.server");
              await notifyUserAdminMessage({
                userId: current.userId,
                threadId: current.id,
                messageText: data.text || "أرسل الدعم مرفقاً جديداً",
                adminName: user.name || "فريق الإدارة",
              });
            } catch (err) {
              console.warn("[chat:notify_user_failed]", err);
            }

            return json({
              message,
              clientMessageId: data.clientMessageId,
            });
          }

          // STRICT SERVER-SIDE RULE:
          // ORDER / DELIVERY / ACCOUNT DELIVERY / CARD CODE / PAYMENT -> HUMAN/ORDER ONLY. AI NEVER PARTICIPATES.
          // GENERAL_SUPPORT -> Human support only (AI never participates in general support threads).
          // AI ONLY PARTICIPATES IN AUTOMATED_SUPPORT THREADS.
          const isOrderOrDelivery =
            current.chatType === "ORDER_SUPPORT" ||
            current.chatType === "DELIVERY" ||
            Boolean(current.orderId);

          const isAutomatedThread = current.chatType === "AUTOMATED_SUPPORT" && !isOrderOrDelivery;

          if (!isAutomatedThread) {
            // Customer is sending message in order or human support thread
            current.lastUserMessageAt = message.createdAt;
            current = await handleCustomerQueueReentry(current);

            // Notify Admin in Telegram about customer message in order/human support (Safe)
            try {
              const { notifyAdminCustomerMessage } =
                await import("@/lib/telegram-notifications.server");
              await notifyAdminCustomerMessage({
                thread: current,
                message: { text: data.text, imageUrl: data.imageUrl, senderRole: "user" },
                user: { id: user.id, name: user.name, phone: user.phone, username: user.username },
              });
            } catch (err) {
              console.warn("[chat:notify_admin_failed]", err);
            }

            // Check availability to notify user if sending to offline admin
            const availability = await getAdminAvailabilityStatus();
            if (current.chatType === "GENERAL_SUPPORT" && !availability.isAvailable) {
              // Append system offline reminder if needed
              const recent = await getMessages(current.id);
              const lastWasOffline = recent
                .slice(-3)
                .some(
                  (m) =>
                    m.body &&
                    (m.body["offlineNotice"] ||
                      (typeof m.body["text"] === "string" &&
                        m.body["text"].includes("فريق الدعم غير متاح"))),
                );
              if (!lastWasOffline) {
                const systemMessage = await appendMessage(current.id, {
                  senderRole: "system",
                  kind: "system",
                  body: {
                    text: availability.offlineMessage,
                    offlineNotice: {
                      workingHoursText: availability.workingHoursText,
                      currentBaghdadTime: availability.currentBaghdadTime,
                    },
                  },
                });
              }
            } else if (current.chatType === "GENERAL_SUPPORT" && availability.isAvailable) {
              await saveThread({
                ...current,
                mode: "WAITING_FOR_ADMIN",
                needsAdmin: true,
                aiPaused: true,
              });
            }
            return json({ message, assistant: null, clientMessageId: data.clientMessageId });
          }

          const mode: ThreadMode = current.mode ?? "AI_ACTIVE";
          const silent =
            current.aiPaused || SILENT_MODES.includes(mode) || current.status === "closed";
          if (silent || (!data.text?.trim() && !data.imageUrl)) {
            return json({ message, assistant: null, clientMessageId: data.clientMessageId });
          }

          // Automated support: sanitised context only for FAQ and general assistance
          const context = await buildSupportContext({
            user,
            thread: current,
            ...(data.pageContext ? { pageContext: data.pageContext } : {}),
            ...(data.viewHistory ? { viewHistory: data.viewHistory } : {}),
          });

          let reply;
          if (data.imageUrl) {
            const history = await getMessages(current.id);
            const imageCount = history.filter(
              (item) => item.senderRole === "user" && Boolean(item.body["imageUrl"]),
            ).length;
            reply = imageAnswer(
              { imageCount, ...(data.text?.trim() ? { caption: data.text } : {}) },
              context,
            );
          } else {
            const past = (await getMessages(current.id))
              .filter((item) => item.senderRole === "user" || item.senderRole === "assistant")
              .slice(-8)
              .map((item) => ({
                role: item.senderRole === "user" ? ("user" as const) : ("assistant" as const),
                text: String(item.body["text"] ?? ""),
              }))
              .filter((item) => item.text);
            const hint = await understand(data.text!, context, past);
            reply = supportAnswer(data.text!, context, hint);
          }

          const assistant = await appendMessage(current.id, {
            senderRole: "assistant",
            senderName: "الدعم الآلي",
            kind: "text",
            body: {
              text: reply.text,
              cards: reply.cards,
              suggestions: reply.suggestions,
              escalate: reply.escalate,
              support: { memory: reply.memory, trace: reply.trace },
            },
          });

          await saveThread({
            ...current,
            mode: "WAITING_FOR_USER" as ThreadMode,
          });

          return json({
            message,
            assistant: user.isAdmin ? assistant : redactMessageForMember(assistant),
            clientMessageId: data.clientMessageId,
          });
        }),
    },
  },
});
