import React, { useState, useEffect, useRef, useTransition } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useChatRealtime } from "@/hooks/useChatRealtime";
import { Thread, ChatMessage, ThreadMode, Order } from "@/lib/types";

interface ThreadMessagesPage {
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor: string | null;
}
import { api } from "@/lib/api";
import {
  getAdminThreads,
  getThreadMessages,
  setThreadMode,
  setThreadStatus,
  markThreadAsRead,
  skipQueueThread,
  resumeQueueThread,
  sendQueueReminder,
} from "@/lib/support.functions";
import { CustomerList } from "./CustomerList";
import { ActiveConversation, ConversationErrorBoundary } from "./ActiveConversation";
import { ManualCompletionDialog } from "./ManualCompletionDialog";
import { AdminAvailabilityBar } from "./AdminAvailabilityBar";
import { InboxFilter } from "./types";
import { toast } from "sonner";
import { normalizeMessage, type NormalizedChatMessage } from "@/lib/message-normalizer";

interface AdminInboxViewProps {
  initialThreadId?: string | null;
  onNavigateToOrder?: (orderId: string) => void;
}

export function AdminInboxView({ initialThreadId = null, onNavigateToOrder }: AdminInboxViewProps) {
  const queryClient = useQueryClient();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initialThreadId);
  const [activeFilter, setActiveFilter] = useState<InboxFilter>("order_queue");
  const [manualCompletion, setManualCompletion] = useState<{
    orderId: string;
    code: string;
    pendingCount?: number;
    unmappedCount?: number;
  } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [, startTransition] = useTransition();

  // State to hold active messages for selected thread
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [isCustomerTyping, setIsCustomerTyping] = useState(false);
  const [isCustomerOnline, setIsCustomerOnline] = useState(false);
  const [customerLastReadAt, setCustomerLastReadAt] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  // Sync initialThreadId changes from parent or URL
  useEffect(() => {
    if (initialThreadId) {
      setSelectedThreadId(initialThreadId);
    }
  }, [initialThreadId]);

  // 1. Fetch all admin threads with 8s polling interval
  const { data: threads = [], isLoading: isThreadsLoading } = useQuery({
    queryKey: ["admin-threads"],
    queryFn: async () => {
      try {
        const res = await getAdminThreads();
        return (res || []) as Thread[];
      } catch (err) {
        console.error("Error fetching admin threads:", err);
        return [] as Thread[];
      }
    },
    refetchInterval: 8000,
  });

  // 2. Fetch admin orders to cross-reference customer history & linked orders
  const { data: orders = [] } = useQuery({
    queryKey: ["admin-orders"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/orders?all=1", { credentials: "include" });
        if (!res.ok) return [] as Order[];
        const data = await res.json();
        return (data.orders || []) as Order[];
      } catch {
        return [] as Order[];
      }
    },
    refetchInterval: 15000,
  });

  // 3. Auto-select first thread if none selected on desktop
  useEffect(() => {
    if (
      !selectedThreadId &&
      threads.length > 0 &&
      typeof window !== "undefined" &&
      window.innerWidth >= 768
    ) {
      setSelectedThreadId(threads[0]?.id ?? null);
    }
  }, [threads, selectedThreadId]);

  // 4. Clean conversation switch:
  // Reset message state, reset typing & presence, abort previous query
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Clear state on conversation change to prevent state bleed
    setLiveMessages([]);
    setHasMore(false);
    setNextCursor(null);
    setIsCustomerTyping(false);
    setIsCustomerOnline(false);
    setCustomerLastReadAt(null);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [selectedThreadId]);

  // 5. Fetch initial messages strictly by selectedThreadId
  const { data: initialMessagesData, isLoading: isMessagesLoading } = useQuery({
    queryKey: ["thread-messages", selectedThreadId],
    queryFn: async () => {
      if (!selectedThreadId) return null;
      try {
        const res = (await getThreadMessages({
          data: { threadId: selectedThreadId, limit: 20 },
        })) as ThreadMessagesPage;

        // Pass every message through centralized normalizer
        const normalized = (res?.messages || []).map((m) => normalizeMessage(m, selectedThreadId));
        return {
          messages: normalized,
          hasMore: Boolean(res?.hasMore),
          nextCursor: res?.nextCursor || null,
        };
      } catch (err) {
        console.error("Error fetching thread messages:", err);
        return null;
      }
    },
    enabled: !!selectedThreadId,
    staleTime: 0,
    gcTime: 0,
  });

  // Populate liveMessages upon query resolution
  useEffect(() => {
    if (initialMessagesData && selectedThreadId) {
      startTransition(() => {
        setLiveMessages(initialMessagesData.messages);
        setHasMore(initialMessagesData.hasMore);
        setNextCursor(initialMessagesData.nextCursor);
      });
    }
  }, [initialMessagesData, selectedThreadId]);

  const handleLoadOlder = async (container: HTMLDivElement | null) => {
    if (!selectedThreadId || !nextCursor || isLoadingOlder) return;
    setIsLoadingOlder(true);

    const prevScrollHeight = container ? container.scrollHeight : 0;
    const prevScrollTop = container ? container.scrollTop : 0;

    try {
      const res = (await getThreadMessages({
        data: { threadId: selectedThreadId, before: nextCursor, limit: 15 },
      })) as ThreadMessagesPage;

      const normalized = (res?.messages || []).map((m) => normalizeMessage(m, selectedThreadId));

      setLiveMessages((prev) => [...normalized, ...prev]);
      setHasMore(res.hasMore);
      setNextCursor(res.nextCursor);

      requestAnimationFrame(() => {
        if (container) {
          const newScrollHeight = container.scrollHeight;
          container.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
        }
      });
    } catch (err) {
      console.error("Failed to load older messages", err);
    } finally {
      setIsLoadingOlder(false);
    }
  };

  // 6. Realtime subscription strictly scoped to selectedThreadId
  useChatRealtime({
    threadId: selectedThreadId,
    surface: "admin",
    onMessageCreated: (rawMsg, clientMsgId) => {
      if (!selectedThreadId) return;
      const safeMsg = normalizeMessage(rawMsg, selectedThreadId);

      setLiveMessages((prev) => {
        const existsById = prev.some((m) => m.id === safeMsg.id);
        if (existsById) return prev;

        const existingTempIndex = clientMsgId ? prev.findIndex((m) => m.id === clientMsgId) : -1;

        if (existingTempIndex !== -1) {
          const copy = [...prev];
          copy[existingTempIndex] = safeMsg;
          return copy;
        }
        return [...prev, safeMsg];
      });
      queryClient.invalidateQueries({ queryKey: ["admin-threads"] });
    },
    onThreadUpdated: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-threads"] });
    },
    onTypingUpdate: (typers) => {
      const isCustomerTypingNow = typers.some((t) => t.senderRole === "user");
      setIsCustomerTyping(isCustomerTypingNow);
    },
    onPresenceUpdate: (participants) => {
      const isCustomerOnlineNow = participants.some((p) => true);
      setIsCustomerOnline(isCustomerOnlineNow);
    },
    onReadUpdate: (data) => {
      if (data.readerRole === "user") {
        setCustomerLastReadAt(data.lastReadAt);
      }
    },
  });

  // Heartbeat presence interval for admin
  useEffect(() => {
    if (!selectedThreadId) return;
    const presenceInterval = setInterval(() => {
      void api.sendPresence(selectedThreadId, "admin");
    }, 45_000);
    void api.sendPresence(selectedThreadId, "admin");
    return () => clearInterval(presenceInterval);
  }, [selectedThreadId]);

  // 7. Mark thread as read when selected
  const markReadMutation = useMutation({
    mutationFn: (threadId: string) => markThreadAsRead({ data: { threadId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-threads"] });
    },
  });

  const handleSelectThread = (threadId: string) => {
    setSelectedThreadId(threadId);
    markReadMutation.mutate(threadId);
  };

  // 8. Send message mutation with optimistic updates, server ACK, and error retry
  const sendMutation = useMutation({
    mutationFn: (data: {
      threadId: string;
      text?: string;
      kind?: string;
      body?: any;
      imageUrl?: string;
      clientMessageId?: string;
    }) => {
      const clientMessageId =
        data.clientMessageId ||
        `admin-${data.threadId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const payload: any = {
        threadId: data.threadId,
        surface: "admin",
        clientMessageId,
      };
      if (data.text) payload.text = data.text;
      if (data.kind) payload.kind = data.kind;
      if (data.body) payload.body = data.body;
      if (data.imageUrl) {
        payload.body = { ...payload.body, imageUrl: data.imageUrl };
      }
      return api.sendMessage(payload);
    },
    onMutate: async (newMsgData) => {
      await queryClient.cancelQueries({ queryKey: ["thread-messages", selectedThreadId] });

      const tempId =
        newMsgData.clientMessageId ||
        `admin-${newMsgData.threadId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      newMsgData.clientMessageId = tempId;

      if (selectedThreadId) {
        const rawOptimistic: ChatMessage = {
          id: tempId,
          threadId: selectedThreadId,
          senderRole: "admin",
          senderName: "المشرف",
          kind: (newMsgData.kind as any) || (newMsgData.imageUrl ? "image" : "text"),
          body: {
            ...newMsgData.body,
            text: newMsgData.text,
            imageUrl: newMsgData.imageUrl,
            clientMessageId: tempId,
          },
          createdAt: new Date().toISOString(),
        };

        const optimisticMsg = {
          ...normalizeMessage(rawOptimistic, selectedThreadId),
          pending: true,
          isFailed: false,
          rawPayload: newMsgData,
        };

        // Update live messages or replace existing pending/failed message
        setLiveMessages((prev) => {
          const filtered = prev.filter(
            (m) => m.id !== tempId && (m.body as any)?.clientMessageId !== tempId,
          );
          return [...filtered, optimisticMsg];
        });
      }

      return { tempId };
    },
    onSuccess: (res, newMsgData, context) => {
      const confirmed = res?.message;
      const clientMessageId = res?.clientMessageId || context?.tempId || newMsgData.clientMessageId;

      if (confirmed) {
        const normalized = normalizeMessage(confirmed, selectedThreadId || confirmed.threadId);
        setLiveMessages((prev) =>
          prev.map((m) =>
            m.id === context?.tempId ||
            (m.body as any)?.clientMessageId === clientMessageId ||
            m.id === confirmed.id
              ? { ...normalized, pending: false, isFailed: false }
              : m,
          ),
        );

        /*
          Advance only when the *server* says the order is finished.

          This used to fire on any verification code, so an order with three
          games threw the admin out after the first one. It also guessed the
          "next" order from whatever `threads` happened to hold in memory rather
          than the real queue. The server now decides both — see
          `finalizeDeliveryIfComplete` — and reports the next order in queue
          order; the client just follows.
        */
        if (res?.orderFinished) {
          // The queue moved: everyone's position and the order list are stale.
          void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
          void queryClient.invalidateQueries({ queryKey: ["admin-threads"] });
          const nextThreadId = res.nextOrder?.threadId;
          if (nextThreadId) {
            setTimeout(() => {
              setSelectedThreadId(nextThreadId);
              toast.success(
                `اكتمل تسليم الطلب — بانتظار تأكيد العميل. تم الانتقال للطلب التالي ${
                  res.nextOrder?.code ? `#${res.nextOrder.code}` : ""
                } ⏭️`,
              );
            }, 350);
          } else {
            toast.success(
              "اكتمل تسليم الطلب — بانتظار تأكيد العميل. لا توجد طلبات أخرى في الطابور 🎉",
            );
          }
        }
      }
    },
    onError: (err: any, newMsgData, context) => {
      const tempId = context?.tempId || newMsgData.clientMessageId;
      console.error(
        `[AdminInbox:sendMessage_error] conversation_id=${newMsgData.threadId} client_message_id=${tempId} error=`,
        err,
      );

      const errorMessage =
        err?.message ||
        err?.details ||
        err?.sqlError ||
        "فشل إرسال الرسالة لقاعدة البيانات، يرجى إعادة المحاولة";

      // Mark the message as failed with retry info instead of discarding
      if (tempId) {
        setLiveMessages((prev) =>
          prev.map((m) =>
            m.id === tempId || (m.body as any)?.clientMessageId === tempId
              ? {
                  ...m,
                  pending: false,
                  isFailed: true,
                  errorReason: errorMessage,
                  rawPayload: newMsgData,
                }
              : m,
          ),
        );
      }

      toast.error(errorMessage);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-threads"] });
    },
  });

  const handleRetryMessage = (failedMsg: any) => {
    if (!selectedThreadId) return;
    const payload = failedMsg.rawPayload || {
      threadId: selectedThreadId,
      text: failedMsg.body?.text,
      kind: failedMsg.kind,
      body: failedMsg.body,
      imageUrl: failedMsg.body?.imageUrl,
      clientMessageId: failedMsg.body?.clientMessageId || failedMsg.id,
    };
    sendMutation.mutate(payload);
  };

  // 9. Mode mutation
  const modeMutation = useMutation({
    mutationFn: (data: { threadId: string; mode: string }) => setThreadMode({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-threads"] });
    },
  });

  // 10. Status mutation with auto-advance
  const statusMutation = useMutation({
    mutationFn: (data: { threadId: string; status: "open" | "closed" }) =>
      setThreadStatus({ data }),
    onSuccess: (updatedThread, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-threads"] });
      if (variables.status === "closed") {
        const remainingQueue = threads.filter(
          (t) => t.id !== variables.threadId && t.status === "open" && t.mode !== "RESOLVED",
        );
        const nextThread = remainingQueue[0];
        if (nextThread) {
          setSelectedThreadId(nextThread.id);
        }
      }
    },
  });

  // 11. Skip Queue Mutation
  const skipQueueMutation = useMutation({
    mutationFn: (threadId: string) => skipQueueThread({ data: { threadId } }),
    onSuccess: (data, threadId) => {
      queryClient.invalidateQueries({ queryKey: ["admin-threads"] });
      toast.success("تم تأجيل العميل ونقله لآخر الطابور");
      const nextActiveInQueue = threads.filter(
        (t) =>
          t.id !== threadId &&
          t.status === "open" &&
          t.mode !== "RESOLVED" &&
          t.queueStatus !== "snoozed",
      );
      const nextThread = nextActiveInQueue[0];
      if (nextThread) {
        setSelectedThreadId(nextThread.id);
      }
    },
  });

  // 12. Resume Queue Mutation
  const resumeQueueMutation = useMutation({
    mutationFn: (threadId: string) => resumeQueueThread({ data: { threadId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-threads"] });
      toast.success("تمت إعادة العميل إلى مقدمة الطابور");
    },
  });

  // 13. Send Reminder Mutation
  const reminderMutation = useMutation({
    mutationFn: ({ threadId, text }: { threadId: string; text?: string }) =>
      sendQueueReminder({ data: { threadId, text } }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["admin-threads"] });
      const created = (res as { message?: ChatMessage } | undefined)?.message;
      if (created && selectedThreadId) {
        const normalized = normalizeMessage(created, selectedThreadId);
        setLiveMessages((prev) => [...prev, normalized]);
      }
      toast.success("تم إرسال تنبيه عدم الرد إلى العميل");
    },
  });

  const completeDigitalMutation = useMutation({
    mutationFn: ({ orderId, threadId }: { orderId: string; threadId?: string }) =>
      api.adminOrderAction({
        orderId,
        threadId,
        action: "complete_digital_and_next",
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-threads"] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      const nextThreadId =
        result.nextOrder?.threadId ||
        threads.find((thread) => thread.orderId === result.nextOrder?.orderId)?.id;
      if (nextThreadId) {
        setSelectedThreadId(nextThreadId);
        markReadMutation.mutate(nextThreadId);
        toast.success(
          `اكتمل الطلب وتم الانتقال للتالي ${result.nextOrder?.code ? `#${result.nextOrder.code}` : ""} ⏭️`,
        );
      } else {
        setSelectedThreadId(null);
        toast.success("اكتمل الطلب. لا توجد طلبات أخرى تحتاج تجهيزًا الآن 🎉");
      }
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "تعذر إكمال الطلب الرقمي");
    },
  });

  /*
    The manual door. Same landing as the strict one — invalidate, hop to the
    next order — but it is a different action on the server, it asks for the
    order code and a reason, and it never records an OTP as sent.
  */
  const completeDigitalManualMutation = useMutation({
    mutationFn: ({
      orderId,
      threadId,
      reason,
      confirmText,
    }: {
      orderId: string;
      threadId?: string;
      reason: string;
      confirmText: string;
    }) =>
      api.adminOrderAction({
        orderId,
        threadId,
        reason,
        confirmText,
        action: "complete_digital_manual",
      }),
    onSuccess: (result) => {
      setManualCompletion(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-threads"] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });

      // Say exactly what moved, so the admin can see the action matched what
      // the dialog promised.
      const forced = Array.isArray(result.forcedDeliveryItems)
        ? result.forcedDeliveryItems.length
        : 0;
      const archived = Array.isArray(result.archivedUnmappedItems)
        ? result.archivedUnmappedItems.length
        : 0;
      const detail = [forced ? `${forced} عنصر تسليم` : "", archived ? `${archived} سطر مؤرشف` : ""]
        .filter(Boolean)
        .join(" • ");

      const nextThreadId =
        result.nextOrder?.threadId ||
        threads.find((thread) => thread.orderId === result.nextOrder?.orderId)?.id;
      if (nextThreadId) {
        setSelectedThreadId(nextThreadId);
        markReadMutation.mutate(nextThreadId);
        toast.success(
          `تم الإكمال اليدوي${detail ? ` (${detail})` : ""} والانتقال للتالي ${
            result.nextOrder?.code ? `#${result.nextOrder.code}` : ""
          } ⏭️`,
        );
      } else {
        setSelectedThreadId(null);
        toast.success(
          `تم الإكمال اليدوي${detail ? ` (${detail})` : ""}. لا توجد طلبات أخرى تحتاج تجهيزًا الآن 🎉`,
        );
      }
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "تعذر إكمال الطلب يدوياً");
    },
  });

  // Hotkey support: Ctrl+K / Cmd+K to focus search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        const searchEl = document.getElementById("inbox-search-input");
        searchEl?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const selectedThread = threads.find((t) => t.id === selectedThreadId) || null;

  return (
    <ConversationErrorBoundary>
      <div
        className="w-full h-full flex flex-col overflow-hidden bg-card"
        style={{ direction: "rtl" }}
      >
        {/* Top Bar: Admin Availability Status & Scheduling */}
        <AdminAvailabilityBar />

        <div
          className="w-full flex-1 flex flex-col md:flex-row overflow-hidden"
          style={{ direction: "ltr" }}
        >
          {/* Column 1: Customer List Sidebar (Left on Desktop: 340-380px) */}
          <div
            className={`w-full md:w-[340px] xl:w-[380px] h-full shrink-0 border-r border-border bg-card flex flex-col ${
              selectedThreadId ? "hidden md:flex" : "flex"
            }`}
            style={{ direction: "rtl" }}
          >
            <CustomerList
              threads={threads}
              orders={orders}
              selectedThreadId={selectedThreadId}
              onSelectThread={handleSelectThread}
              activeFilter={activeFilter}
              onChangeFilter={setActiveFilter}
              searchTerm={searchTerm}
              onChangeSearchTerm={setSearchTerm}
              isLoading={isThreadsLoading}
            />
          </div>

          {/* Column 2: Active Conversation Main Area (Center/Right on Desktop: 1fr) */}
          <div
            className={`flex-1 h-full min-w-0 bg-card flex flex-col ${
              !selectedThreadId ? "hidden md:flex" : "flex"
            }`}
            style={{ direction: "rtl" }}
          >
            <ActiveConversation
              thread={selectedThread}
              messages={liveMessages}
              orders={orders}
              isLoadingMessages={isMessagesLoading && liveMessages.length === 0}
              isCustomerOnline={isCustomerOnline}
              isCustomerTyping={isCustomerTyping}
              customerLastReadAt={customerLastReadAt}
              hasMore={hasMore}
              isLoadingOlder={isLoadingOlder}
              onLoadOlder={handleLoadOlder}
              onBackToList={() => setSelectedThreadId(null)}
              onNavigateToOrder={onNavigateToOrder}
              onRetryMessage={handleRetryMessage}
              onSendMessage={(payload) => {
                if (selectedThreadId) {
                  sendMutation.mutate({
                    threadId: selectedThreadId,
                    clientMessageId:
                      (payload as any).clientMessageId ||
                      `admin-msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    ...payload,
                  });
                }
              }}
              onSetThreadMode={(mode) => {
                if (selectedThreadId) {
                  modeMutation.mutate({ threadId: selectedThreadId, mode });
                }
              }}
              onSetThreadStatus={(status) => {
                if (selectedThreadId) {
                  statusMutation.mutate({ threadId: selectedThreadId, status });
                }
              }}
              onSkipQueue={() => {
                if (selectedThreadId) {
                  skipQueueMutation.mutate(selectedThreadId);
                }
              }}
              onResumeQueue={() => {
                if (selectedThreadId) {
                  resumeQueueMutation.mutate(selectedThreadId);
                }
              }}
              onSendQueueReminder={(text) => {
                if (selectedThreadId) {
                  reminderMutation.mutate({ threadId: selectedThreadId, text });
                }
              }}
              onCompleteOrder={(orderId) =>
                completeDigitalMutation.mutateAsync({
                  orderId,
                  threadId: selectedThreadId || undefined,
                })
              }
              isCompletingOrder={completeDigitalMutation.isPending}
              onCompleteOrderManually={(order) =>
                setManualCompletion({
                  orderId: order.orderId,
                  code: order.code,
                  ...(typeof order.pendingCount === "number"
                    ? { pendingCount: order.pendingCount }
                    : {}),
                  ...(typeof order.unmappedCount === "number"
                    ? { unmappedCount: order.unmappedCount }
                    : {}),
                })
              }
              onDeliveryFinished={({ nextOrder }) => {
                void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
                void queryClient.invalidateQueries({ queryKey: ["admin-threads"] });
                void queryClient.invalidateQueries({ queryKey: ["orders"] });
                if (nextOrder?.threadId) {
                  setSelectedThreadId(nextOrder.threadId);
                  toast.success(
                    `تم الانتقال إلى الطلب التالي ${nextOrder.code ? `#${nextOrder.code}` : ""} ⏭️`,
                  );
                } else {
                  setSelectedThreadId(null);
                  toast.success("لا توجد طلبات أخرى تحتاج تجهيزًا الآن 🎉");
                }
              }}
              isSending={sendMutation.isPending}
            />
          </div>
        </div>
      </div>

      <ManualCompletionDialog
        isOpen={Boolean(manualCompletion)}
        onClose={() => setManualCompletion(null)}
        orderCode={manualCompletion?.code || ""}
        isBusy={completeDigitalManualMutation.isPending}
        {...(typeof manualCompletion?.pendingCount === "number"
          ? { pendingCount: manualCompletion.pendingCount }
          : {})}
        {...(typeof manualCompletion?.unmappedCount === "number"
          ? { unmappedCount: manualCompletion.unmappedCount }
          : {})}
        onConfirm={({ reason, confirmText }) => {
          if (!manualCompletion) return;
          return completeDigitalManualMutation.mutateAsync({
            orderId: manualCompletion.orderId,
            threadId: selectedThreadId || undefined,
            reason,
            confirmText,
          });
        }}
      />
    </ConversationErrorBoundary>
  );
}

export default AdminInboxView;
