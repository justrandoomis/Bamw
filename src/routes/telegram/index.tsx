import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { resolveTelegramVerificationReference } from "@/lib/telegram-launch";
import mascot from "@/assets/bananto_logo.webp.asset.json";
import { User, Shield, Bell, Trophy, Users, LogOut, CheckCircle2, AlertCircle } from "lucide-react";
import AdminWalletReview from "@/components/admin/AdminWalletReview";

export const Route = createFileRoute("/telegram/")({
  component: TelegramIndex,
});

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: any;
        version: string;
        platform: string;
        ready: () => void;
        close: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        openTelegramLink?: (url: string) => void;
        isVersionAtLeast?: (version: string) => boolean;
        MainButton: {
          text: string;
          show: () => void;
          hide: () => void;
          onClick: (fn: () => void) => void;
        };
        requestContact?: (callback?: (shared: boolean) => void) => void;
        expand: () => void;
        onEvent: (eventType: string, eventHandler: (event: any) => void) => void;
        offEvent: (eventType: string, eventHandler: (event: any) => void) => void;
        HapticFeedback?: {
          impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
        };
      };
    };
  }
}

function readStartParam(tg: NonNullable<Window["Telegram"]>["WebApp"]): string | null {
  return resolveTelegramVerificationReference({
    initData: tg.initData,
    initDataUnsafe: tg.initDataUnsafe,
    search: window.location.search,
    hash: window.location.hash,
  });
}

