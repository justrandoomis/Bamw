import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

/**
 * Telegram ownership proof.
 *
 * The visitor opens a tokenized `/start` link. The bot offers both a Web App
 * button and direct contact sharing; this card polls until the server confirms
 * the phone match.
 */
export default function TelegramLinkPrompt({
  message,
  linkUrl,
  token,
  onVerified,
  onRetry,
}: {
  message: string;
  linkUrl: string;
  token?: string | undefined;
  onVerified: () => void;
  onRetry?: () => void;
}) {
  const [state, setState] = useState<
    "pending" | "used" | "verified" | "failed" | "expired" | "unknown" | "contact_required"
  >("pending");
  const [hasClicked, setHasClicked] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const res = await api.telegramLinkStatus(token);
        if (!alive) return;
        setState(res.status);
        if (res.status === "verified" && !fired.current) {
          fired.current = true;
          clearInterval(timer);
          onVerified();
        }
        if (res.status === "expired" || res.status === "failed") {
          clearInterval(timer);
        }
      } catch {
        /* transient network error: keep polling */
      }
    }, 3000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token, onVerified]);

  const isTerminal = state === "failed" || state === "expired" || state === "unknown";

  return (
    <motion.div
      initial={{ scale: 0.9, y: 20, opacity: 0 }}
      animate={{ scale: 1, y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
      className="mb-6 border border-[var(--clay-rim)] bg-surface-2 p-6 text-center shadow-md"
      style={{ borderRadius: "28px" }}
    >
      <p className="mb-4 text-[13px] font-bold text-ink-soft leading-relaxed px-2">
        {message.split("\n").map((line, i) => (
          <span key={i} className="block">
            {line}
          </span>
        ))}
      </p>

      <div className="flex flex-col gap-3">
        {(!hasClicked || isTerminal) && !isTerminal && (
          <button
            type="button"
            onClick={() => {
              setHasClicked(true);
              window.open(linkUrl, "_blank");
            }}
            className="flex items-center justify-center bg-ink-base px-6 py-3.5 text-[15px] font-black text-surface shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] cursor-pointer w-full"
            style={{ borderRadius: "22px" }}
          >
            فتح تطبيق تلغرام للتحقق
          </button>
        )}

        {hasClicked && !isTerminal && (
          <div
            className="flex items-center justify-center gap-2 bg-ink-base/10 px-6 py-3.5 text-[15px] font-black text-ink-base shadow-inner w-full"
            style={{ borderRadius: "22px" }}
          >
            <span className="animate-spin text-xl">⏳</span>
            <span>بانتظار إثبات الملكية...</span>
          </div>
        )}

        {isTerminal && onRetry && (
          <button
            type="button"
            onClick={() => {
              setHasClicked(false);
              onRetry();
            }}
            className="flex items-center justify-center bg-red-500 px-6 py-3.5 text-[15px] font-black text-white shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] cursor-pointer w-full mt-2"
            style={{ borderRadius: "22px" }}
          >
            تجديد رابط التحقق (إعادة المحاولة)
          </button>
        )}
      </div>

      <p className={`mt-4 text-[12px] font-bold ${isTerminal ? "text-red-500" : "text-ink-mute"}`}>
        {state === "expired"
          ? "انتهت صلاحية الرابط، يرجى طلب رابط جديد."
          : state === "failed"
            ? "تعذر إثبات الملكية أو أن الرقم لا يطابق الحساب. تأكد من إرسال جهة اتصال رقمك المطابق للرقم المدخل."
            : state === "unknown"
              ? "تعذر العثور على الجلسة. اطلب رابطاً جديداً."
              : state === "used" || state === "verified"
                ? "تم إثبات الملكية، جارٍ إرسال رمز التحقق…"
                : state === "contact_required"
                  ? "يرجى الضغط على 'مشاركة رقم هاتفي' في المحادثة مع البوت…"
                  : "سيتم التحقق تلقائياً عند مشاركتك لجهة الاتصال في تلغرام."}
      </p>
    </motion.div>
  );
}
