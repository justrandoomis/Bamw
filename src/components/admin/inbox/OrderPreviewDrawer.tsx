import React from "react";
import { readOrderItemSelection, selectionSummary } from "@/lib/orderItemSelection";
import {
  X,
  ShoppingBag,
  Clock,
  CheckCircle2,
  AlertCircle,
  Key,
  ShieldCheck,
  User,
  CreditCard,
  Layers,
  Copy,
  ExternalLink,
  Check,
} from "lucide-react";
import { Order } from "@/lib/types";
import { toast } from "sonner";

interface OrderPreviewDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  onClaim?: (orderId: string) => void;
  onComplete?: (orderId: string) => void;
  onPrepare?: (orderId: string) => void;
  onOpenFullOrder?: () => void;
}

export function OrderPreviewDrawer({
  isOpen,
  onClose,
  order,
  onClaim,
  onComplete,
  onPrepare,
  onOpenFullOrder,
}: OrderPreviewDrawerProps) {
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  if (!isOpen || !order) return null;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    toast.success(`تم نسخ ${label}`);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="absolute inset-y-0 left-0 max-w-full flex" dir="rtl">
        <div className="w-screen max-w-lg bg-card border-r border-border shadow-2xl flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-border bg-muted/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-foreground">
                  تفاصيل الطلب #{order.code || order.id.slice(-8)}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {new Date(order.createdAt).toLocaleString("ar-IQ")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {onOpenFullOrder && (
                <button
                  onClick={onOpenFullOrder}
                  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                  title="عرض الطلب كاملاً"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Status & Summary banner */}
            <div className="p-4 bg-muted/30 border border-border rounded-2xl flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground mb-1">حالة الطلب الحالية</div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                      order.status === "completed"
                        ? "bg-emerald-500/10 text-emerald-600"
                        : order.status === "processing"
                          ? "bg-amber-500/10 text-amber-600"
                          : "bg-blue-500/10 text-blue-600"
                    }`}
                  >
                    {order.status === "completed"
                      ? "تم التسليم"
                      : order.status === "processing"
                        ? "قيد التجهيز"
                        : order.status === "pending"
                          ? "معلق"
                          : order.status}
                  </span>
                  <span className="text-xs text-muted-foreground font-semibold">
                    حالة الدفع: {order.paymentStatus || "unpaid"}
                  </span>
                </div>
              </div>
              <div className="text-left">
                <div className="text-xs text-muted-foreground mb-0.5">الإجمالي</div>
                <div className="text-base font-bold text-foreground">
                  {(order.total || 0).toLocaleString()} د.ع
                </div>
              </div>
            </div>

            {/* Quick Actions for Order */}
            <div className="flex flex-wrap gap-2">
              {order.status !== "completed" && onComplete && (
                <button
                  type="button"
                  onClick={() => onComplete(order.id)}
                  className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  إكمال وتسليم الطلب
                </button>
              )}
              {order.status !== "processing" && order.status !== "completed" && onPrepare && (
                <button
                  type="button"
                  onClick={() => onPrepare(order.id)}
                  className="flex-1 py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <Clock className="w-4 h-4" />
                  بدء التجهيز
                </button>
              )}
            </div>

            {/* Order Items */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-muted-foreground" />
                <span>عناصر الطلب ({order.items?.length || 0})</span>
              </div>

              {order.items?.map((item, idx) => (
                <div
                  key={idx}
                  className="p-3.5 bg-muted/20 border border-border rounded-xl space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-bold text-xs text-foreground">{item.title}</div>
                    <div className="text-xs font-bold text-muted-foreground whitespace-nowrap">
                      {item.unitPrice ? `${item.unitPrice.toLocaleString()} د.ع` : ""}
                    </div>
                  </div>

                  {/*
                    The selection, read through the same coercing reader the
                    fulfilment cards use.

                    This printed `meta.editionId` raw under a label reading
                    "النسخة / النوع" — the wrong value under the right label.
                    And `meta` comes from the checkout request, which
                    type-checks nothing inside a line, so an object stored
                    there rendered as the literal "[object Object]" on an
                    admin's screen.
                  */}
                  {selectionSummary(readOrderItemSelection(item.meta)) && (
                    <div className="text-[11px] text-muted-foreground">
                      النسخة / النوع:{" "}
                      <span className="font-semibold text-foreground">
                        {selectionSummary(readOrderItemSelection(item.meta))}
                      </span>
                    </div>
                  )}

                  {item.deliveryEmail && (
                    <div className="p-2.5 bg-card border border-border rounded-lg space-y-1.5">
                      <div className="text-[11px] font-semibold text-muted-foreground">
                        بيانات الحساب:
                      </div>
                      <div
                        className="flex items-center justify-between text-xs font-mono bg-muted/40 p-1.5 rounded"
                        dir="ltr"
                      >
                        <span className="truncate">{item.deliveryEmail}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(item.deliveryEmail!, "البريد")}
                          className="text-muted-foreground hover:text-foreground shrink-0"
                          title="نسخ البريد"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                      {item.deliveryPasswordEnc && (
                        <div className="text-[11px] text-muted-foreground bg-muted/40 p-1.5 rounded">
                          كلمة المرور مخزّنة مشفّرة — تُكشف فقط عبر زر كشف كلمة المرور الآمن.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-border bg-muted/20 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-card border border-border rounded-xl text-xs font-semibold text-foreground hover:bg-muted transition-colors"
            >
              إغلاق
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
