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
  HelpCircle,
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

  const handleOpenInvoice = () => {
    if (onOpenInvoice) {
      onOpenInvoice(orderId);
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
      <div
        id={`digital-order-card-${code}`}
        dir={isAr ? "rtl" : "ltr"}
        className="w-full max-w-lg my-3 rounded-[22px] border border-[var(--line)] bg-card text-[var(--ink)] p-4 sm:p-5 shadow-xs transition-all animate-in fade-in slide-in-from-bottom-2 duration-300"
      >
        {/* Top Header: Order Code, Status badge & Copy */}
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--line)]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-[var(--surface-3)] text-[var(--ink)] flex items-center justify-center font-bold shrink-0 border border-[var(--line)]">
              <Package className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-mono font-bold tracking-wider text-[var(--muted-ink)] uppercase">
                  {code}
                </span>
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusBadge.className}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${statusBadge.dot}`} />
                  {statusBadge.label}
                </span>
              </div>
              <div className="text-xs text-[var(--muted-ink)] flex items-center gap-1 mt-0.5">
                <Calendar className="h-3 w-3" />
                <span>{formattedDate}</span>
              </div>
            </div>
          </div>

          {/* Copy Order Code */}
          <button
            type="button"
            onClick={onCopy}
            title={isAr ? "نسخ رقم الطلب" : "Copy Order ID"}
            aria-label={`Copy order code ${code}`}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--line)] text-xs font-mono font-bold text-[var(--ink)] transition-all active:scale-95 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-emerald-600 dark:text-emerald-400 text-[11px]">
                  {isAr ? "تم النسخ" : "Copied"}
                </span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-[var(--muted-ink)]" />
                <span className="text-[11px]">{isAr ? "نسخ" : "Copy"}</span>
              </>
            )}
          </button>
        </div>

        {/* Dynamic Queue & Admin Status Card (Replacing the old static 3-step stepper) */}
        <div className="my-3 rounded-xl bg-[var(--surface-2)]/80 border border-[var(--line)] p-2.5 space-y-2.5">
          {/*
            `flex-wrap` and `min-w-0`: the heading and the availability pill sat
            in a row that could not wrap, on a card already four levels of
            padding deep inside a 360px screen. Neither side could give way, so
            the row pushed the card wider than the pane holding it.
          */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <div className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-[var(--ink)]">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="truncate">
                {isAr ? "حالة الطابور والتجهيز" : "Queue & Fulfillment Status"}
              </span>
            </div>

            {/* Admin Availability Indicator */}
            <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium">
              <span
                className={`h-2 w-2 rounded-full ${
                  adminStatus === "available"
                    ? "bg-emerald-500 shadow-xs shadow-emerald-500/50"
                    : adminStatus === "busy"
                      ? "bg-amber-500"
                      : "bg-stone-400"
                }`}
              />
              <span className="text-[var(--muted-ink)]">
                {adminStatus === "available"
                  ? isAr
                    ? "المشرف متاح الآن"
                    : "Admin Online"
                  : adminStatus === "busy"
                    ? isAr
                      ? "المشرف مشغول بالتجهيز"
                      : "Admin Busy"
                    : isAr
                      ? "خارج أوقات العمل"
                      : "Admin Offline"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            {/* Position in Queue */}
            <div className="flex items-center gap-2 p-2 rounded-lg bg-card border border-[var(--line)]">
              <div className="h-7 w-7 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Zap className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] text-[var(--muted-ink)] font-medium">
                  {isAr ? "الدور في الطابور" : "Queue Position"}
                </div>
                <div className="font-bold text-[var(--ink)] truncate text-[11.5px]">
                  {queueLabel}
                </div>
              </div>
            </div>

            {/* Estimated Time */}
            <div className="flex items-center gap-2 p-2 rounded-lg bg-card border border-[var(--line)]">
              <div className="h-7 w-7 rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-400 flex items-center justify-center shrink-0">
                <Clock className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] text-[var(--muted-ink)] font-medium">
                  {isAr ? "الوقت التقديري" : "Estimated Time"}
                </div>
                <div className="font-bold text-[var(--ink)] truncate text-[11.5px]">
                  {estimatedTimeLabel}
                </div>
              </div>
            </div>
          </div>

          {/* Optional notice / working hours note */}
          {adminStatus === "offline" && workingHoursText && (
            <div className="text-[11px] text-[var(--muted-ink)] bg-stone-500/10 border border-stone-500/20 rounded-lg p-2 flex items-start gap-1.5">
              <Clock className="h-3.5 w-3.5 text-stone-600 dark:text-stone-400 shrink-0 mt-0.5" />
              <span className="leading-snug">{workingHoursText}</span>
            </div>
          )}
        </div>

        {/* Ordered Items List */}
        {items.length > 0 && (
          <div className="space-y-2 mb-3">
            <div className="text-[11px] font-bold tracking-wider text-[var(--muted-ink)] uppercase flex items-center justify-between">
              <span>{isAr ? "المنتجات / الألعاب" : "Ordered Items"}</span>
              <span className="text-[10px] font-normal">
                {items.length} {isAr ? "عنصر" : "item(s)"}
              </span>
            </div>
            <div className="space-y-1.5">
              {items.map((item, idx) => (
                <div
                  key={item.id || `${item.title}-${idx}`}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[var(--surface-2)]/60 border border-[var(--line)] text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.title}
                        className="h-9 w-9 rounded-lg object-cover bg-neutral-900 shrink-0 border border-[var(--line)]"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="h-9 w-9 rounded-lg bg-[var(--surface-3)] text-[var(--ink)] flex items-center justify-center shrink-0 border border-[var(--line)]">
                        <Gamepad2 className="h-4.5 w-4.5 text-[var(--muted-ink)]" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-bold text-[var(--ink)] truncate text-xs">
                        {item.title}
                      </div>
                      <div className="text-[10px] text-[var(--muted-ink)] flex items-center gap-1">
                        <span>
                          {item.kind === "digital_code"
                            ? isAr
                              ? "رمز رقمي"
                              : "Digital Code"
                            : isAr
                              ? "حساب رقمي Nintendo Switch"
                              : "Nintendo Switch Account"}
                        </span>
                        {item.quantity && item.quantity > 1 && (
                          <span className="font-bold text-amber-600 dark:text-amber-400">
                            × {item.quantity}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {typeof item.unitPrice === "number" && (
                    <div className="shrink-0 font-bold text-[var(--ink)] font-mono text-xs">
                      {(item.unitPrice * (item.quantity || 1)).toLocaleString()}{" "}
                      <span className="text-[10px] text-[var(--muted-ink)] font-normal">
                        {currency}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Delivery Completion / Confirmation Block */}
        {canConfirmReceived && status !== "completed" && (
          <div className="mt-3 p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-foreground space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">
              <Sparkles className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>
                {isAr
                  ? "تم تسليم كافة حسابات/أكواد الطلب بنجاح!"
                  : "All order credentials/codes delivered!"}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {isAr
                ? "يرجى التحقق من بيانات الدخول والأكواد، ثم الضغط على الزر أدناه لتأكيد الاستلام وإنهاء الطلب:"
                : "Please check your accounts/codes and click below to confirm receipt:"}
            </p>
            <button
              type="button"
              onClick={onConfirmReceived}
              disabled={isConfirmingReceived}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-black shadow-sm flex items-center justify-center gap-2 transition-all active:scale-98 cursor-pointer"
            >
              {isConfirmingReceived ? (
                <Clock className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              <span>{isAr ? "✅ تم استلام الطلب بنجاح" : "Confirm Order Received"}</span>
            </button>
            {onReportIssue && (
              <button
                type="button"
                onClick={onReportIssue}
                disabled={isReportingIssue || isConfirmingReceived}
                className="w-full py-2 px-4 bg-red-500/10 hover:bg-red-500/15 disabled:opacity-50 text-red-700 dark:text-red-300 border border-red-500/25 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {isReportingIssue ? (
                  <Clock className="w-4 h-4 animate-spin" />
                ) : (
                  <AlertCircle className="w-4 h-4" />
                )}
                <span>{isAr ? "لدي مشكلة في التسليم" : "Report a delivery issue"}</span>
              </button>
            )}
          </div>
        )}

        {status === "delivery_issue" && (
          <div className="mt-3 p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-800 dark:text-red-300 text-xs font-bold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              {isAr
                ? "تم إيقاف الإكمال التلقائي وتحويل الطلب للمراجعة."
                : "Auto-completion is paused while support reviews the issue."}
            </span>
          </div>
        )}

        {status === "completed" && (
          <div className="mt-3 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-xs font-bold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>
              {isAr ? "تم اكتمال الطلب واستلامه بنجاح ✅" : "Order Completed & Received ✅"}
            </span>
          </div>
        )}

        {/* Footer: Payment summary & Invoice Details Button */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[var(--line)] text-xs">
          {/* Total & Payment method */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[11px] font-bold">
              <Wallet className="h-3 w-3" />
              <span>{paymentMethod}</span>
              {isPaid && <span>✅</span>}
            </div>

            <div className="flex items-baseline gap-1">
              <span className="text-[var(--muted-ink)] text-[11px]">
                {isAr ? "المجموع:" : "Total:"}
              </span>
              <span className="font-black text-[var(--ink)] font-mono text-sm">
                {calculatedItemsTotal.toLocaleString()}
              </span>
              <span className="text-[10px] text-[var(--muted-ink)]">{currency}</span>
            </div>
          </div>

          {/* Invoice Details Button */}
          <button
            type="button"
            onClick={handleOpenInvoice}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--surface-3)] hover:bg-[var(--ink)] hover:text-white border border-[var(--line)] text-xs font-bold text-[var(--ink)] transition-all active:scale-95 cursor-pointer shadow-2xs ms-auto"
          >
            <Receipt className="h-3.5 w-3.5" />
            <span>{isAr ? "تفاصيل الفاتورة" : "Invoice Details"}</span>
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
                  className="flex-1 py-2.5 rounded-xl bg-[var(--ink)] text-white text-xs font-bold hover:bg-[var(--ink-strong)] transition-colors cursor-pointer"
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
