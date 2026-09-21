import React, { useMemo } from "react";
import {
  Search,
  MessageSquare,
  Clock,
  CheckCircle2,
  AlertCircle,
  ShoppingBag,
  Flame,
  UserCheck,
  Filter,
  Sparkles,
  Inbox,
  Archive,
  Gamepad2,
  Package,
} from "lucide-react";
import { ADMIN_FINISHED_ORDER_STATUSES, Thread, Order } from "@/lib/types";
import { InboxFilter, FilterOption } from "./types";
import {
  ORDER_ITEM_TITLE_UNAVAILABLE_AR,
  orderItemTitleOf,
  orderTitleSummary,
  resolveOrderTitles,
  unresolvedTitleIds,
} from "@/lib/order-item-title";

/**
 * Log an order whose items cannot be named — once, with ids only.
 *
 * An order item carries the account it was delivered with, so nothing but the
 * ids goes to the console.
 */
const reportedUnnamedOrders = new Set<string>();
function reportUnnamedItems(orderId: string, items: unknown) {
  if (reportedUnnamedOrders.has(orderId)) return;
  const unresolved = unresolvedTitleIds(resolveOrderTitles(items as never));
  if (unresolved.length === 0) return;
  reportedUnnamedOrders.add(orderId);
  console.warn("[inbox:order_items_unnamed]", { orderId, unresolved });
}

interface CustomerListProps {
  threads: Thread[];
  orders?: Order[];
  selectedThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  activeFilter: InboxFilter;
  onChangeFilter: (filter: InboxFilter) => void;
  searchTerm: string;
  onChangeSearchTerm: (term: string) => void;
  isLoading?: boolean;
  /** Review submissions waiting for a decision — counted server-side, not from threads. */
  pendingReviewCount?: number;
}

