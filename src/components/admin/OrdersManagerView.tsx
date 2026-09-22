import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShoppingBag,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Truck,
  XCircle,
  AlertTriangle,
  MessageSquare,
  ChevronDown,
  Eye,
  CreditCard,
  User,
  MapPin,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Package,
  Calendar,
  DollarSign,
  FileText,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Order, OrderStatus, PaymentStatus } from "@/lib/types";

interface OrdersManagerViewProps {
  onNavigateToChat?: (threadId: string) => void;
}

const statusLabels: Record<OrderStatus, { label: string; color: string; icon: any }> = {
  pending: {
    label: "قيد الانتظار",
    color: "bg-amber-500/10 text-amber-700 border-amber-500/20",
    icon: Clock,
  },
  processing: {
    label: "قيد المعالجة",
    color: "bg-blue-500/10 text-blue-700 border-blue-500/20",
    icon: RefreshCw,
  },
  delivering: {
    label: "قيد التسليم",
    color: "bg-indigo-500/10 text-indigo-700 border-indigo-500/20",
    icon: Truck,
  },
  awaiting_customer_confirmation: {
    label: "بانتظار تأكيد العميل",
    color: "bg-teal-500/10 text-teal-700 border-teal-500/20",
    icon: CheckCircle2,
  },
  delivery_issue: {
    label: "مشكلة تسليم",
    color: "bg-red-500/10 text-red-700 border-red-500/20",
    icon: AlertTriangle,
  },
  completed: {
    label: "مكتمل",
    color: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
    icon: CheckCircle2,
  },
  cancelled: {
    label: "ملغي",
    color: "bg-red-500/10 text-red-700 border-red-500/20",
    icon: XCircle,
  },
};

