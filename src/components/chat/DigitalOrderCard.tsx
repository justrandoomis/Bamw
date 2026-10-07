import { useState, useMemo } from "react";
import {
  Check,
  Copy,
  Gamepad2,
  Clock,
  ChevronRight,
  Zap,
  Receipt,
  Printer,
  X,
  Wallet,
  ShieldCheck,
  Package,
  Calendar,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { tr } from "@/i18n";
import { motion, AnimatePresence } from "framer-motion";

export interface DigitalOrderItem {
  id?: string;
  productId?: string;
  title: string;
  unitPrice?: number;
  quantity?: number;
  image?: string;
  kind?: string;
}

export interface DigitalOrderCardProps {
  orderId?: string;
  code?: string;
  items?: DigitalOrderItem[];
  total?: number;
  currency?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  status?: string;
  createdAt?: string;
  text?: string;
  locale?: "ar" | "en";
  queuePosition?: number;
  aheadCount?: number;
  estimatedMinutes?: string;
  adminStatus?: "available" | "busy" | "offline";
  workingHoursText?: string;
  canConfirmReceived?: boolean;
  onConfirmReceived?: () => void | Promise<void>;
  isConfirmingReceived?: boolean;
  onReportIssue?: () => void | Promise<void>;
  isReportingIssue?: boolean;
  onOpenInvoice?: (orderId?: string) => void;
}

export function DigitalOrderCard({
  orderId,
  code = "BN-ORDER",
  items = [],
  total,
  currency = "د.ع",
  paymentStatus = "paid",
  paymentMethod = "محفظة بنانا",
  status = "processing",
  createdAt,
  text,
  locale = "ar",
  queuePosition,
  aheadCount,
  estimatedMinutes,
  adminStatus = "available",
  workingHoursText,
  canConfirmReceived = false,
  onConfirmReceived,
  isConfirmingReceived = false,
  onReportIssue,
  isReportingIssue = false,
  onOpenInvoice,
}: DigitalOrderCardProps) {
  const [copied, setCopied] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  const isAr = locale === "ar";
  const isPaid = paymentStatus === "paid";
  const isCompleted = status === "completed";
  const isAwaitingConfirmation = status === "awaiting_customer_confirmation";
  const isDeliveryIssue = status === "delivery_issue";

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const formattedDate = useMemo(() => {
    if (!createdAt) {
      return new Date().toLocaleDateString(isAr ? "ar-IQ" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    try {
      return new Date(createdAt).toLocaleDateString(isAr ? "ar-IQ" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return createdAt;
    }
  }, [createdAt, isAr]);

  /*
    One invoice, not two: the chat opens its own when it offers one, and this
    card's is only for where nobody else does. Both used to open at once, one
    stacked over the other.
  */
  const handleOpenInvoice = () => {
    if (onOpenInvoice) {
      onOpenInvoice(orderId);
      return;
    }
    setShowInvoiceModal(true);
  };

  // Dynamic status text & theme
  const queueLabel = useMemo(() => {
    if (isCompleted) {
      return isAr ? "تم التسليم بنجاح ✨" : "Delivered Successfully";
    }
    if (isAwaitingConfirmation) {
      return isAr ? "تم التسليم • بانتظار تأكيدك" : "Delivered • Awaiting confirmation";
    }
    if (isDeliveryIssue) {
      return isAr ? "تم إيقاف الإكمال • قيد المراجعة" : "Completion paused • Under review";
    }
    if (adminStatus === "offline") {
      return isAr ? "خارج ساعات العمل" : "Outside Working Hours";
    }
    if (aheadCount !== undefined && aheadCount > 0) {
      return isAr
        ? `أمامك ${aheadCount} أشخاص • الدور #${queuePosition || aheadCount + 1}`
        : `${aheadCount} ahead in line • #${queuePosition || aheadCount + 1}`;
    }
    if (queuePosition !== undefined && queuePosition !== null) {
      if (queuePosition <= 1) {
        return isAr ? "دورك الآن - قيد التجهيز المباشر ⚡" : "Your turn - Preparing now ⚡";
      }
      return isAr
        ? `أمامك ${queuePosition - 1} أشخاص • الدور #${queuePosition}`
        : `${queuePosition - 1} ahead in line • #${queuePosition}`;
    }
    return isAr ? "دورك الآن - قيد التجهيز المباشر ⚡" : "Preparing now ⚡";
  }, [
    isCompleted,
    isAwaitingConfirmation,
    isDeliveryIssue,
    adminStatus,
    aheadCount,
    queuePosition,
    isAr,
  ]);

  const estimatedTimeLabel = useMemo(() => {
    if (isCompleted) return isAr ? "مكتمل" : "Completed";
    if (isAwaitingConfirmation) return isAr ? "حتى 60 دقيقة للتأكيد" : "Up to 60 min to confirm";
    if (isDeliveryIssue) return isAr ? "قيد مراجعة الإدارة" : "Under support review";
    if (estimatedMinutes) return estimatedMinutes;
    if (adminStatus === "offline") {
      return isAr ? "سيتم التجهيز فور بدء ساعات العمل" : "Will prepare at opening";
    }
    if (queuePosition !== undefined && queuePosition !== null) {
      if (queuePosition <= 1) return isAr ? "3 - 7 دقائق" : "3 - 7 mins";
      const minEst = Math.max(5, (queuePosition - 1) * 5 + 3);
      const maxEst = Math.max(8, queuePosition * 7 + 4);
      return isAr ? `${minEst} - ${maxEst} دقيقة` : `${minEst} - ${maxEst} mins`;
    }
    return isAr ? "5 - 12 دقيقة" : "5 - 12 mins";
  }, [
    isCompleted,
    isAwaitingConfirmation,
    isDeliveryIssue,
    estimatedMinutes,
    adminStatus,
    queuePosition,
    isAr,
  ]);

  const calculatedItemsTotal = useMemo(() => {
    if (typeof total === "number" && total > 0) return total;
    return items.reduce((acc, it) => acc + (it.unitPrice || 0) * (it.quantity || 1), 0);
  }, [total, items]);

  const statusBadge = isCompleted
    ? {
        className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
        dot: "bg-emerald-500",
        label: isAr ? "تم التسليم" : "Delivered",
      }
    : isAwaitingConfirmation
      ? {
          className: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20",
          dot: "bg-teal-500",
          label: isAr ? "بانتظار تأكيدك" : "Awaiting confirmation",
        }
      : isDeliveryIssue
        ? {
            className: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
            dot: "bg-red-500",
            label: isAr ? "قيد المراجعة" : "Under review",
          }
        : {
            className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
            dot: "bg-amber-500 animate-pulse",
            label: isAr ? "قيد التجهيز" : "Processing",
          };

  return (
    <>
      {/*
        The order, at a glance, in the space of a message.

        It was five stacked panels — a header, a queue box holding two tiles,
        an item list with thumbnails, a confirmation block and a footer — and
        on a 360×640 phone it filled the screen before the conversation began.
        One header line, one status line, a line per game and a footer now say
        the same things; the details stay a tap away on the invoice.
      */}
      <div
        id={`digital-order-card-${code}`}
        dir={isAr ? "rtl" : "ltr"}
        className="my-2 w-[min(28rem,calc(100vw-2.5rem))] max-w-full overflow-hidden rounded-[20px] border border-[var(--line)] bg-card text-[var(--ink)] shadow-xs animate-in fade-in slide-in-from-bottom-2 duration-300"
      >
        {/* Header: what, which, and how it stands. */}
        <div className="flex items-center gap-2.5 px-3.5 pt-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-500/12 text-amber-600 dark:text-amber-400">
            <Package className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-black text-[var(--ink)]">
                {isAr ? "طلب" : "Order"}{" "}
                <span className="font-mono tracking-wide" dir="ltr">
                  {code}
                </span>
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusBadge.className}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${statusBadge.dot}`} />
                {statusBadge.label}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--muted-ink)]">
              <Calendar className="h-3 w-3 shrink-0" />
              <span className="truncate">{formattedDate}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onCopy}
            title={isAr ? "نسخ رقم الطلب" : "Copy Order ID"}
            aria-label={`Copy order code ${code}`}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--muted-ink)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--ink)] active:scale-95 cursor-pointer"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Where it is in the queue, and roughly when. */}
        {!isCompleted && (
          <div className="mx-3.5 mt-3 flex items-center gap-2.5 rounded-xl bg-[var(--surface-3)]/60 px-3 py-2">
            <Zap className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-bold text-[var(--ink)]">{queueLabel}</div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--muted-ink)]">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {estimatedTimeLabel}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      adminStatus === "available"
                        ? "bg-emerald-500"
                        : adminStatus === "busy"
                          ? "bg-amber-500"
                          : "bg-stone-400"
                    }`}
                  />
                  {adminStatus === "available"
                    ? isAr
                      ? "المشرف متاح"
                      : "Admin online"
                    : adminStatus === "busy"
                      ? isAr
                        ? "المشرف مشغول بالتجهيز"
                        : "Admin busy"
                      : isAr
                        ? "خارج أوقات العمل"
                        : "Admin offline"}
                </span>
              </div>
            </div>
          </div>
        )}
        {!isCompleted && adminStatus === "offline" && workingHoursText && (
          <p className="mx-3.5 mt-2 text-[11px] leading-snug text-[var(--muted-ink)]">
            {workingHoursText}
          </p>
        )}

        {/* The games, a line each. */}
        {items.length > 0 && (
          <ul className="mt-2.5 divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {items.map((item, idx) => (
              <li
                key={item.id || `${item.title}-${idx}`}
                className="flex items-center gap-2.5 px-3.5 py-2"
              >
                {item.image ? (
                  <img
                    src={item.image}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-lg border border-[var(--line)] bg-[var(--surface-3)] object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--surface-3)] text-[var(--muted-ink)]">
                    <Gamepad2 className="h-4 w-4" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-bold text-[var(--ink)]" dir="auto">
                    {item.title}
                  </div>
                  <div className="text-[10.5px] text-[var(--muted-ink)]">
                    {item.kind === "digital_code"
                      ? isAr
                        ? "رمز رقمي"
                        : "Digital code"
                      : isAr
                        ? "حساب Nintendo Switch"
                        : "Nintendo Switch account"}
                    {item.quantity && item.quantity > 1 && (
                      <span className="ms-1 font-bold text-amber-600 dark:text-amber-400">
                        × {item.quantity}
                      </span>
                    )}
                  </div>
                </div>
                {typeof item.unitPrice === "number" && (
                  <div
                    className="shrink-0 text-[12px] font-bold tabular-nums text-[var(--ink)]"
                    dir="ltr"
                  >
                    {(item.unitPrice * (item.quantity || 1)).toLocaleString("en-US")}{" "}
                    <span className="text-[10px] font-normal text-[var(--muted-ink)]">
                      {currency}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Everything delivered: confirm, or say what is wrong. */}
        {canConfirmReceived && status !== "completed" && (
          <div className="mx-3.5 mt-3 space-y-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">
              <Sparkles className="h-4 w-4 shrink-0" />
              <span>
                {isAr ? "وصلتك كل حسابات الطلب وأكواده" : "All order credentials/codes delivered"}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--muted-ink)]">
              {isAr
                ? "تأكد أن كل شيء يعمل، ثم أكّد الاستلام لإنهاء الطلب."
                : "Check everything works, then confirm receipt to finish the order."}
            </p>
            <button
              type="button"
              onClick={onConfirmReceived}
              disabled={isConfirmingReceived}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-98 disabled:opacity-50 cursor-pointer"
            >
              {isConfirmingReceived ? (
                <Clock className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              <span>{isAr ? "تم استلام الطلب" : "Confirm order received"}</span>
            </button>
            {onReportIssue && (
              <button
                type="button"
                onClick={onReportIssue}
                disabled={isReportingIssue || isConfirmingReceived}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-2 text-xs font-bold text-red-700 transition-colors hover:bg-red-500/15 disabled:opacity-50 dark:text-red-300 cursor-pointer"
              >
                {isReportingIssue ? (
                  <Clock className="h-4 w-4 animate-spin" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                <span>{isAr ? "لدي مشكلة في التسليم" : "Report a delivery issue"}</span>
              </button>
            )}
          </div>
        )}

        {status === "delivery_issue" && (
          <div className="mx-3.5 mt-3 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-2.5 text-xs font-bold text-red-800 dark:text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              {isAr
                ? "أوقفنا الإكمال التلقائي وحوّلنا الطلب للمراجعة."
                : "Auto-completion is paused while support reviews the issue."}
            </span>
          </div>
        )}

        {status === "completed" && (
          <div className="mx-3.5 mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>{isAr ? "اكتمل الطلب واستلمته ✅" : "Order completed & received ✅"}</span>
          </div>
        )}

        {/* Paid how, how much, and the invoice. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5 text-xs">
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
            <Wallet className="h-3.5 w-3.5" />
            {paymentMethod}
            {isPaid && <Check className="h-3 w-3" />}
          </span>
          <span className="inline-flex items-baseline gap-1">
            <span className="text-[11px] text-[var(--muted-ink)]">
              {isAr ? "المجموع" : "Total"}
            </span>
            <span className="font-black tabular-nums text-[var(--ink)]" dir="ltr">
              {calculatedItemsTotal.toLocaleString("en-US")}
            </span>
            <span className="text-[10px] text-[var(--muted-ink)]">{currency}</span>
          </span>
          <button
            type="button"
            onClick={handleOpenInvoice}
            className="ms-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-[var(--ink)] transition-colors hover:bg-[var(--surface-3)] active:scale-95 cursor-pointer"
          >
            <Receipt className="h-3.5 w-3.5" />
            <span>{isAr ? "الفاتورة" : "Invoice"}</span>
            <ChevronRight className="h-3 w-3 rtl:rotate-180" />
          </button>
        </div>
      </div>

      {/* Invoice Details Modal */}
      <AnimatePresence>
        {showInvoiceModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
            dir={isAr ? "rtl" : "ltr"}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md rounded-2xl bg-card border border-[var(--line)] p-5 shadow-2xl text-[var(--ink)] max-h-[90vh] flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[var(--line)] shrink-0">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center">
                    <Receipt className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[var(--ink)]">
                      {isAr ? "فاتورة الطلب الرقمي" : "Digital Order Invoice"}
                    </h3>
                    <p className="text-[11px] font-mono text-[var(--muted-ink)]">{code}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowInvoiceModal(false)}
                  className="h-8 w-8 rounded-full bg-[var(--surface-3)] hover:bg-[var(--line)] flex items-center justify-center text-[var(--ink)] transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Modal Body / Invoice Sheet */}
              <div className="flex-1 overflow-y-auto py-4 space-y-4 text-xs">
                {/* Meta details grid */}
                <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]">
                  <div>
                    <span className="text-[10px] text-[var(--muted-ink)] block">
                      {isAr ? "تاريخ الطلب" : "Order Date"}
                    </span>
                    <span className="font-bold text-[var(--ink)] text-[11px]">{formattedDate}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[var(--muted-ink)] block">
                      {isAr ? "حالة الدفع" : "Payment Status"}
                    </span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400 text-[11px] flex items-center gap-1">
                      <Check className="h-3 w-3" />
                      {isAr ? "مدفوع من المحفظة" : "Paid via Wallet"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[var(--muted-ink)] block">
                      {isAr ? "طريقة التسليم" : "Delivery Method"}
                    </span>
                    <span className="font-bold text-[var(--ink)] text-[11px]">
                      {isAr ? "تسليم رقمي في المحادثة" : "Digital Chat Delivery"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[var(--muted-ink)] block">
                      {isAr ? "حالة الطلب" : "Order Status"}
                    </span>
                    <span className="font-bold text-amber-600 dark:text-amber-400 text-[11px]">
                      {isCompleted
                        ? isAr
                          ? "مكتمل"
                          : "Completed"
                        : isAr
                          ? "قيد التجهيز"
                          : "Processing"}
                    </span>
                  </div>
                </div>

                {/* Items Table */}
                <div>
                  <div className="text-[11px] font-bold text-[var(--muted-ink)] mb-2 uppercase tracking-wider">
                    {isAr ? "تفاصيل المنتجات" : "Items Summary"}
                  </div>
                  <div className="border border-[var(--line)] rounded-xl overflow-hidden divide-y divide-[var(--line)]">
                    {items.map((item, i) => (
                      <div
                        key={i}
                        className="p-2.5 flex items-center justify-between gap-2 bg-card"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-[var(--ink)] truncate text-xs">
                            {item.title}
                          </div>
                          <div className="text-[10px] text-[var(--muted-ink)]">
                            {item.quantity || 1} × {(item.unitPrice || 0).toLocaleString()}{" "}
                            {currency}
                          </div>
                        </div>
                        <div className="font-bold text-[var(--ink)] font-mono text-xs">
                          {((item.unitPrice || 0) * (item.quantity || 1)).toLocaleString()}{" "}
                          {currency}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totals Breakdown */}
                <div className="p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] space-y-1.5">
                  <div className="flex justify-between text-[var(--muted-ink)] text-[11px]">
                    <span>{isAr ? "المجموع الفرعي:" : "Subtotal:"}</span>
                    <span className="font-mono font-medium">
                      {calculatedItemsTotal.toLocaleString()} {currency}
                    </span>
                  </div>
                  <div className="flex justify-between text-[var(--muted-ink)] text-[11px]">
                    <span>{isAr ? "رسوم التجهيز والتسليم:" : "Fulfillment Fee:"}</span>
                    <span className="font-mono text-emerald-600 font-bold">
                      {isAr ? "مجاناً" : "Free"}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-[var(--line)] flex justify-between items-baseline font-bold text-[var(--ink)] text-sm">
                    <span>{isAr ? "المجموع النهائي المدفوع:" : "Total Paid:"}</span>
                    <span className="text-base font-black font-mono text-amber-600 dark:text-amber-400">
                      {calculatedItemsTotal.toLocaleString()} {currency}
                    </span>
                  </div>
                </div>

                <div className="text-[10px] text-center text-[var(--muted-ink)] leading-relaxed">
                  {isAr
                    ? "🎮 متجر بنانا - تسوق الألعاب والحسابات الرقمية المعتمدة.\nبيانات الدخول والضمان مسجلة ومحفوظة لحسابك."
                    : "Banana Store - Official Digital Gaming & Accounts."}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="pt-3 border-t border-[var(--line)] flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    window.print();
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[var(--surface-3)] hover:bg-[var(--line)] text-xs font-bold text-[var(--ink)] transition-colors cursor-pointer"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>{isAr ? "طباعة الفاتورة" : "Print Invoice"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowInvoiceModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-[var(--ink)] text-[var(--page)] text-xs font-bold hover:bg-[var(--ink-strong)] transition-colors cursor-pointer"
                >
                  {isAr ? "إغلاق" : "Close"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
export default DigitalOrderCard;