export function CustomerList({
  threads,
  orders = [],
  selectedThreadId,
  onSelectThread,
  activeFilter,
  onChangeFilter,
  searchTerm,
  onChangeSearchTerm,
  isLoading = false,
  pendingReviewCount = 0,
}: CustomerListProps) {
  // Map orders for fast lookup
  const orderMap = useMemo(() => {
    const map = new Map<string, Order>();
    for (const o of orders) {
      map.set(o.id, o);
      if (o.code) map.set(o.code, o);
    }
    return map;
  }, [orders]);

  // Compute filter counts
  const filterCounts = useMemo(() => {
    const counts: Record<InboxFilter, number> = {
      order_queue: 0,
      digital_queue: 0,
      open_tickets: 0,
      other_chats: 0,
      queue: 0,
      all: threads.length,
      needs_reply: 0,
      active_chats: 0,
      active_orders: 0,
      active_tickets: 0,
      order_preparation: 0,
      waiting_user: 0,
      waiting_admin: 0,
      escalated: 0,
      completed_orders: 0,
      closed_tickets: 0,
      /*
        Always zero here, and deliberately so: submissions are not threads, so
        this loop cannot count them. The pill reads the server's count instead.
      */
      pending_reviews: 0,
    };

    for (const t of threads) {
      const isClosed = t.status === "closed" || t.mode === "RESOLVED";
      const isDigitalOrder =
        (Boolean(t.orderId) ||
          t.chatType === "ORDER_SUPPORT" ||
          t.chatType === "DELIVERY" ||
          t.mode === "ORDER_PREPARATION") &&
        t.chatType !== "GENERAL_SUPPORT" &&
        t.chatType !== "AUTOMATED_SUPPORT";

      const linkedOrder = t.orderId ? orderMap.get(t.orderId) : undefined;
      const isDeliveryIssue = linkedOrder?.status === "delivery_issue";
      const orderIsActive = linkedOrder
        ? !ADMIN_FINISHED_ORDER_STATUSES.includes(linkedOrder.status)
        : false;
      const orderIsCompleted = linkedOrder ? linkedOrder.status === "completed" : false;

      // 1. Digital Queue: Open, active digital order requiring preparation and delivery
      if (t.status === "open" && !isClosed && isDigitalOrder && orderIsActive) {
        counts.order_queue++;
        counts.digital_queue++;
        counts.queue++;
      }

      // 2. Open Tickets: Open human support & technical inquiries (not digital delivery queue)
      if (t.status === "open" && !isClosed && (!isDigitalOrder || isDeliveryIssue)) {
        counts.open_tickets++;
      }

      // 3. Other Chats: Completed orders, closed tickets, resolved conversations
      if (isClosed || (isDigitalOrder && orderIsCompleted)) {
        counts.other_chats++;
      }

      if (t.needsAdmin || t.mode === "WAITING_FOR_ADMIN" || t.mode === "ESCALATED") {
        counts.needs_reply++;
      }
      if (t.status === "open" && !isClosed) {
        counts.active_chats++;
      }
      if (isDigitalOrder && orderIsActive && !isClosed) {
        counts.active_orders++;
      }
      if ((!isDigitalOrder || isDeliveryIssue) && t.status === "open" && !isClosed) {
        counts.active_tickets++;
      }
      if (t.mode === "ORDER_PREPARATION") {
        counts.order_preparation++;
      }
      if (t.mode === "WAITING_FOR_USER") {
        counts.waiting_user++;
      }
      if (t.mode === "WAITING_FOR_ADMIN") {
        counts.waiting_admin++;
      }
      if (t.mode === "ESCALATED") {
        counts.escalated++;
      }
      if (isDigitalOrder && orderIsCompleted) {
        counts.completed_orders++;
      }
      if (isClosed) {
        counts.closed_tickets++;
      }
    }

    return counts;
  }, [threads, orderMap]);

  // Filter and search threads
  const filteredThreads = useMemo(() => {
    const list = threads.filter((t) => {
      const isClosed = t.status === "closed" || t.mode === "RESOLVED";
      const isDigitalOrder =
        (Boolean(t.orderId) ||
          t.chatType === "ORDER_SUPPORT" ||
          t.chatType === "DELIVERY" ||
          t.mode === "ORDER_PREPARATION") &&
        t.chatType !== "GENERAL_SUPPORT" &&
        t.chatType !== "AUTOMATED_SUPPORT";

      const linkedOrder = t.orderId ? orderMap.get(t.orderId) : undefined;
      const isDeliveryIssue = linkedOrder?.status === "delivery_issue";
      const orderIsActive = linkedOrder
        ? !ADMIN_FINISHED_ORDER_STATUSES.includes(linkedOrder.status)
        : false;
      const orderIsCompleted = linkedOrder ? linkedOrder.status === "completed" : false;

      // Filter check
      let matchesFilter = true;
      switch (activeFilter) {
        case "order_queue":
        case "digital_queue":
        case "queue":
          matchesFilter = t.status === "open" && !isClosed && isDigitalOrder && orderIsActive;
          break;
        case "open_tickets":
          matchesFilter = t.status === "open" && !isClosed && (!isDigitalOrder || isDeliveryIssue);
          break;
        case "other_chats":
          matchesFilter = isClosed || (isDigitalOrder && orderIsCompleted);
          break;
        case "needs_reply":
          matchesFilter = Boolean(
            t.needsAdmin || t.mode === "WAITING_FOR_ADMIN" || t.mode === "ESCALATED",
          );
          break;
        case "active_chats":
          matchesFilter = t.status === "open" && !isClosed;
          break;
        case "active_orders":
          matchesFilter = isDigitalOrder && orderIsActive && !isClosed;
          break;
        case "active_tickets":
          matchesFilter = (!isDigitalOrder || isDeliveryIssue) && t.status === "open" && !isClosed;
          break;
        case "order_preparation":
          matchesFilter = t.mode === "ORDER_PREPARATION";
          break;
        case "waiting_user":
          matchesFilter = t.mode === "WAITING_FOR_USER";
          break;
        case "waiting_admin":
          matchesFilter = t.mode === "WAITING_FOR_ADMIN";
          break;
        case "escalated":
          matchesFilter = t.mode === "ESCALATED";
          break;
        case "completed_orders":
          matchesFilter = isDigitalOrder && orderIsCompleted;
          break;
        case "closed_tickets":
          matchesFilter = isClosed;
          break;
        case "all":
        default:
          matchesFilter = true;
          break;
      }

      if (!matchesFilter) return false;

      // Search term check
      if (!searchTerm.trim()) return true;
      const q = searchTerm.toLowerCase();
      const matchName = t.userName?.toLowerCase().includes(q);
      const matchSubject = t.subject?.toLowerCase().includes(q);
      const matchPreview = t.lastMessagePreview?.toLowerCase().includes(q);
      const matchOrderId = t.orderId?.toLowerCase().includes(q);
      const matchOrderCode = linkedOrder?.code?.toLowerCase().includes(q);
      const matchItems = linkedOrder?.items?.some((i) =>
        orderItemTitleOf(i).toLowerCase().includes(q),
      );

      return (
        matchName || matchSubject || matchPreview || matchOrderId || matchOrderCode || matchItems
      );
    });

    // If Digital Queue filter is active, sort strictly FIFO:
    // 1. Active / Queued items: oldest entry time first (FIFO order)
    // 2. Snoozed items (queueStatus === "snoozed") at the very end
    if (
      activeFilter === "order_queue" ||
      activeFilter === "digital_queue" ||
      activeFilter === "queue"
    ) {
      return [...list].sort((a, b) => {
        const aSnoozed = a.queueStatus === "snoozed";
        const bSnoozed = b.queueStatus === "snoozed";
        if (aSnoozed && !bSnoozed) return 1;
        if (!aSnoozed && bSnoozed) return -1;

        const aTime = new Date(a.queueEnteredAt || a.escalatedAt || a.createdAt).getTime();
        const bTime = new Date(b.queueEnteredAt || b.escalatedAt || b.createdAt).getTime();
        return aTime - bTime; // Oldest first
      });
    }

    return list;
  }, [threads, activeFilter, searchTerm, orderMap]);

  // Format relative timestamp
  const formatTime = (isoString: string) => {
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const mins = Math.floor(diffMs / 60000);
      if (mins < 1) return "الآن";
      if (mins < 60) return `منذ ${mins} د`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `منذ ${hours} س`;
      const days = Math.floor(hours / 24);
      if (days < 7) return `منذ ${days} يوم`;
      return new Date(isoString).toLocaleDateString("ar-IQ", {
        month: "numeric",
        day: "numeric",
      });
    } catch {
      return "";
    }
  };

  const getWaitDuration = (thread: Thread) => {
    const startTime = thread.queueEnteredAt || thread.escalatedAt || thread.createdAt;
    if (!startTime) return "الآن";
    const diffMs = Date.now() - new Date(startTime).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "أقل من دقيقة";
    if (mins < 60) return `${mins} دقيقة`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours} ساعة ${remMins > 0 ? `و ${remMins} د` : ""}`;
  };

  const SUB_FILTERS: { id: InboxFilter; label: string; color?: string }[] = [
    { id: "all", label: "الكل" },
    { id: "needs_reply", label: "بحاجة إلى رد", color: "text-red-600 bg-red-500/10" },
    { id: "waiting_user", label: "بانتظار العميل" },
    { id: "waiting_admin", label: "بانتظار الإدارة" },
    { id: "escalated", label: "المصعّدة", color: "text-purple-600 bg-purple-500/10" },
    { id: "closed_tickets", label: "تذاكر مغلقة" },
    {
      id: "pending_reviews",
      label: "التقييمات بحاجة إلى موافقة",
      color: "text-amber-700 bg-amber-500/15",
    },
  ];

  return (
    <div className="w-full h-full flex flex-col bg-card overflow-hidden" dir="rtl">
      {/* Header & Search Bar */}
      <div className="p-3 border-b border-border bg-card space-y-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Inbox className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold text-foreground">صندوق المحادثات</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted font-bold text-muted-foreground">
              {threads.length}
            </span>
          </div>
          {filterCounts.needs_reply > 0 && (
            <div className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 animate-pulse">
              <Flame className="w-3 h-3" />
              <span>{filterCounts.needs_reply} بانتظار الرد</span>
            </div>
          )}
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            id="inbox-search-input"
            placeholder="بحث بالاسم، رقم الطلب، أو اسم المنتج..."
            value={searchTerm}
            onChange={(e) => onChangeSearchTerm(e.target.value)}
            className="w-full pr-9 pl-4 py-2 bg-muted/40 border border-border rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/20 text-foreground placeholder:text-muted-foreground/70"
          />
          {searchTerm && (
            <button
              onClick={() => onChangeSearchTerm("")}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
            >
              مسح
            </button>
          )}
        </div>

        {/* 3 Primary Filter Tabs: Order Queue vs Open Tickets vs Other Chats */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-muted/50 rounded-xl border border-border/80 text-center">
          <button
            type="button"
            onClick={() => onChangeFilter("order_queue")}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-bold transition-all ${
              activeFilter === "order_queue" ||
              activeFilter === "digital_queue" ||
              activeFilter === "queue"
                ? "bg-background text-foreground shadow-sm border border-border font-black"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Flame className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="truncate">طابور الطلبات</span>
            <span className="bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.2 rounded-full text-[10px] shrink-0 font-mono">
              {filterCounts.order_queue}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onChangeFilter("open_tickets")}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-bold transition-all ${
              activeFilter === "open_tickets"
                ? "bg-background text-foreground shadow-sm border border-border font-black"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="truncate">التذاكر المفتوحة</span>
            <span className="bg-primary/15 text-primary px-1.5 py-0.2 rounded-full text-[10px] shrink-0 font-mono">
              {filterCounts.open_tickets}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onChangeFilter("other_chats")}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-bold transition-all ${
              activeFilter === "other_chats"
                ? "bg-background text-foreground shadow-sm border border-border font-black"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Archive className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="truncate">المحادثات الأخرى</span>
            <span className="bg-muted text-muted-foreground px-1.5 py-0.2 rounded-full text-[10px] shrink-0 font-mono">
              {filterCounts.other_chats}
            </span>
          </button>
        </div>

        {/* Secondary Filter Pills */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {SUB_FILTERS.map((f) => {
            /*
              The review count comes from the server, not from `threads`: a
              submission has no conversation to be counted in.
            */
            const count = f.id === "pending_reviews" ? pendingReviewCount : filterCounts[f.id] || 0;
            const isSelected = activeFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onChangeFilter(f.id)}
                className={`whitespace-nowrap px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1.5 shrink-0 ${
                  isSelected
                    ? "bg-foreground text-background shadow-2xs font-bold"
                    : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <span>{f.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-md ${
                    isSelected
                      ? "bg-background/20 text-background"
                      : f.color || "bg-muted text-muted-foreground"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Threads List */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/40 p-1.5 space-y-1">
        {isLoading ? (
          <div className="p-4 space-y-2.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-18 bg-muted/40 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filteredThreads.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground text-xs space-y-2">
            <MessageSquare className="w-8 h-8 mx-auto text-muted-foreground/30" />
            <div className="font-semibold">لا توجد محادثات مطابقة</div>
            <p className="text-[11px] text-muted-foreground/70">
              جرب تغيير التصفية أو مسح كلمة البحث
            </p>
          </div>
        ) : (
          filteredThreads.map((t, index) => {
            const isSelected = selectedThreadId === t.id;
            const needsAdmin =
              t.needsAdmin || t.mode === "WAITING_FOR_ADMIN" || t.mode === "ESCALATED";
            const linkedOrder = t.orderId ? orderMap.get(t.orderId) : undefined;
            const isSnoozed = t.queueStatus === "snoozed";
            const isDigitalOrder =
              (Boolean(t.orderId) ||
                t.chatType === "ORDER_SUPPORT" ||
                t.chatType === "DELIVERY" ||
                t.mode === "ORDER_PREPARATION") &&
              t.chatType !== "GENERAL_SUPPORT" &&
              t.chatType !== "AUTOMATED_SUPPORT";

            const queueRank =
              isDigitalOrder &&
              (activeFilter === "order_queue" ||
                activeFilter === "digital_queue" ||
                activeFilter === "queue") &&
              !isSnoozed
                ? index + 1
                : null;

            /*
              The name comes from the order's own items and nowhere else. This
              used to end `?? t.subject ?? "منتج رقمي"`, so a queue row whose
              order had not loaded showed the conversation's subject line, or a
              product that reads like a real one called "منتج رقمي" — an admin
              could not tell a game named that from a lookup that failed.
            */
            const productName = linkedOrder
              ? orderTitleSummary(linkedOrder.items)
              : ORDER_ITEM_TITLE_UNAVAILABLE_AR;
            if (linkedOrder) reportUnnamedItems(linkedOrder.id, linkedOrder.items);

            // Status Definition
            const isResolved =
              t.status === "closed" || t.mode === "RESOLVED" || linkedOrder?.status === "completed";
            const isPrep = t.mode === "ORDER_PREPARATION" || t.mode === "ADMIN_ACTIVE";
            const isWaitingUser = t.mode === "WAITING_FOR_USER" || isSnoozed;

            let statusLabel = "بانتظار التجهيز";
            let statusColor =
              "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20";
            if (isResolved) {
              statusLabel = "مكتمل";
              statusColor =
                "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
            } else if (isWaitingUser) {
              statusLabel = "بانتظار العميل";
              statusColor = "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20";
            } else if (isPrep) {
              statusLabel = "قيد التجهيز";
              statusColor =
                "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/20";
            }

            return (
              <div
                key={t.id}
                onClick={() => onSelectThread(t.id)}
                className={`p-3 rounded-xl cursor-pointer transition-all border ${
                  isSelected
                    ? "bg-primary/5 border-primary/40 shadow-xs scale-[0.99]"
                    : "bg-card border-border/30 hover:bg-muted/40 hover:border-border"
                }`}
              >
                {/* Header Row: Customer Name, Queue Rank, Time */}
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="relative shrink-0">
                      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-xs border border-primary/15">
                        {t.userName ? t.userName.charAt(0).toUpperCase() : "U"}
                      </div>
                      {queueRank !== null && (
                        <span
                          className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-black border shadow-xs ${
                            queueRank === 1
                              ? "bg-amber-500 text-white border-amber-600 animate-pulse"
                              : "bg-muted text-foreground border-border"
                          }`}
                        >
                          #{queueRank}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="font-bold text-xs text-foreground truncate flex items-center gap-1.5">
                        <span>{t.userName || "عميل بدون اسم"}</span>
                        {needsAdmin && (
                          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                        )}
                        {isSnoozed && (
                          <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[9px] font-bold">
                            ⏸️ مؤجل
                          </span>
                        )}
                      </div>

                      {/* Order Code & Product Name */}
                      <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                        {(t.orderId || linkedOrder) && (
                          <span className="font-mono font-bold text-primary">
                            #{linkedOrder?.code || t.orderId?.slice(-6)}
                          </span>
                        )}
                        <span className="truncate text-foreground/80 font-medium">
                          {productName}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-left shrink-0 space-y-0.5">
                    <div className="text-[10px] text-muted-foreground">
                      {formatTime(t.lastMessageAt || t.createdAt)}
                    </div>
                    {/* Status Badge */}
                    <span
                      className={`inline-block px-1.5 py-0.2 rounded-md text-[9px] font-bold border ${statusColor}`}
                    >
                      {statusLabel}
                    </span>
                  </div>
                </div>

                {/* Queue / Order Details Strip */}
                <div className="grid grid-cols-2 gap-1.5 my-1.5 py-1 px-2 rounded-lg bg-muted/40 text-[10px] text-muted-foreground border border-border/20">
                  <div className="flex items-center gap-1 truncate">
                    <Clock className="w-3 h-3 text-amber-500 shrink-0" />
                    <span>الانتظار: </span>
                    <strong className="text-foreground font-semibold truncate">
                      {getWaitDuration(t)}
                    </strong>
                  </div>

                  <div className="flex items-center justify-end gap-1 truncate">
                    {queueRank !== null ? (
                      <span className="text-amber-600 dark:text-amber-400 font-bold">
                        الدور: #{queueRank} {queueRank === 1 ? "(الآن)" : ""}
                      </span>
                    ) : (
                      <span className="truncate">{t.subject || "طلب رقمي"}</span>
                    )}
                  </div>
                </div>

                {/* Preview snippet */}
                <p className="text-xs text-muted-foreground line-clamp-1 mb-1.5 pr-2 font-sans">
                  {t.lastMessagePreview || "لا توجد رسائل سابقة"}
                </p>

                {/* Badges footer */}
                <div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-border/30">
                  <div className="flex items-center gap-1.5 overflow-hidden flex-wrap">
                    {/* Chat Type badge */}
                    {t.chatType && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          t.chatType === "AUTOMATED_SUPPORT"
                            ? "bg-sky-500/15 text-sky-700 dark:text-sky-400"
                            : t.chatType === "GENERAL_SUPPORT"
                              ? "bg-violet-500/15 text-violet-700 dark:text-violet-400"
                              : t.chatType === "DELIVERY"
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        }`}
                      >
                        {t.chatType === "AUTOMATED_SUPPORT"
                          ? "🤖 آلي"
                          : t.chatType === "GENERAL_SUPPORT"
                            ? "👤 إدارة"
                            : t.chatType === "DELIVERY"
                              ? "⚡ تسليم"
                              : "📦 طلب"}
                      </span>
                    )}

                    {/* Order code badge */}
                    {(t.orderId || linkedOrder) && (
                      <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 font-mono font-bold flex items-center gap-1">
                        <ShoppingBag className="w-2.5 h-2.5" />#
                        {linkedOrder?.code || t.orderId?.slice(-6)}
                      </span>
                    )}
                  </div>

                  {/* Status Indicator */}
                  <span
                    className={`font-semibold shrink-0 ${
                      t.status === "open" ? "text-emerald-600" : "text-muted-foreground"
                    }`}
                  >
                    {t.status === "open" ? "مفتوحة" : "مغلقة"}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