const paymentLabels: Record<PaymentStatus, { label: string; color: string }> = {
  unpaid: { label: "بانتظار الدفع", color: "bg-amber-500/10 text-amber-700 border-amber-500/20" },
  review: { label: "قيد المراجعة", color: "bg-blue-500/10 text-blue-700 border-blue-500/20" },
  paid: { label: "مدفوع مؤكد", color: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20" },
  rejected: { label: "مرفوض", color: "bg-red-500/10 text-red-700 border-red-500/20" },
};

function getAutoDeleteNotice(order: Order): string | null {
  if (order.status !== "cancelled") return null;
  const cancelledTimeStr = order.cancelledAt || order.updatedAt || order.createdAt;
  const cancelledTime = new Date(cancelledTimeStr).getTime();
  const elapsedDays = (Date.now() - cancelledTime) / (1000 * 60 * 60 * 24);
  const remainingDays = Math.max(0, Math.ceil(7 - elapsedDays));
  if (remainingDays > 1) {
    return `سيتم الحذف نهائياً بعد ${remainingDays} أيام`;
  } else if (remainingDays === 1) {
    return `سيتم الحذف نهائياً خلال 24 ساعة`;
  } else {
    return `سيتم الحذف نهائياً خلال ساعات`;
  }
}

export function OrdersManagerView({ onNavigateToChat }: OrdersManagerViewProps) {
  const queryClient = useQueryClient();
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("all");
  const [selectedPaymentFilter, setSelectedPaymentFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Fetch real database orders
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin-orders-list"],
    queryFn: async () => {
      const res = await fetch("/api/admin/orders", { credentials: "include" });
      if (!res.ok) {
        // Fallback to /api/orders?all=1
        const fallback = await fetch("/api/orders?all=1", { credentials: "include" });
        if (!fallback.ok) return { orders: [] as Order[] };
        const data = await fallback.json();
        return { orders: (data.orders || []) as Order[] };
      }
      return res.json() as Promise<{ orders: Order[] }>;
    },
    refetchInterval: 10000,
  });

  const orders = data?.orders || [];

  // Update order status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: OrderStatus }) => {
      const res = await fetch("/api/admin/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, action: "set_status", status }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "فشل تحديث حالة الطلب");
      }
      return res.json();
    },
    onSuccess: (_, vars) => {
      toast.success("تم تحديث حالة الطلب بنجاح");
      queryClient.invalidateQueries({ queryKey: ["admin-orders-list"] });
      if (selectedOrder && selectedOrder.id === vars.orderId) {
        setSelectedOrder((prev) => (prev ? { ...prev, status: vars.status } : null));
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Cancel order mutation
  const cancelOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch("/api/admin/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, action: "cancel_order" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "فشل إلغاء الطلب");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast.success("تم إلغاء الطلب بنجاح");
      queryClient.invalidateQueries({ queryKey: ["admin-orders-list"] });
      // Invalidate wallet or user info if needed
      queryClient.invalidateQueries({ queryKey: ["user_info"] });
      if (selectedOrder && selectedOrder.id === data.order.id) {
        setSelectedOrder(data.order);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Delete order mutation
  const deleteOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`/api/admin/orders?orderId=${encodeURIComponent(orderId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "فشل حذف الطلب");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("تم حذف الطلب نهائياً من قاعدة البيانات");
      queryClient.invalidateQueries({ queryKey: ["admin-orders-list"] });
      setSelectedOrder(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Update payment status mutation
  const updatePaymentMutation = useMutation({
    mutationFn: async ({
      orderId,
      paymentStatus,
    }: {
      orderId: string;
      paymentStatus: PaymentStatus;
    }) => {
      const res = await fetch("/api/admin/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, action: "set_payment", paymentStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "فشل تحديث حالة الدفع");
      }
      return res.json();
    },
    onSuccess: (_, vars) => {
      toast.success("تم تحديث حالة الدفع وإشعار العميل");
      queryClient.invalidateQueries({ queryKey: ["admin-orders-list"] });
      if (selectedOrder && selectedOrder.id === vars.orderId) {
        setSelectedOrder((prev) => (prev ? { ...prev, paymentStatus: vars.paymentStatus } : null));
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Filter orders
  const filteredOrders = orders.filter((order) => {
    const matchesStatus = selectedStatusFilter === "all" || order.status === selectedStatusFilter;
    const matchesPayment =
      selectedPaymentFilter === "all" || order.paymentStatus === selectedPaymentFilter;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      order.code?.toLowerCase().includes(q) ||
      order.userName?.toLowerCase().includes(q) ||
      order.userId?.toLowerCase().includes(q) ||
      order.items?.some((i) => i.title?.toLowerCase().includes(q));

    return matchesStatus && matchesPayment && matchesSearch;
  });

  // Metric counts
  const pendingCount = orders.filter(
    (o) => o.status === "pending" || o.paymentStatus === "unpaid",
  ).length;
  const processingCount = orders.filter((o) => o.status === "processing").length;
  const completedCount = orders.filter((o) => o.status === "completed").length;

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-300 pb-16" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-foreground flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-primary" />
            <span>إدارة الطلبات والمبيعات</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            متابعة طلبات المتجر، تأكيد المدفوعات، وإدارة تسليم الحسابات والمنتجات الرقمية
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            className="p-2 bg-card hover:bg-muted text-foreground border border-border rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">تحديث البيانات</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-2xl p-4 shadow-2xs">
          <div className="text-[11px] font-bold text-muted-foreground">إجمالي الطلبات</div>
          <div className="text-2xl font-black text-foreground mt-1">{orders.length}</div>
        </div>
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 shadow-2xs">
          <div className="text-[11px] font-bold text-amber-700 dark:text-amber-400">
            بانتظار الإجراء
          </div>
          <div className="text-2xl font-black text-amber-700 dark:text-amber-400 mt-1">
            {pendingCount}
          </div>
        </div>
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 shadow-2xs">
          <div className="text-[11px] font-bold text-blue-700 dark:text-blue-400">
            قيد التجهيز / التسليم
          </div>
          <div className="text-2xl font-black text-blue-700 dark:text-blue-400 mt-1">
            {processingCount}
          </div>
        </div>
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-4 shadow-2xs">
          <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
            مكتملة ومسلمة
          </div>
          <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400 mt-1">
            {completedCount}
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-card border border-border rounded-2xl p-3.5 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Status Pills */}
        <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto">
          {[
            { id: "all", label: "الكل" },
            { id: "pending", label: "قيد الانتظار" },
            { id: "processing", label: "قيد المعالجة" },
            { id: "delivering", label: "قيد التسليم" },
            { id: "awaiting_customer_confirmation", label: "بانتظار تأكيد العميل" },
            { id: "delivery_issue", label: "مشكلة تسليم" },
            { id: "completed", label: "مكتمل" },
            { id: "cancelled", label: "ملغي" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                selectedStatusFilter === tab.id
                  ? "bg-foreground text-background shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="بحث برقم الطلب، العميل، أو المنتج..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-muted/40 border border-border rounded-xl py-2 pr-9 pl-3 text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/20 text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Orders List / Table */}
      {isLoading ? (
        <div className="p-16 text-center text-muted-foreground text-xs space-y-2 bg-card rounded-2xl border border-border">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-primary" />
          <div>جاري تحميل الطلبات...</div>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="p-16 text-center text-muted-foreground text-xs space-y-2 bg-card rounded-2xl border border-border">
          <ShoppingBag className="w-10 h-10 mx-auto text-muted-foreground/30" />
          <div className="font-bold text-sm text-foreground">
            لا توجد طلبات مطابقة للفلتر المحدد
          </div>
          <p className="text-[11px] text-muted-foreground">
            جرب تغيير حالة الفلتر أو مسح كلمة البحث.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map((order) => {
            const statusConfig = statusLabels[order.status] || {
              label: order.status,
              color: "bg-muted text-muted-foreground",
              icon: Clock,
            };
            const paymentConfig = paymentLabels[order.paymentStatus] || {
              label: order.paymentStatus,
              color: "bg-muted text-muted-foreground",
            };
            const StatusIcon = statusConfig.icon;

            return (
              <div
                key={order.id}
                className="bg-card border border-border hover:border-primary/40 rounded-2xl p-4 transition-all shadow-2xs space-y-3"
              >
                {/* Order Row Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/50 pb-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono font-black text-sm text-foreground bg-muted/60 px-2.5 py-1 rounded-lg">
                      #{order.code || order.id.slice(-8)}
                    </span>
                    <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>{order.userName || "عميل"}</span>
                    </span>
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 opacity-60" />
                      <span>
                        {new Date(order.createdAt).toLocaleString("ar-IQ", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Status Badge */}
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${statusConfig.color}`}
                    >
                      <StatusIcon className="w-3 h-3" />
                      <span>{statusConfig.label}</span>
                    </span>

                    {/* Payment Badge */}
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${paymentConfig.color}`}
                    >
                      <CreditCard className="w-3 h-3" />
                      <span>{paymentConfig.label}</span>
                    </span>

                    {/*
                      CASH ON DELIVERY, WHERE THE ADMIN CAN SEE IT.

                      A cash order is written `unpaid` on purpose — the money
                      arrives with the courier — and `unpaid` on its own reads
                      as "this customer has not paid yet", which is the cue to
                      chase them for a receipt. The badge says which of the two
                      it is, so the amount is collected at the door instead.
                    */}
                    {order.paymentMethod === "cash_on_delivery" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/20">
                        <Truck className="w-3 h-3" />
                        <span>الدفع عند الاستلام</span>
                      </span>
                    )}

                    {/* Auto Delete Notice for Cancelled */}
                    {order.status === "cancelled" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                        <Clock className="w-3 h-3" />
                        <span>{getAutoDeleteNotice(order)}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Items Summary & Total */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    {(order.items || []).map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs text-foreground">
                        <Package className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="font-semibold truncate">{item.title}</span>
                        <span className="text-muted-foreground text-[11px] shrink-0">
                          ({Number(item.unitPrice).toLocaleString()} {order.currency || "IQD"})
                        </span>
                      </div>
                    ))}
                    {order.needsAddress && order.address && (
                      <div className="text-[11px] text-blue-600 flex items-center gap-1 mt-1">
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          شحن وتوصيل: {order.address.city} -{" "}
                          {order.address.street || order.address.area || ""}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-left sm:text-right">
                      <div className="text-[10px] text-muted-foreground font-semibold">
                        المبلغ الإجمالي
                      </div>
                      <div className="text-base font-black text-foreground">
                        {Number(order.total).toLocaleString()} {order.currency || "IQD"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions Toolbar */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Payment quick changers */}
                    {order.paymentStatus !== "paid" && (
                      <button
                        onClick={() =>
                          updatePaymentMutation.mutate({ orderId: order.id, paymentStatus: "paid" })
                        }
                        className="px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 rounded-lg text-xs font-bold transition-all"
                      >
                        تأكيد الدفع ✅
                      </button>
                    )}

                    {order.paymentStatus === "unpaid" && (
                      <button
                        onClick={() =>
                          updatePaymentMutation.mutate({
                            orderId: order.id,
                            paymentStatus: "rejected",
                          })
                        }
                        className="px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-400 border border-red-500/20 rounded-lg text-xs font-bold transition-all"
                      >
                        رفض الإيصال ❌
                      </button>
                    )}

                    {/* Status quick changers */}
                    {order.status !== "completed" && (
                      <button
                        onClick={() =>
                          updateStatusMutation.mutate({ orderId: order.id, status: "completed" })
                        }
                        className="px-2.5 py-1 bg-muted/60 hover:bg-muted text-foreground border border-border rounded-lg text-xs font-bold transition-all"
                      >
                        إكمال الطلب
                      </button>
                    )}

                    {order.status !== "processing" && order.status !== "completed" && (
                      <button
                        onClick={() =>
                          updateStatusMutation.mutate({ orderId: order.id, status: "processing" })
                        }
                        className="px-2.5 py-1 bg-muted/60 hover:bg-muted text-foreground border border-border rounded-lg text-xs font-bold transition-all"
                      >
                        قيد التجهيز
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Open Customer Chat Button */}
                    <button
                      onClick={() => {
                        if (onNavigateToChat && order.threadId) {
                          onNavigateToChat(order.threadId);
                        } else if (order.threadId) {
                          window.location.href = `/admin?tab=messages&thread=${order.threadId}`;
                        } else {
                          toast.error("لا توجد محادثة مسجلة لهذا الطلب");
                        }
                      }}
                      className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                      title="فتح محادثة العميل في صندوق الدعم"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>محادثة العميل</span>
                    </button>

                    {/* View Details Modal Button */}
                    <button
                      onClick={() => setSelectedOrder(order)}
                      className="px-3 py-1.5 bg-foreground text-background hover:opacity-90 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>التفاصيل الكاملة</span>
                    </button>

                    {/* Quick Delete for Cancelled or Completed Orders */}
                    {(order.status === "cancelled" || order.status === "completed") && (
                      <button
                        onClick={() => {
                          if (
                            window.confirm(
                              `هل أنت متأكد من حذف الطلب #${order.code || order.id} نهائياً؟ لا يمكن التراجع عن هذه العملية.`,
                            )
                          ) {
                            deleteOrderMutation.mutate(order.id);
                          }
                        }}
                        disabled={deleteOrderMutation.isPending}
                        className="p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-500/10 rounded-xl transition-colors"
                        title="حذف الطلب نهائياً"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Order Details Modal / Drawer */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-6 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <h3 className="text-lg font-black text-foreground flex items-center gap-2">
                  <span>طلب رقم:</span>
                  <span className="font-mono text-primary">
                    #{selectedOrder.code || selectedOrder.id}
                  </span>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  تم الإنشاء في: {new Date(selectedOrder.createdAt).toLocaleString("ar-IQ")}
                </p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                ✕
              </button>
            </div>

            {/* Customer Details */}
            <div className="bg-muted/30 border border-border rounded-2xl p-4 space-y-2 text-xs">
              <div className="font-bold text-foreground flex items-center gap-1.5">
                <User className="w-4 h-4 text-primary" />
                <span>بيانات العميل</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                <div>
                  الاسم:{" "}
                  <span className="font-semibold text-foreground">{selectedOrder.userName}</span>
                </div>
                <div>
                  المعرف: <span className="font-mono text-foreground">{selectedOrder.userId}</span>
                </div>
                <div>
                  حالة الدفع:{" "}
                  <span className="font-semibold text-foreground">
                    {selectedOrder.paymentStatus}
                  </span>
                </div>
                <div>
                  حالة الطلب:{" "}
                  <span className="font-semibold text-foreground">{selectedOrder.status}</span>
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Package className="w-4 h-4 text-primary" />
                <span>عناصر الطلب ({selectedOrder.items.length})</span>
              </div>
              <div className="space-y-2">
                {selectedOrder.items.map((item) => (
                  <div
                    key={item.id}
                    className="bg-muted/20 border border-border rounded-xl p-3 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between font-bold text-foreground">
                      <span>{item.title}</span>
                      <span>
                        {Number(item.unitPrice).toLocaleString()} {selectedOrder.currency || "IQD"}
                      </span>
                    </div>
                    {item.deliveryEmail && (
                      <div className="text-[11px] bg-card p-2 rounded border border-border font-mono">
                        <div>البريد المسلم: {item.deliveryEmail}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between border-t border-border pt-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const threadId = selectedOrder.threadId;
                    setSelectedOrder(null);
                    if (onNavigateToChat && threadId) {
                      onNavigateToChat(threadId);
                    } else if (threadId) {
                      window.location.href = `/admin?tab=messages&thread=${threadId}`;
                    }
                  }}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold flex items-center gap-1.5"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>فتح محادثة الدعم</span>
                </button>
                {selectedOrder.status !== "cancelled" && (
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          "هل أنت متأكد من إلغاء هذا الطلب؟ إذا كان الطلب مدفوعاً من المحفظة سيتم إرجاع المبلغ تلقائياً.",
                        )
                      ) {
                        cancelOrderMutation.mutate(selectedOrder.id);
                      }
                    }}
                    disabled={cancelOrderMutation.isPending}
                    className="px-4 py-2 bg-red-500/10 text-red-600 font-bold rounded-xl text-xs hover:bg-red-500/20 transition-colors border border-red-500/20"
                  >
                    {cancelOrderMutation.isPending
                      ? "جاري الإلغاء..."
                      : "إلغاء الطلب واسترجاع المبلغ"}
                  </button>
                )}
                {(selectedOrder.status === "cancelled" || selectedOrder.status === "completed") && (
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          `هل أنت متأكد من حذف الطلب #${selectedOrder.code || selectedOrder.id} نهائياً؟ لا يمكن التراجع عن هذه العملية.`,
                        )
                      ) {
                        deleteOrderMutation.mutate(selectedOrder.id);
                      }
                    }}
                    disabled={deleteOrderMutation.isPending}
                    className="px-4 py-2 bg-red-500/10 text-red-600 font-bold rounded-xl text-xs hover:bg-red-500/20 transition-colors border border-red-500/20 flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>
                      {deleteOrderMutation.isPending ? "جاري الحذف..." : "حذف الطلب نهائياً"}
                    </span>
                  </button>
                )}
              </div>

              <button
                onClick={() => setSelectedOrder(null)}
                className="px-4 py-2 bg-muted text-foreground rounded-xl text-xs font-bold"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default OrdersManagerView;