function TelegramIndex() {
  const [user, setUser] = useState<any>(null);
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "ready" | "verifying" | "verified" | "failed">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const [reviewMode, setReviewMode] = useState<"wallet" | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);

  useEffect(() => {
    if (status === "verified" && !reviewMode) {
      api
        .me()
        .then((res) => setUser(res?.user))
        .catch(console.error);
    }
  }, [status, reviewMode]);

  useEffect(() => {
    let active = true;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const initialize = async () => {
      const tg = window.Telegram?.WebApp;

      if (!tg && attempts++ < 20) {
        retryTimer = setTimeout(() => void initialize(), 100);
        return;
      }
      if (!active) return;
      if (!tg) {
        setError("تعذر التحقق من جلسة تلغرام. افتح التطبيق من زر إثبات الملكية داخل الموقع.");
        setStatus("failed");
        return;
      }

      tg.ready();
      tg.expand();
      tg.setHeaderColor?.("#f4f1e8");
      tg.setBackgroundColor?.("#f4f1e8");

      const verificationRef = readStartParam(tg);

      if (verificationRef?.startsWith("wallet_")) {
        setReviewMode("wallet");
        setReviewId(verificationRef.replace("wallet_", ""));
        setStatus("ready");
        return;
      }

      if (!verificationRef) {
        // Opened from the bot's menu or app button rather than a proof link:
        // this screen has nothing to prove, so show the member the store
        // instead of an error about a code they were never given.
        window.location.replace("/");
        return;
      }

      setSessionId(verificationRef);

      /**
       * Fall back to the server's own view of the session.
       *
       * The webhook binds this chat to the session when the user taps the
       * bot's `/start` link, so an unusable launch payload does not mean the
       * proof is impossible — only that this page cannot re-assert the
       * identity itself. Reply-keyboard Web Apps also receive empty initData
       * by design and have always relied on this path.
       */
      const fallbackToSessionStatus = async (fallbackMessage: string) => {
        const existing = await api.telegramLinkStatus(verificationRef);
        if (!active) return;
        if (existing.status === "verified") {
          setError(null);
          setStatus("verified");
          return;
        }
        if (existing.status === "contact_required" || existing.status === "pending") {
          setError(null);
          setStatus("ready");
          return;
        }
        setError(
          existing.status === "expired"
            ? "انتهت صلاحية جلسة التحقق. ارجع إلى الموقع واطلب رابطاً جديداً."
            : fallbackMessage,
        );
        setStatus("failed");
      };

      try {
        if (!tg.initData) {
          await fallbackToSessionStatus(
            "تعذر ربط جلسة تلغرام بهويتك. ارجع إلى الموقع واضغط إثبات الملكية مرة أخرى.",
          );
          return;
        }

        const result = await api.bindTelegramIdentity(verificationRef, tg.initData);
        if (!active) return;
        setError(null);
        setStatus(result.status === "verified" ? "verified" : "ready");
      } catch (err) {
        if (!active) return;
        console.error("Identity bind failed", err);
        const message = err instanceof Error ? err.message : "فشل التحقق من هوية تلغرام";
        try {
          // Rejected launch data is recoverable whenever the bot has already
          // bound this chat, so check before dead-ending the user on an error
          // they cannot act on.
          await fallbackToSessionStatus(message);
        } catch {
          if (!active) return;
          setError(message);
          setStatus("failed");
        }
      }
    };

    void initialize();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;

    const poll = async () => {
      try {
        const result = await api.telegramLinkStatus(sessionId);
        if (!active) return;
        if (result.status === "verified") {
          setError(null);
          setStatus("verified");
        } else if (result.status === "failed") {
          setError("رقم الهاتف المرتبط بحساب تلغرام لا يطابق الرقم الذي أدخلته في الموقع.");
          setStatus("failed");
        } else if (result.status === "expired") {
          setError("انتهت صلاحية جلسة التحقق. ارجع إلى الموقع واطلب رابطاً جديداً.");
          setStatus("failed");
        }
      } catch {
        // A transient connection failure must not cancel an active native
        // contact prompt. The next poll will retry automatically.
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [sessionId]);

  const handleShareContact = () => {
    const tg = window.Telegram?.WebApp;
    if (!tg) {
      setError("يجب فتح التطبيق داخل تلغرام حصراً");
      return;
    }

    try {
      setError(null);
      setStatus("verifying");

      // Some Android clients omit requestContact in their SDK version.
      // We still try to call it, but fall back to guiding the user if it fails.
      if (typeof tg.requestContact === "function") {
        tg.requestContact((shared: boolean) => {
          if (!shared) {
            setError("يجب السماح بمشاركة رقم الهاتف لإتمام إثبات الملكية.");
            setStatus("ready");
          }
          // If shared=true, the polling logic will pick up the server-side verification.
        });
      } else {
        // Fallback for older Telegram clients or platforms where requestContact is missing
        throw new Error("method_missing");
      }
    } catch (err) {
      console.error("[telegram-app] requestContact failed", err);
      setError(
        "تعذر طلب الرقم تلقائياً. يرجى إغلاق هذا التطبيق والضغط على زر «مشاركة رقم هاتفي مباشرة» في محادثة البوت.",
      );
      setStatus("ready");
    }
  };

  if (reviewMode === "wallet" && reviewId) {
    return (
      <div
        className="min-h-screen bg-[var(--page)] text-[var(--ink-base)] flex flex-col font-sans rtl"
        dir="rtl"
      >
        <AdminWalletReview id={reviewId} />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-[var(--page)] text-[var(--ink-base)] flex flex-col items-center overflow-x-hidden font-sans rtl"
      dir="rtl"
    >
      {/* Header Bar */}
      <header className="w-full px-6 py-8 flex flex-col items-center gap-4 bg-[var(--page)] border-b border-line-2">
        <div className="w-20 h-20 bg-white rounded-[24px] shadow-sm flex items-center justify-center border-4 border-[var(--brand-red)] outline outline-2 outline-line-2 outline-offset-[-6px]">
          {logoFailed ? (
            <span aria-label="بنانتو" role="img" className="text-4xl">
              🍌
            </span>
          ) : (
            <img
              src={mascot.url}
              alt="شعار بنانتو"
              className="w-12 h-12 object-contain"
              onError={() => setLogoFailed(true)}
            />
          )}
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-black text-[var(--ink-base)] tracking-tight">بنانتو</h1>
          <p className="text-[10px] font-black tracking-[0.2em] text-[var(--brand-red)] uppercase mt-1 opacity-80">
            SECURE IDENTITY
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full max-w-md px-6 py-10 flex-1 flex flex-col">
        <div
          className="relative bg-surface-2 p-8 text-center border-2 border-ink-base shadow-[0_12px_24px_-10px_rgba(0,0,0,0.1)] outline outline-[3px] outline-ink-base outline-offset-[-6px]"
          style={{ borderRadius: "24px 48px 24px 48px/48px 24px 48px 24px" }}
        >
          {status === "loading" && (
            <div className="py-8 flex flex-col items-center gap-4">
              <div className="w-10 h-10 border-4 border-[var(--brand-red)] border-t-transparent rounded-full animate-spin" />
              <p className="font-bold text-[var(--ink-soft)] tracking-wider">جارٍ التحميل...</p>
            </div>
          )}

          {status === "ready" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="space-y-3">
                <h2 className="text-lg font-black text-[var(--ink-base)]">إثبات ملكية الحساب</h2>
                <p className="text-sm font-bold leading-relaxed text-[var(--ink-soft)] px-2">
                  لإتمام عملية التحقق، نحتاج إلى مطابقة رقم هاتفك المرتبط بحساب تلغرام مع الرقم الذي
                  أدخلته في الموقع.
                </p>
              </div>

              <button
                onClick={handleShareContact}
                className="w-full bg-[#0088cc] text-white py-4 font-black text-[16px] shadow-lg hover:brightness-110 active:scale-[0.98] transition-all outline outline-2 outline-white/20 outline-offset-[-4px] flex items-center justify-center gap-3 cursor-pointer"
                style={{ borderRadius: "32px 16px 32px 16px/16px 32px 16px 32px" }}
              >
                <span>مشاركة رقم الهاتف وإثبات الملكية</span>
              </button>

              {error && <p className="text-sm font-bold text-red-600">{error}</p>}

              <div className="pt-4 border-t border-line-2">
                <p className="text-[11px] text-[var(--ink-mute)] font-bold italic leading-tight">
                  * سيتم استخدام رقم الهاتف المرتبط بحساب تلغرام فقط لمقارنته بالرقم الذي أدخلته في
                  الموقع.
                </p>
              </div>
            </div>
          )}

          {status === "verifying" && (
            <div className="py-12 flex flex-col items-center gap-6">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto border-4 border-blue-500/20">
                <span className="text-3xl">📱</span>
              </div>
              <div className="space-y-2">
                <p className="font-black text-[var(--ink-base)] text-lg">جارٍ التحقق من الرقم</p>
                <p className="text-sm text-[var(--ink-soft)] font-bold">
                  بعد موافقتك على مشاركة الرقم، تتم مطابقته آلياً مع الرقم المسجل في الموقع.
                </p>
              </div>
            </div>
          )}

          {status === "verified" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 text-right">
              {/* Status Header */}
              <div className="bg-surface-3 rounded-2xl p-4 border border-line-2 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                    <span className="font-bold text-[var(--ink-base)] text-sm">Telegram مرتبط</span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-line-2 pt-3">
                  <div className="flex items-center gap-2">
                    {user?.phoneVerifiedAt ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-amber-500" />
                    )}
                    <span className="font-bold text-[var(--ink-base)] text-sm">رقم الهاتف</span>
                  </div>
                  <span
                    className={`text-xs font-bold ${user?.phoneVerifiedAt ? "text-green-600" : "text-amber-600"}`}
                  >
                    {user?.phoneVerifiedAt ? "موثق" : "غير موثق"}
                  </span>
                </div>

                <div className="flex items-center justify-between border-t border-line-2 pt-3">
                  <div className="flex items-center gap-2">
                    {user?.emailVerifiedAt ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-amber-500" />
                    )}
                    <span className="font-bold text-[var(--ink-base)] text-sm">
                      البريد الإلكتروني
                    </span>
                  </div>
                  <span
                    className={`text-xs font-bold ${user?.emailVerifiedAt ? "text-green-600" : "text-amber-600"}`}
                  >
                    {user?.emailVerifiedAt ? "موثق" : "غير موثق"}
                  </span>
                </div>

                <div className="flex items-center justify-between border-t border-line-2 pt-3">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-[var(--brand-red)]" />
                    <span className="font-bold text-[var(--ink-base)] text-sm">حالة الأمان</span>
                  </div>
                  <span className="text-xs font-bold text-[var(--brand-red)]">جيدة</span>
                </div>
              </div>

              {/* Navigation Grid */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => navigate({ to: "/telegram/account" })}
                  className="bg-surface-3 p-4 rounded-2xl border border-line-2 flex flex-col items-center gap-2 hover:bg-surface-4 active:scale-95 transition-all"
                >
                  <User className="w-6 h-6 text-[#0088cc]" />
                  <span className="font-bold text-[var(--ink-base)] text-sm">حسابي</span>
                </button>
                <button
                  onClick={() => navigate({ to: "/telegram/security" })}
                  className="bg-surface-3 p-4 rounded-2xl border border-line-2 flex flex-col items-center gap-2 hover:bg-surface-4 active:scale-95 transition-all"
                >
                  <Shield className="w-6 h-6 text-green-600" />
                  <span className="font-bold text-[var(--ink-base)] text-sm">الأمان</span>
                </button>
                <button
                  onClick={() => navigate({ to: "/telegram/notifications" })}
                  className="bg-surface-3 p-4 rounded-2xl border border-line-2 flex flex-col items-center gap-2 hover:bg-surface-4 active:scale-95 transition-all"
                >
                  <Bell className="w-6 h-6 text-amber-500" />
                  <span className="font-bold text-[var(--ink-base)] text-sm">الإشعارات</span>
                </button>
                <button
                  onClick={() => navigate({ to: "/telegram/contests" })}
                  className="bg-surface-3 p-4 rounded-2xl border border-line-2 flex flex-col items-center gap-2 hover:bg-surface-4 active:scale-95 transition-all"
                >
                  <Trophy className="w-6 h-6 text-purple-500" />
                  <span className="font-bold text-[var(--ink-base)] text-sm">المسابقات</span>
                </button>
                <button
                  onClick={() => navigate({ to: "/telegram/referrals" })}
                  className="bg-surface-3 p-4 rounded-2xl border border-line-2 flex flex-col items-center gap-2 hover:bg-surface-4 active:scale-95 transition-all col-span-2"
                >
                  <Users className="w-6 h-6 text-indigo-500" />
                  <span className="font-bold text-[var(--ink-base)] text-sm">الإحالات</span>
                </button>
              </div>

              <button
                onClick={() => (window as any).Telegram?.WebApp?.close()}
                className="w-full bg-surface-3 text-[var(--ink-base)] py-4 rounded-[20px] font-black border-2 border-line-2 shadow-sm cursor-pointer flex items-center justify-center gap-2 mt-4"
              >
                <LogOut className="w-5 h-5" />
                <span>إغلاق التطبيق</span>
              </button>
            </div>
          )}

          {status === "failed" && (
            <div className="py-8 space-y-6">
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto border-4 border-red-500/20">
                <span className="text-3xl">⚠️</span>
              </div>
              <p className="text-red-600 font-black text-lg leading-tight">
                {error === "Phone mismatch"
                  ? "رقم الهاتف المرتبط بحساب تلغرام لا يطابق الرقم الذي أدخلته."
                  : error || "حدث خطأ غير متوقع"}
              </p>
              <button
                onClick={() => window.location.reload()}
                className="text-sm font-bold text-[var(--ink-soft)] underline underline-offset-4"
              >
                إعادة المحاولة
              </button>
            </div>
          )}
        </div>

        {/* Branding Footer */}
        <div className="mt-auto py-10 opacity-40">
          <p className="text-[10px] text-[var(--ink-mute)] font-black text-center uppercase tracking-[0.3em]">
            Bananto Platform
          </p>
        </div>
      </main>
    </div>
  );
}
