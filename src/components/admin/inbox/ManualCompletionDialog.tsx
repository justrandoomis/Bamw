import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck, X } from "lucide-react";

/*
  The manual completion door.

  The strict button refuses an order whose delivery slots never reached a
  terminal state, and that is correct: it is what keeps the store from
  claiming an OTP went out when none did. But an admin who read the code
  down the phone has delivered the order, and the strict button will refuse
  it for the rest of that order's life.

  So this asks for two things a misclick cannot produce — the order's own
  code, typed out, and a written reason — and says plainly what the action
  will and will not record.
*/

export const MANUAL_REASON_MIN = 10;
export const MANUAL_REASON_MAX = 500;

export interface ManualCompletionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  orderCode: string;
  onConfirm: (input: { reason: string; confirmText: string }) => Promise<unknown> | void;
  isBusy?: boolean;
  /** Expected slots that have not reached a terminal state; forced to `completed`. */
  pendingCount?: number;
  /** Unmapped rows; archived, never deleted. */
  unmappedCount?: number;
}

export function ManualCompletionDialog({
  isOpen,
  onClose,
  orderCode,
  onConfirm,
  isBusy = false,
  pendingCount,
  unmappedCount,
}: ManualCompletionDialogProps) {
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

  // A fresh dialog every time: a reason typed for one order must never be
  // carried into the next one.
  useEffect(() => {
    if (!isOpen) return;
    setReason("");
    setConfirmText("");
    const timer = setTimeout(() => reasonRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [isOpen, orderCode]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isBusy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, isBusy, onClose]);

  const trimmedReason = reason.trim();
  const reasonOk =
    trimmedReason.length >= MANUAL_REASON_MIN && trimmedReason.length <= MANUAL_REASON_MAX;
  // The server compares against the order code exactly; mirror it here rather
  // than accepting something the server will then reject.
  const codeOk = confirmText.trim() === orderCode;
  const canConfirm = reasonOk && codeOk && !isBusy;

  const effect = useMemo(() => {
    const lines: string[] = [];
    if (typeof pendingCount === "number" && pendingCount > 0) {
      lines.push(`سيتم تعليم ${pendingCount} عنصر تسليم كمكتمل يدوياً.`);
    }
    if (typeof unmappedCount === "number" && unmappedCount > 0) {
      lines.push(`سيتم أرشفة ${unmappedCount} سطر غير مرتبط (بدون حذف).`);
    }
    return lines;
  }, [pendingCount, unmappedCount]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="إكمال الطلب يدوياً"
    >
      <div className="flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:max-h-[90vh] sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/20 px-4 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="rounded-xl bg-amber-500/10 p-2 text-amber-500">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-foreground">إكمال الطلب يدوياً</h3>
              <p className="text-[11px] text-muted-foreground">
                للطلبات التي سُلّمت خارج الأداة — #{orderCode}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 cursor-pointer"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <div className="space-y-1.5 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-3.5 text-[11.5px] leading-relaxed text-amber-900 dark:text-amber-200">
            <p className="font-bold">استخدم هذا فقط إذا سلّمت الحساب أو الكود بنفسك خارج الأداة.</p>
            <p>
              لن يسجّل النظام أن OTP أو كوداً أُرسل من الأداة، ولن يُحفظ أي اسم مستخدم أو كلمة مرور.
              يُسجَّل فقط أن الإدارة أكملت الطلب يدوياً، مع السبب.
            </p>
            {effect.map((line) => (
              <p key={line}>• {line}</p>
            ))}
          </div>

          <label className="block space-y-1.5">
            <span className="text-[11px] font-bold text-foreground">
              سبب الإكمال اليدوي (مطلوب)
            </span>
            <textarea
              ref={reasonRef}
              value={reason}
              onChange={(event) => setReason(event.target.value.slice(0, MANUAL_REASON_MAX))}
              rows={3}
              placeholder="مثال: أرسلت الكود للعميل عبر واتساب وأكد استلامه."
              className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-xs leading-relaxed text-start outline-none focus:border-amber-500/60"
            />
            <span
              className={`block text-[10px] font-bold ${
                reasonOk ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {trimmedReason.length}/{MANUAL_REASON_MAX} — {MANUAL_REASON_MIN} أحرف على الأقل
            </span>
          </label>

          <label className="block space-y-1.5">
            <span className="text-[11px] font-bold text-foreground">
              اكتب رقم الطلب <span className="font-mono">{orderCode}</span> للتأكيد
            </span>
            <input
              dir="ltr"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={orderCode}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs tracking-wide text-start outline-none focus:border-amber-500/60"
            />
          </label>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/20 p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="px-4 py-2 text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-40 cursor-pointer"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={() =>
              canConfirm &&
              void onConfirm({ reason: trimmedReason, confirmText: confirmText.trim() })
            }
            disabled={!canConfirm}
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 px-5 py-2.5 text-xs font-bold text-white disabled:opacity-40 cursor-pointer"
          >
            {isBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}{" "}
            تأكيد الإكمال اليدوي
          </button>
        </div>
      </div>
    </div>
  );
}
