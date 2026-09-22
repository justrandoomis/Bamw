import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck, X } from "lucide-react";

/*
  The manual completion door.

  The strict button refuses an order whose delivery slots never reached a
  terminal state, and that is correct: it is what keeps the store from
  claiming an OTP went out when none did. But an admin who read the code
  down the phone has delivered the order, and the strict button will refuse
  it for the rest of that order's life.

  It used to ask the admin to TYPE the order's code and then compose a reason
  from nothing, and the owner asked for it to be «نعم أو لا». So it is: two
  buttons, and nothing to type.

  What was actually protective is kept. The dialog is still a deliberate
  second action, not a one-tap button in a strip. The server still checks the
  code against the order — the client sends the code it is already showing
  instead of asking a human to copy it across, which tests the same thing and
  tests it more reliably than a person retyping under time pressure. And a
  reason is still recorded, prefilled with what this action IS and shown on
  screen before «نعم» so nothing is written that the admin has not read; an
  admin with more to say types over it.

  What is not kept is the friction that was only friction.
*/

export const MANUAL_REASON_MIN = 10;
export const MANUAL_REASON_MAX = 500;

/**
 * What the audit records when the admin adds nothing of their own.
 *
 * True of every use of this door, long enough for the server's floor, and
 * shown on screen before «نعم» — so it is a label for the action, not a
 * sentence put into an admin's mouth.
 */
export const DEFAULT_MANUAL_REASON = "أكملت الإدارة الطلب يدوياً بعد تسليمه للعميل خارج الأداة.";

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
  const [reason, setReason] = useState(DEFAULT_MANUAL_REASON);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

  // A fresh dialog every time: a reason typed for one order must never be
  // carried into the next one.
  useEffect(() => {
    if (!isOpen) return;
    setReason(DEFAULT_MANUAL_REASON);
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
  /*
    An admin may clear the box; they may not send nothing. The recorded reason
    falls back to the same default the box opened with, so the audit line is
    never empty and never shorter than the server will take.
  */
  const recordedReason = (
    trimmedReason.length >= MANUAL_REASON_MIN ? trimmedReason : DEFAULT_MANUAL_REASON
  ).slice(0, MANUAL_REASON_MAX);
  const canConfirm = !isBusy;

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
              <h3 className="text-sm font-bold text-foreground">هل تريد إكمال الطلب يدوياً؟</h3>
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

          {/*
            The reason is shown, not demanded. It opens with what this action
            is, which is true of every use of this door and is what the audit
            will carry — so an admin sees the line before they agree to it, and
            one who has more to say types over it. Optional, because the owner
            asked for نعم أو لا and a required essay is neither.
          */}
          <label className="block space-y-1.5">
            <span className="text-[11px] font-bold text-foreground">
              السبب المسجَّل <span className="font-normal text-muted-foreground">(اختياري)</span>
            </span>
            <textarea
              ref={reasonRef}
              value={reason}
              onChange={(event) => setReason(event.target.value.slice(0, MANUAL_REASON_MAX))}
              rows={2}
              placeholder={DEFAULT_MANUAL_REASON}
              className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-xs leading-relaxed text-start outline-none focus:border-amber-500/60"
            />
          </label>
        </div>

        {/*
          نعم or لا, and nothing to type.

          The confirmation the server checks is the order's own code, and the
          dialog has been showing it at the top the whole time — so it sends
          that, rather than asking a human to copy a string from one line of
          the same screen to another. The check the server performs is
          unchanged.
        */}
        <div className="flex shrink-0 items-center gap-3 border-t border-border bg-muted/20 p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-xs font-bold text-foreground hover:bg-muted disabled:opacity-40 cursor-pointer"
          >
            لا
          </button>
          <button
            type="button"
            onClick={() =>
              canConfirm && void onConfirm({ reason: recordedReason, confirmText: orderCode })
            }
            disabled={!canConfirm}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 px-5 py-2.5 text-xs font-bold text-white disabled:opacity-40 cursor-pointer"
          >
            {isBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}{" "}
            نعم، أكمل الطلب
          </button>
        </div>
      </div>
    </div>
  );
}
