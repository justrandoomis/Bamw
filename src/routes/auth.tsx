import { tr } from "@/i18n";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AtSign, Cake, Mail } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

import {
  AlternativeLogins,
  BoyFaceIcon,
  CardWrapper,
  DEFAULT_DIAL,
  ErrorMsg,
  FieldDecorations,
  InputField,
  PasswordField,
  PhoneField,
  SkipButton,
  SubmitButton,
  calculateProgress,
} from "@/components/auth/AuthPieces";
import OtpBoxes from "@/components/auth/OtpBoxes";
import TelegramLinkPrompt from "@/components/auth/TelegramLinkPrompt";
import { ASSET_BASE_URL } from "@/config/publicAssets";

import { authPageAction } from "@/lib/authRedirect";
import { useAuth } from "@/hooks/useAuth";
import type { OtpChannel } from "@/lib/otp.server";
import { api } from "@/lib/api";
import { AVATAR_GALLERY } from "@/lib/avatars";
import { GAME_GENRES } from "@/lib/genres";
import { isPlaceholderEmail, normalizePhone } from "@/lib/phone";
import { playSound } from "@/utils/audio";

const patternAsset = { url: `${ASSET_BASE_URL}/Images/Ui/Auth%20background%20.webp` };
const mascotAsset = { url: `${ASSET_BASE_URL}/Images/Ui/Logo.webp` };

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): { error?: string } => {
    const error = search["error"];
    return typeof error === "string" ? { error: error.slice(0, 80) } : {};
  },
  head: () => ({
    meta: [
      { title: "تسجيل الدخول — بنانا ستور" },
      {
        name: "description",
        content:
          "سجّل الدخول برقم هاتفك أو بريدك، أو أنشئ حساباً موثقاً عبر واتساب لمتابعة طلباتك.",
      },
      { property: "og:title", content: "تسجيل الدخول — بنانا ستور" },
      {
        property: "og:description",
        content: "حسابك يحفظ طلباتك، محادثاتك، مفضلتك وإعداداتك في بنانا ستور.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  google_not_configured:
    "تسجيل Google غير مهيأ على الخادم حالياً. راجع إعدادات Google في Cloudflare ثم حاول مجدداً.",
  apple_not_configured: "تسجيل Apple غير مهيأ على الخادم حالياً.",
  auth_runtime_not_configured: "إعداد جلسات الحساب غير مكتمل على الخادم حالياً.",
  invalid_state: "انتهت صلاحية محاولة تسجيل الدخول. ابدأ المحاولة من جديد.",
  access_denied: "أُلغيت محاولة تسجيل الدخول من مزود الحساب.",
  oauth_start_failed: "تعذر بدء تسجيل الدخول الخارجي. حاول مجدداً بعد قليل.",
  oauth_failed:
    "تعذر إكمال تسجيل الدخول الخارجي. يرجى المتابعة لربط رقم الهاتف أو المراجعة لاحقاً.",
};

export function authErrorMessage(code?: string): string | undefined {
  if (!code) return undefined;
  return AUTH_ERROR_MESSAGES[code] ?? "تعذر إكمال تسجيل الدخول الخارجي. حاول مجدداً.";
}

type View =
  | "signin"
  | "signup"
  | "forgot"
  | "otp"
  | "reset_password"
  | "phone_setup"
  | "profile_setup"
  | "genres_setup";

type Mode = "signup" | "reset" | "verify";

interface AuthData {
  phone?: string;
  password?: string;
  mode?: Mode;
  name?: string;
  /**
   * Server copy shown above the code boxes. Account recovery answers neutrally
   * so it cannot be used to probe which numbers are registered, which means the
   * OTP screen must not assert that a message was sent.
   */
  notice?: string;
  /** true only when the server actually dispatched a message. */
  delivered?: boolean;
}

const cardMotion = {
  enter: (direction: number) => ({
    x: direction > 0 ? 1000 : -1000,
    opacity: 0,
    rotateY: direction > 0 ? 45 : -45,
    scale: 0.8,
  }),
  center: { zIndex: 1, x: 0, opacity: 1, rotateY: 0, scale: 1 },
  exit: (direction: number) => ({
    zIndex: 0,
    x: direction < 0 ? 1000 : -1000,
    opacity: 0,
    rotateY: direction < 0 ? 45 : -45,
    scale: 0.8,
  }),
};

const transition = { type: "spring" as const, stiffness: 300, damping: 30 };

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { user, isLoading, isFetching } = useAuth();
  const [view, setView] = useState<View>("signin");
  const [direction, setDirection] = useState(1);
  const [authData, setAuthData] = useState<AuthData>({});
  const [channel, setChannel] = useState<OtpChannel>("telegram");
  const [isNewRegistration, setIsNewRegistration] = useState(false);
  // Safety valve: never keep the visitor on the session gate forever.
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaitedTooLong(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  // A signed-in visitor never has to fill this form again — the session cookie
  // lasts 30 days. Accounts without a verified number finish that step first.
  useEffect(() => {
    const action = authPageAction({ user, isLoading, isFetching }, { view, isNewRegistration });
    if (action.type === "view") setView(action.view);
    if (action.type === "redirect") void navigate({ to: action.to, replace: true });
  }, [user, isLoading, isFetching, navigate, isNewRegistration, view]);

  const go = (next: View, data?: AuthData) => {
    setDirection((previous) => (previous === 1 ? -1 : 1));
    if (data) setAuthData(data);
    setView(next);
    playSound("klick", 0.4);
  };

  const shared = {
    onNavigate: go,
    authData,
    setIsNewRegistration,
    channel,
    setChannel,
    externalError: authErrorMessage(search.error),
  };

  const showGate =
    isLoading &&
    !user &&
    !waitedTooLong &&
    (view === "signin" || view === "profile_setup" || view === "genres_setup");

  if (showGate) {
    return (
      <div className="relative min-h-screen w-full grid place-items-center bg-transparent">
        <div
          className="absolute inset-0 z-0 opacity-20"
          style={{
            backgroundImage: `url(${patternAsset.url})`,
            backgroundSize: "600px",
            backgroundPosition: "center",
            backgroundRepeat: "repeat",
          }}
        />
        <div className="relative z-10 flex flex-col items-center gap-6">
          <div className="w-16 h-16 rounded-3xl bg-transparent flex items-center justify-center border-4 border-[var(--brand-red)]">
            <div className="w-8 h-8 rounded-full border-4 border-[var(--brand-red)] border-t-transparent animate-spin" />
          </div>
          <p className="text-sm font-black text-[var(--ink-base)] tracking-widest uppercase">
            {view === "signin" ? tr("جارٍ التحقق من الجلسة…") : tr("جارٍ تحميل الملف الشخصي…")}
          </p>
        </div>
      </div>
    );
  }

  const cards: Record<View, React.ReactNode> = {
    signin: <SignInCard {...shared} />,
    signup: <SignUpCard {...shared} />,
    forgot: <ForgotPasswordCard {...shared} />,
    otp: <OtpCard {...shared} />,
    reset_password: <ResetPasswordCard {...shared} />,
    phone_setup: <PhoneRequiredCard {...shared} />,
    profile_setup: <ProfileSetupCard {...shared} />,
    genres_setup: <GenresSetupCard {...shared} />,
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `url(${patternAsset.url})`,
          backgroundSize: "600px",
          backgroundPosition: "center",
          backgroundRepeat: "repeat",
        }}
      />
      <div className="absolute inset-0 z-10 flex items-center justify-center overflow-hidden">
        <AnimatePresence custom={direction} mode="wait">
          <motion.div
            key={view}
            custom={direction}
            variants={cardMotion}
            initial="enter"
            animate="center"
            exit="exit"
            transition={transition}
            className="flex h-full w-full justify-center overflow-x-hidden overflow-y-auto px-4 pt-[clamp(3rem,10vw,4rem)] pb-8 sm:px-8 sm:py-10"
          >
            {cards[view]}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

interface CardProps {
  onNavigate: (view: View, data?: AuthData) => void;
  authData: AuthData;
  setIsNewRegistration: (value: boolean) => void;
  channel: OtpChannel;
  setChannel: (value: OtpChannel) => void;
  externalError: string | undefined;
}

/* ------------------------------- sign in -------------------------------- */

function SignInCard({ onNavigate, externalError }: CardProps) {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(externalError);
  const [hint, setHint] = useState<string | undefined>(undefined);

  useEffect(() => {
    setError(externalError);
    setHint(undefined);
  }, [externalError]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    if (!identifier.trim()) {
      setError("أدخل اسم المستخدم أو رقم الهاتف أو البريد أو رقم العضوية");
      return;
    }
    if (!password.trim()) {
      setError("يرجى إدخال كلمة المرور");
      return;
    }
    playSound("bumper_end", 0.6);
    // The shared session query performs the redirect once the cookie is verified.
    login.mutate(
      { identifier: identifier.trim(), password },
      { onError: (err: Error) => setError(err.message) },
    );
  };

  return (
    <CardWrapper title={tr("تسجيل الدخول")} subtitle="MEMBER LOGIN" logo={mascotAsset.url}>
      <ErrorMsg error={error} hint={hint} />
      <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-6">
        <InputField
          label="معرّف الحساب"
          icon={<BoyFaceIcon />}
          type="text"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder={tr("اسم المستخدم أو الهاتف أو البريد أو رقم العضوية")}
          autoComplete="username"
          decoration={<FieldDecorations />}
        />
        <PasswordField
          label="كلمة المرور"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={tr("كلمة المرور")}
          autoComplete="current-password"
        />

        <SubmitButton
          isLoading={login.isPending}
          text="دخول"
          progress={calculateProgress({ text: identifier, password })}
        />
      </form>

      <AlternativeLogins
        onGoogleClick={() => {
          window.location.href = "/api/oauth/google?next=/auth";
        }}
      />

      <div className="mt-6 space-y-3 text-center sm:mt-6 sm:space-y-4">
        <button
          type="button"
          onClick={() => onNavigate("forgot")}
          className="block w-full text-[14px] font-[800] text-[var(--ink-soft)] transition-opacity hover:opacity-70 sm:text-[18px]"
        >
          {tr("هل نسيت كلمة المرور؟")}
        </button>
        <p className="pt-2 text-[14px] font-[800] text-[var(--ink-soft)] sm:text-[18px]">
          ليس لديك حساب؟{" "}
          <button
            type="button"
            onClick={() => onNavigate("signup")}
            className="font-[900] underline decoration-[2px] underline-offset-8 transition-opacity hover:opacity-70"
          >
            {tr("إنشاء حساب")}
          </button>
        </p>
      </div>
    </CardWrapper>
  );
}

/* ------------------------------- sign up -------------------------------- */

function SignUpCard({
  onNavigate,
  authData,
  setIsNewRegistration,
  channel,
  setChannel,
  externalError,
}: CardProps) {
  const { sendOtp } = useAuth();
  const [dial, setDial] = useState(DEFAULT_DIAL);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(externalError);
  /** The server said another channel can carry this code. Offer it explicitly. */
  const [fallbackOffered, setFallbackOffered] = useState(false);
  const [hint, setHint] = useState<string | undefined>(undefined);

  useEffect(() => {
    setError(externalError);
    setHint(undefined);
  }, [externalError]);
  const [needsLinking, setNeedsLinking] = useState<{
    error: string;
    botUrl: string;
    sessionId?: string;
    isVerification?: boolean;
  } | null>(null);

  const handleSubmit = (event: React.FormEvent | null, forceChannel?: OtpChannel) => {
    event?.preventDefault();
    setError(undefined);
    setHint(undefined);
    const normalized = normalizePhone(phone, dial);
    if (!normalized) {
      setError("يرجى إدخال رقم هاتف صحيح لإرسال رمز التحقق");
      return;
    }
    if (password.length < 8 || password.length > 128) {
      setError("يرجى إدخال كلمة مرور من 8 إلى 128 حرفاً");
      return;
    }
    playSound("bumper_end", 0.6);

    const targetChannel = forceChannel || channel;

    sendOtp.mutate(
      { phone: normalized, purpose: "signup", channel: targetChannel },
      {
        onSuccess: () => {
          setNeedsLinking(null);
          onNavigate("otp", { phone: normalized, password, mode: "signup" });
        },
        onError: (err: any) => {
          if (err.needsLinking) {
            const botUsername = (window as any).VITE_TELEGRAM_BOT_USERNAME || "Bananto_store_bot";
            const sessionId = err.sessionId || err.linkToken;
            setNeedsLinking({
              error: err.message,
              botUrl:
                err.botUrl ||
                `https://t.me/${botUsername}?start=${encodeURIComponent(sessionId || "")}`,
              sessionId: sessionId,
              isVerification: !!err.sessionId,
            });
          } else {
            setError(err.message);
            setHint(err.hint);
            /*
              A failure the server says another channel can carry.

              The two channel buttons sit on this card, and a customer whose
              WhatsApp code never arrives was told «حاول لاحقاً» with the
              working channel one tap away and unmentioned. Selecting it for
              them is not enough on its own — it must be visible that the
              choice moved — so the button below says what will happen.
            */
            if (err.fallbackChannel === "telegram") {
              setChannel("telegram");
              setFallbackOffered(true);
            }
          }
        },
      },
    );
  };

  return (
    <CardWrapper title={tr("إنشاء حساب جديد")} subtitle="NEW ACCOUNT" logo={mascotAsset.url}>
      <ErrorMsg error={error} hint={hint} />

      {error && fallbackOffered ? (
        <button
          type="button"
          onClick={() => {
            setError(undefined);
            setHint(undefined);
            setFallbackOffered(false);
            handleSubmit(null, "telegram");
          }}
          className="mb-4 w-full rounded-2xl border-2 border-ink-base bg-surface-2 px-4 py-3 text-[14px] font-black text-ink-base transition-transform active:scale-95"
        >
          {tr("إرسال الرمز عبر تلغرام بدلاً من ذلك")}
        </button>
      ) : null}

      {needsLinking ? (
        <div className="space-y-6">
          <TelegramLinkPrompt
            message={needsLinking.error}
            linkUrl={needsLinking.botUrl}
            token={needsLinking.sessionId}
            onVerified={() => {
              setNeedsLinking(null);
              handleSubmit(null, "telegram");
            }}
            onRetry={() => {
              setNeedsLinking(null);
              handleSubmit(null, "telegram");
            }}
          />

          <div className="px-2">
            <button
              type="button"
              onClick={() => {
                setNeedsLinking(null);
                playSound("klick", 0.4);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--ink-soft)]/30 py-3 text-[14px] font-[800] text-[var(--ink-soft)] hover:bg-[var(--ink-soft)]/5 sm:text-[16px]"
            >
              <span>{tr("تراجع لتعديل البيانات")}</span>
            </button>
          </div>
        </div>
      ) : null}

      {/* Lock fields when Telegram verification is active to prevent conflicts */}
      <form onSubmit={(e) => handleSubmit(e)} className="space-y-3 sm:space-y-6">
        <PhoneField
          dial={dial}
          onDialChange={setDial}
          value={phone}
          onChange={setPhone}
          disabled={!!needsLinking}
          decoration={<FieldDecorations />}
        />
        <PasswordField
          label="إنشاء كلمة المرور"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={!!needsLinking}
          placeholder={tr("إنشاء كلمة المرور")}
          autoComplete="new-password"
        />

        <div className="grid grid-cols-2 gap-4 mb-8">
          <button
            type="button"
            onClick={() => {
              // The error on screen was about the other channel.
              setError(undefined);
              setHint(undefined);
              setFallbackOffered(false);
              setChannel("whatsapp");
            }}
            disabled={!!needsLinking}
            className={`relative flex flex-col items-center justify-center p-5 border-2 transition-all duration-300 outline outline-[3px] outline-offset-[-6px] ${
              channel === "whatsapp"
                ? "border-ink-base bg-surface-2 shadow-[0_12px_24px_-10px_rgba(0,0,0,0.1)] scale-[1.02] outline-ink-base"
                : "border-ink-soft/20 bg-surface-2 opacity-60 hover:opacity-100 hover:border-ink-soft/40 outline-transparent"
            } ${needsLinking ? "cursor-not-allowed" : ""}`}
            style={{ borderRadius: "28px 12px 28px 12px/12px 28px 12px 28px" }}
          >
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={`text-[15px] font-black ${channel === "whatsapp" ? "text-ink-base" : "text-ink-soft"}`}
              >
                WhatsApp
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setError(undefined);
              setHint(undefined);
              setFallbackOffered(false);
              setChannel("telegram");
            }}
            disabled={!!needsLinking}
            className={`relative flex flex-col items-center justify-center p-5 border-2 transition-all duration-300 outline outline-[3px] outline-offset-[-6px] ${
              channel === "telegram"
                ? "border-ink-base bg-surface-2 shadow-[0_12px_24px_-10px_rgba(0,0,0,0.1)] scale-[1.02] outline-ink-base"
                : "border-ink-soft/20 bg-surface-2 opacity-60 hover:opacity-100 hover:border-ink-soft/40 outline-transparent"
            } ${needsLinking ? "cursor-not-allowed" : ""}`}
            style={{ borderRadius: "12px 28px 12px 28px/28px 12px 28px 12px" }}
          >
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={`text-[15px] font-black ${channel === "telegram" ? "text-ink-base" : "text-ink-soft"}`}
              >
                Telegram
              </span>
            </div>
          </button>
        </div>

        <SubmitButton
          isLoading={sendOtp.isPending}
          text="تأكيد الحساب"
          progress={calculateProgress({ phone, dial, password })}
        />
      </form>

      <AlternativeLogins
        onGoogleClick={() => {
          window.location.href = "/api/oauth/google?next=/auth";
        }}
      />

      <div className="mt-6 text-center sm:mt-6">
        <p className="pt-2 text-[14px] font-[800] text-[var(--ink-soft)] sm:text-[18px]">
          لديك حساب بالفعل؟{" "}
          <button
            type="button"
            onClick={() => onNavigate("signin")}
            className="font-[900] underline decoration-[2px] underline-offset-8 transition-opacity hover:opacity-70"
          >
            {tr("تسجيل الدخول")}
          </button>
        </p>
      </div>
    </CardWrapper>
  );
}

/**
 * Recovery answers deliberately never say whether the account exists, so the
 * server sends a notice plus generic next steps instead of a delivery claim.
 */
function recoveryNotice(res: { notice?: string; hint?: string }): string {
  return [res.notice, res.hint].filter(Boolean).join(" ");
}

/* ---------------------------- forgot password --------------------------- */

function ForgotPasswordCard({
  onNavigate,
  authData,
  setIsNewRegistration,
  channel,
  setChannel,
  externalError,
}: CardProps) {
  const { sendOtp } = useAuth();
  const [dial, setDial] = useState(DEFAULT_DIAL);
  const [identifier, setIdentifier] = useState("");
  const [mode, setMode] = useState<"phone" | "member">("phone");
  const [memberId, setMemberId] = useState("");
  const [error, setError] = useState<string>();
  const [hint, setHint] = useState<string>();
  const [needsLinking, setNeedsLinking] = useState<{
    error: string;
    botUrl: string;
    sessionId?: string;
    isVerification?: boolean;
  } | null>(null);

  const handleSubmit = (event: React.FormEvent | null, forceChannel?: OtpChannel) => {
    event?.preventDefault();
    setError(undefined);
    setHint(undefined);
    setNeedsLinking(null);

    const targetChannel = forceChannel || channel;

    if (mode === "member") {
      const digits = memberId.replace(/\D/g, "");
      if (digits.length < 4) {
        setError("أدخل رقم العضوية الظاهر في بوت تلغرام");
        return;
      }
      playSound("bumper_end", 0.6);
      const key = `member:${digits}`;
      sendOtp.mutate(
        { phone: key, purpose: "reset", channel: targetChannel },
        {
          onSuccess: (res) =>
            onNavigate("otp", {
              phone: key,
              mode: "reset",
              delivered: res.delivered !== false,
              ...(recoveryNotice(res) ? { notice: recoveryNotice(res) } : {}),
            }),
          onError: (err: any) => {
            if (err.needsLinking) {
              const botUsername = (window as any).VITE_TELEGRAM_BOT_USERNAME || "Bananto_store_bot";
              const sessionId = err.sessionId || err.linkToken;
              setNeedsLinking({
                error: err.message,
                botUrl:
                  err.botUrl ||
                  `https://t.me/${botUsername}?start=${encodeURIComponent(sessionId || "")}`,
                sessionId: sessionId,
                isVerification: !!err.sessionId,
              });
            } else {
              setError(err.message);
              setHint(err.hint);
            }
          },
        },
      );
      return;
    }

    const normalized = normalizePhone(identifier, dial);
    if (!normalized) {
      setError("أدخل رقم الهاتف الموثّق لاستلام الرمز");
      return;
    }
    playSound("bumper_end", 0.6);
    sendOtp.mutate(
      { phone: normalized, purpose: "reset", channel: targetChannel },
      {
        onSuccess: (res) =>
          onNavigate("otp", {
            phone: normalized,
            mode: "reset",
            delivered: res.delivered !== false,
            ...(recoveryNotice(res) ? { notice: recoveryNotice(res) } : {}),
          }),
        onError: (err: any) => {
          if (err.needsLinking) {
            const botUsername = (window as any).VITE_TELEGRAM_BOT_USERNAME || "Bananto_store_bot";
            const sessionId = err.sessionId || err.linkToken;
            setNeedsLinking({
              error: err.message,
              botUrl:
                err.botUrl ||
                `https://t.me/${botUsername}?start=${encodeURIComponent(sessionId || "")}`,
              sessionId: sessionId,
              isVerification: !!err.sessionId,
            });
          } else {
            setError(err.message);
            setHint(err.hint);
          }
        },
      },
    );
  };

  return (
    <CardWrapper title={tr("استعادة كلمة المرور")} subtitle="FORGOT PASSWORD">
      <ErrorMsg error={error} hint={hint} />
      <div className="mb-6 text-center text-[14px] font-[600] text-[var(--ink-soft)] sm:text-[16px]">
        {tr("سيتم إرسال رمز التحقق عبر القناة المختارة.")}
      </div>

      {needsLinking ? (
        <div className="space-y-6">
          <TelegramLinkPrompt
            message={needsLinking.error}
            linkUrl={needsLinking.botUrl}
            token={needsLinking.sessionId}
            onVerified={() => {
              setNeedsLinking(null);
              handleSubmit(null, "telegram");
            }}
            onRetry={() => {
              setNeedsLinking(null);
              handleSubmit(null, "telegram");
            }}
          />

          <div className="px-2">
            <button
              type="button"
              onClick={() => {
                setNeedsLinking(null);
                playSound("klick", 0.4);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--ink-soft)]/30 py-3 text-[14px] font-[800] text-[var(--ink-soft)] hover:bg-[var(--ink-soft)]/5 sm:text-[16px]"
            >
              <span>{tr("تراجع لتعديل البيانات")}</span>
            </button>
          </div>
        </div>
      ) : null}

      <div
        className={`space-y-4 ${needsLinking?.isVerification ? "opacity-40 pointer-events-none" : ""}`}
      >
        <div className="mb-4 flex gap-2">
          {(["phone", "member"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setMode(value);
                setError(undefined);
              }}
              className={`flex-1 rounded-xl px-3 py-2 text-[13px] font-[800] transition-colors ${
                mode === value
                  ? "bg-[var(--ink)] text-[var(--paper)]"
                  : "bg-[var(--ink)]/10 text-[var(--ink-soft)]"
              }`}
            >
              {value === "phone" ? tr("رقم الهاتف") : tr("رقم العضوية")}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-6">
          {mode === "phone" ? (
            <PhoneField
              label="رقم الهاتف"
              dial={dial}
              onDialChange={setDial}
              value={identifier}
              onChange={setIdentifier}
            />
          ) : (
            <div className="space-y-2">
              <InputField
                label="رقم العضوية"
                icon={
                  <div className="flex h-[20px] w-[20px] items-center justify-center rounded-full bg-[var(--ink-base)] text-[10px] font-black text-[var(--paper)] sm:h-[26px] sm:w-[26px] sm:text-[13px]">
                    ID
                  </div>
                }
                type="text"
                inputMode="numeric"
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                placeholder="123456"
                decoration={<FieldDecorations />}
              />
              <p className="px-2 text-[12px] font-[600] text-[var(--ink-soft)]">
                {tr("سيصلك الرمز عبر تلغرام المرتبط بحسابك، أو عبر واتساب إن لم يكن مرتبطاً.")}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 mb-4">
            <button
              type="button"
              onClick={() => setChannel("whatsapp")}
              disabled={!!needsLinking}
              className={`relative flex flex-col items-center justify-center p-4 border-2 transition-all duration-300 outline outline-[3px] outline-offset-[-6px] ${
                channel === "whatsapp"
                  ? "border-ink-base bg-surface-2 shadow-[0_12px_24px_-10px_rgba(0,0,0,0.1)] scale-[1.02] outline-ink-base"
                  : "border-ink-soft/20 bg-surface-2 opacity-60 hover:opacity-100 hover:border-ink-soft/40 outline-transparent"
              } ${needsLinking ? "cursor-not-allowed" : ""}`}
              style={{ borderRadius: "28px 12px 28px 12px/12px 28px 12px 28px" }}
            >
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={`text-[15px] font-black ${channel === "whatsapp" ? "text-ink-base" : "text-ink-soft"}`}
                >
                  WhatsApp
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setChannel("telegram")}
              disabled={!!needsLinking}
              className={`relative flex flex-col items-center justify-center p-4 border-2 transition-all duration-300 outline outline-[3px] outline-offset-[-6px] ${
                channel === "telegram"
                  ? "border-ink-base bg-surface-2 shadow-[0_12px_24px_-10px_rgba(0,0,0,0.1)] scale-[1.02] outline-ink-base"
                  : "border-ink-soft/20 bg-surface-2 opacity-60 hover:opacity-100 hover:border-ink-soft/40 outline-transparent"
              }`}
              style={{ borderRadius: "12px 28px 12px 28px/28px 12px 28px 12px" }}
            >
              <span
                className={`text-[15px] font-black ${channel === "telegram" ? "text-ink-base" : "text-ink-soft"}`}
              >
                Telegram
              </span>
            </button>
          </div>

          <SubmitButton
            isLoading={sendOtp.isPending}
            text="إرسال الرمز"
            progress={
              mode === "phone"
                ? calculateProgress({ phone: identifier, dial })
                : calculateProgress({ memberNo: memberId })
            }
          />
        </form>
      </div>

      <div className="mt-6 text-center sm:mt-6">
        <button
          type="button"
          onClick={() => onNavigate("signin")}
          className="block w-full text-[14px] font-[800] text-[var(--ink-soft)] underline decoration-[2px] underline-offset-8 transition-opacity hover:opacity-70 sm:text-[18px]"
        >
          {tr("العودة لتسجيل الدخول")}
        </button>
      </div>
    </CardWrapper>
  );
}

/* --------------------------------- otp ---------------------------------- */

function OtpCard({ onNavigate, authData, setIsNewRegistration, channel, setChannel }: CardProps) {
  const { sendOtp, verifyOtp } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [hint, setHint] = useState<string>();
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const resend = (targetChannel?: OtpChannel) => {
    if (countdown > 0 || !authData.phone) return;
    const ch = targetChannel || channel || "whatsapp";
    setError(undefined);
    setHint(undefined);
    playSound("bumper_end", 0.6);
    sendOtp.mutate(
      { phone: authData.phone, purpose: authData.mode ?? "signup", channel: ch },
      {
        onSuccess: () => {
          setChannel(ch);
          setCountdown(60);
        },
        onError: (err: any) => {
          setError(err.message);
          setHint(err.hint);
        },
      },
    );
  };

  const resendViaTelegram = () => {
    resend("telegram");
  };

  const resendViaWhatsapp = () => {
    resend("whatsapp");
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setHint(undefined);
    if (code.length < 6) {
      setError("يرجى إدخال رمز التحقق المكون من 6 أرقام بشكل صحيح");
      return;
    }
    if (!authData.phone) {
      onNavigate("signin");
      return;
    }
    playSound("bumper_end", 0.6);

    // A reset only unlocks the "new password" card; the code is spent there.
    if (authData.mode === "reset") {
      onNavigate("reset_password", { ...authData, name: code });
      return;
    }

    verifyOtp.mutate(
      {
        phone: authData.phone,
        code,
        purpose: authData.mode ?? "signup",
        ...(authData.password ? { password: authData.password } : {}),
      },
      {
        onSuccess: () => {
          if (authData.mode === "signup") {
            setIsNewRegistration(true);
          }
        },
        onError: (err: any) => {
          setError(err.message);
          setHint(err.hint);
        },
      },
    );
  };

  return (
    <CardWrapper title={tr("رمز التحقق")} subtitle="VERIFICATION">
      <ErrorMsg error={error} hint={hint} />
      {authData.notice ? (
        <div className="mb-4 rounded-2xl border-2 border-[var(--ink-soft)]/30 bg-[var(--ink-soft)]/5 px-4 py-3 text-center text-[13px] font-[700] leading-relaxed text-[var(--ink-soft)] sm:text-[15px]">
          {authData.notice}
        </div>
      ) : null}
      <div className="mb-2 text-center text-[14px] font-[600] text-[var(--ink-soft)] sm:text-[16px]">
        {authData.delivered === false
          ? "أدخل رمز التحقق إن وصلك، أو أعد الإرسال إذا لم يصل."
          : `الرجاء إدخال رمز التحقق الذي أُرسل عبر ${channel === "telegram" ? "تلغرام" : "واتساب"} إلى `}
        {authData.delivered === false ? null : (
          <span className="font-[900]" dir="ltr">
            {authData.phone ?? "هاتفك"}
          </span>
        )}
      </div>
      <div className="mb-6 text-center text-[12px] font-[500] text-emerald-600 flex flex-col items-center gap-2">
        <span className="text-[var(--ink-soft)]/70">
          {channel === "telegram"
            ? "تم إرسال رمز التحقق عبر تلغرام."
            : "تم إرسال رمز التحقق عبر واتساب."}
        </span>
        <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
          <button
            type="button"
            disabled={countdown > 0 || sendOtp.isPending}
            onClick={resendViaWhatsapp}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#25D366] text-white rounded-xl text-[13px] font-bold shadow-sm hover:scale-105 transition-transform disabled:opacity-50 disabled:hover:scale-100"
          >
            إعادة الإرسال عبر WhatsApp
          </button>
          <button
            type="button"
            disabled={countdown > 0 || sendOtp.isPending}
            onClick={resendViaTelegram}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#229ED9] text-white rounded-xl text-[13px] font-bold shadow-sm hover:scale-105 transition-transform disabled:opacity-50 disabled:hover:scale-100"
          >
            إرسال عبر Telegram
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <OtpBoxes code={code} setCode={setCode} />

        <div className="mb-4 text-center">
          {countdown > 0 ? (
            <p className="text-[14px] font-[700] text-[var(--ink-soft)]/70 sm:text-[16px]">
              إعادة إرسال الرمز بعد{" "}
              <span className="font-[900] text-[var(--ink-soft)]">{countdown}</span> {tr("ثانية")}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => resend()}
              className="text-[14px] font-[900] text-[var(--ink-soft)] underline decoration-[2px] underline-offset-4 transition-opacity hover:opacity-70 sm:text-[16px]"
            >
              {tr("إعادة إرسال الرمز")}
            </button>
          )}
        </div>

        <SubmitButton
          isLoading={verifyOtp.isPending}
          text="تحقق"
          progress={calculateProgress({ otp: code })}
        />
      </form>

      <div className="mt-6 text-center sm:mt-6">
        <button
          type="button"
          onClick={() => onNavigate("signin")}
          className="block w-full text-[14px] font-[800] text-[var(--ink-soft)] underline decoration-[2px] underline-offset-8 transition-opacity hover:opacity-70 sm:text-[18px]"
        >
          {tr("إلغاء")}
        </button>
      </div>
    </CardWrapper>
  );
}

/* ---------------------------- reset password ---------------------------- */

function ResetPasswordCard({
  onNavigate,
  authData,
  setIsNewRegistration,
  channel,
  setChannel,
  externalError,
}: CardProps) {
  const { verifyOtp } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [hint, setHint] = useState<string>();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setHint(undefined);
    if (password.length < 8 || password.length > 128) {
      setError("يرجى إدخال كلمة مرور من 8 إلى 128 حرفاً");
      return;
    }
    if (!authData.phone || !authData.name) {
      onNavigate("signin");
      return;
    }
    playSound("bumper_end", 0.6);
    verifyOtp.mutate(
      { phone: authData.phone, code: authData.name, purpose: "reset", password },
      {
        onError: (err: any) => {
          setError(err.message);
          setHint(err.hint);
        },
      },
    );
  };

  return (
    <CardWrapper title={tr("كلمة مرور جديدة")} subtitle="NEW PASSWORD">
      <ErrorMsg error={error} hint={hint} />
      <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-6">
        <PasswordField
          label="كلمة المرور الجديدة"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={tr("إنشاء كلمة المرور")}
          autoComplete="new-password"
        />

        <SubmitButton
          isLoading={verifyOtp.isPending}
          text="حفظ وتسجيل الدخول"
          progress={calculateProgress({ password })}
        />
      </form>
    </CardWrapper>
  );
}

/* --------------------------- phone verification ------------------------- */

function PhoneRequiredCard({
  onNavigate,
  authData,
  setIsNewRegistration,
  channel,
  setChannel,
}: CardProps) {
  const { sendOtp, user, logout } = useAuth();
  const [dial, setDial] = useState(DEFAULT_DIAL);
  const [phone, setPhone] = useState(user?.phone ?? "");

  const [error, setError] = useState<string>();
  const [hint, setHint] = useState<string>();
  const [needsLinking, setNeedsLinking] = useState<{
    error: string;
    linkUrl: string;
    linkToken?: string;
  } | null>(null);

  const handleSubmit = (event: React.FormEvent | null, forceChannel?: OtpChannel) => {
    event?.preventDefault();
    setError(undefined);
    setHint(undefined);
    setNeedsLinking(null);

    const targetChannel = forceChannel || channel;
    const normalized = normalizePhone(phone, dial);
    if (!normalized) {
      setError("يرجى إدخال رقم هاتف صحيح للمتابعة");
      return;
    }
    playSound("bumper_end", 0.6);
    sendOtp.mutate(
      { phone: normalized, purpose: "verify", channel: targetChannel },
      {
        onSuccess: () => onNavigate("otp", { phone: normalized, mode: "verify" }),
        onError: (err: any) => {
          if (err.needsLinking) {
            setNeedsLinking({
              error: err.message,
              linkUrl:
                err.botUrl ||
                err.linkUrl ||
                `https://t.me/Bananto_store_bot?start=${encodeURIComponent(err.linkToken || err.sessionId || "")}`,
              linkToken: err.linkToken || err.sessionId,
            });
          } else {
            setError(err.message);
            setHint(err.hint);
          }
        },
      },
    );
  };

  return (
    <CardWrapper title={tr("توثيق الحساب")} subtitle="SECURE YOUR ACCOUNT">
      <ErrorMsg error={error} hint={hint} />

      {needsLinking && (
        <TelegramLinkPrompt
          message={needsLinking.error}
          linkUrl={needsLinking.linkUrl}
          {...(needsLinking.linkToken ? { token: needsLinking.linkToken } : {})}
          onVerified={() => {
            setNeedsLinking(null);
            handleSubmit(null, "telegram");
          }}
          onRetry={() => {
            setNeedsLinking(null);
            handleSubmit(null, "telegram");
          }}
        />
      )}

      <div className="mb-6 text-center text-[14px] font-[600] text-[var(--ink-soft)] sm:text-[16px]">
        {tr("لإتمام التسجيل، يرجى إدخال رقم هاتفك للتحقق عبر القناة المختارة")}
      </div>
      <form onSubmit={(e) => handleSubmit(e)} className="space-y-3 sm:space-y-6">
        <PhoneField
          label="رقم الهاتف"
          dial={dial}
          onDialChange={setDial}
          value={phone}
          onChange={setPhone}
        />

        <div className="grid grid-cols-2 gap-4 mb-4">
          <button
            type="button"
            onClick={() => setChannel("whatsapp")}
            disabled={!!needsLinking}
            className={`relative flex flex-col items-center justify-center p-4 border-2 transition-all duration-300 outline outline-[3px] outline-offset-[-6px] ${
              channel === "whatsapp"
                ? "border-ink-base bg-surface-2 shadow-[0_12px_24px_-10px_rgba(0,0,0,0.1)] scale-[1.02] outline-ink-base"
                : "border-ink-soft/20 bg-surface-2 opacity-60 hover:opacity-100 hover:border-ink-soft/40 outline-transparent"
            } ${needsLinking ? "cursor-not-allowed" : ""}`}
            style={{ borderRadius: "28px 12px 28px 12px/12px 28px 12px 28px" }}
          >
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={`text-[15px] font-black ${channel === "whatsapp" ? "text-ink-base" : "text-ink-soft"}`}
              >
                WhatsApp
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setChannel("telegram")}
            disabled={!!needsLinking}
            className={`relative flex flex-col items-center justify-center p-4 border-2 transition-all duration-300 outline outline-[3px] outline-offset-[-6px] ${
              channel === "telegram"
                ? "border-ink-base bg-surface-2 shadow-[0_12px_24px_-10px_rgba(0,0,0,0.1)] scale-[1.02] outline-ink-base"
                : "border-ink-soft/20 bg-surface-2 opacity-60 hover:opacity-100 hover:border-ink-soft/40 outline-transparent"
            }`}
            style={{ borderRadius: "12px 28px 12px 28px/28px 12px 28px 12px" }}
          >
            <span
              className={`text-[15px] font-black ${channel === "telegram" ? "text-ink-base" : "text-ink-soft"}`}
            >
              Telegram
            </span>
          </button>
        </div>

        <SubmitButton
          isLoading={sendOtp.isPending}
          text="إرسال الرمز"
          progress={calculateProgress({ phone, dial })}
        />
      </form>
      <div className="mt-6 text-center sm:mt-6">
        <button
          type="button"
          onClick={() => {
            logout.mutate();
            onNavigate("signin");
          }}
          className="block w-full text-[14px] font-[800] text-[var(--ink-soft)] underline decoration-[2px] underline-offset-8 transition-opacity hover:opacity-70 sm:text-[18px]"
        >
          {tr("العودة")}
        </button>
      </div>
    </CardWrapper>
  );
}

/* ----------------------- optional profile completion --------------------- */

function ProfileSetupCard({ onNavigate }: CardProps) {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [avatar, setAvatar] = useState(user?.avatar ?? "");
  const [gender, setGender] = useState<"male" | "female" | "unspecified">(
    user?.gender ?? "unspecified",
  );
  const [birthDate, setBirthDate] = useState(user?.birthDate ?? "");
  const [error, setError] = useState<string>();

  /** Empty fields stay empty on purpose — the server fills random defaults. */
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    playSound("bumper_end", 0.6);
    updateProfile.mutate(
      {
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(username.trim() ? { username: username.trim() } : {}),
        ...(avatar ? { avatar } : {}),
        ...(gender !== "unspecified" ? { gender } : {}),
        ...(birthDate ? { birthDate } : {}),
      },
      {
        onSuccess: () => onNavigate("genres_setup"),
        onError: (err: Error) => setError(err.message),
      },
    );
  };

  const pickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("تعذّر قراءة الصورة"));
      reader.readAsDataURL(file);
    });
    try {
      const { url } = await api.upload(dataUrl, "avatars");
      setAvatar(url);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <CardWrapper title={tr("أكمل ملفك (اختياري)")} subtitle="YOUR PROFILE">
      <ErrorMsg error={error} />
      <div className="mb-5 text-center text-[13px] font-[600] text-[var(--ink-soft)] sm:text-[15px]">
        {tr("كل الحقول اختيارية — ما تتركه فارغاً نملؤه لك تلقائياً (اسم ومعرّف وصورة عشوائية).")}
      </div>
      <form onSubmit={submit} className="space-y-3 sm:space-y-5">
        <InputField
          label="الاسم"
          icon={<BoyFaceIcon />}
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={tr("اسمك الظاهر")}
          decoration={<FieldDecorations />}
        />
        <InputField
          label="معرّف الحساب"
          icon={
            <AtSign className="h-[20px] w-[20px] text-[var(--gold-deep)] sm:h-[26px] sm:w-[26px]" />
          }
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="banan…"
          dir="ltr"
        />

        <div className="space-y-3 px-2 text-right">
          <label className="block pr-2 text-[15px] font-[900] text-[var(--ink-soft)] sm:text-[17px]">
            {tr("الصورة")}
          </label>
          <div className="flex flex-row-reverse flex-wrap gap-2">
            {AVATAR_GALLERY.map((src) => (
              <button
                key={src}
                type="button"
                onClick={() => setAvatar(src)}
                className={`h-12 w-12 overflow-hidden rounded-full border-[2px] transition-transform hover:scale-105 sm:h-14 sm:w-14 ${
                  avatar === src
                    ? "border-[var(--gold-deep)] ring-[3px] ring-[var(--gold)]"
                    : "border-[var(--ink-soft)]"
                }`}
              >
                <img src={src} alt="أفتار" className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
          <label className="inline-block cursor-pointer rounded-xl border-[2px] border-[var(--ink-soft)] bg-[var(--gold)]/60 px-3 py-1.5 text-[13px] font-[800] text-[var(--ink-soft)] sm:text-[15px]">
            {tr("رفع صورة من جهازي")}
            <input type="file" accept="image/*" className="hidden" onChange={pickFile} />
          </label>
        </div>

        <div className="space-y-3 px-2 text-right">
          <label className="block pr-2 text-[15px] font-[900] text-[var(--ink-soft)] sm:text-[17px]">
            {tr("الجنس")}
          </label>
          <div className="flex flex-row-reverse gap-2">
            {(
              [
                ["male", "ذكر"],
                ["female", "أنثى"],
                ["unspecified", "لم يحدد"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setGender(value)}
                className={`rounded-xl border-[2px] border-[var(--ink-soft)] px-3 py-1.5 text-[13px] font-[800] text-[var(--ink-soft)] sm:text-[15px] ${
                  gender === value ? "bg-[var(--gold)]" : "bg-[var(--page-3)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <InputField
          label="تاريخ الميلاد"
          icon={
            <Cake className="h-[20px] w-[20px] text-[var(--gold-deep)] sm:h-[26px] sm:w-[26px]" />
          }
          type="date"
          value={birthDate}
          onChange={(event) => setBirthDate(event.target.value)}
          placeholder=""
          dir="ltr"
        />

        <SubmitButton isLoading={updateProfile.isPending} text="متابعة" />
      </form>
      <SkipButton onClick={() => onNavigate("genres_setup")} />
    </CardWrapper>
  );
}

/* ------------------------- favourite genres step ------------------------- */

function GenresSetupCard(_props: CardProps) {
  const navigate = useNavigate();
  const { user, updateProfile } = useAuth();
  const [selected, setSelected] = useState<string[]>(user?.preferredGenres ?? []);
  const [error, setError] = useState<string>();

  const finish = (genres: string[]) => {
    playSound("bumper_end", 0.6);
    updateProfile.mutate(
      { preferredGenres: genres, profileCompleted: true },
      {
        onSuccess: () => void navigate({ to: "/", replace: true }),
        onError: (err: Error) => setError(err.message),
      },
    );
  };

  const toggle = (id: string) => {
    playSound("klick", 0.35);
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  return (
    <CardWrapper title={tr("تصنيفاتك المفضلة")} subtitle="YOUR TASTE">
      <ErrorMsg error={error} />
      <div className="mb-5 text-center text-[13px] font-[600] text-[var(--ink-soft)] sm:text-[15px]">
        {tr("اختر ما تحب ونقترح لك ألعاباً مشابهة في الواجهة — يمكنك تعديلها لاحقاً من التفضيلات.")}
      </div>
      <div className="mb-6 flex flex-row-reverse flex-wrap justify-center gap-2">
        {GAME_GENRES.map((genre) => (
          <button
            key={genre.id}
            type="button"
            onClick={() => toggle(genre.id)}
            className={`rounded-full border-[2px] border-[var(--ink-soft)] px-3 py-1.5 text-[13px] font-[800] text-[var(--ink-soft)] transition-transform hover:scale-105 sm:text-[15px] ${
              selected.includes(genre.id) ? "bg-[var(--gold)]" : "bg-[var(--page-3)]"
            }`}
          >
            {genre.label}
          </button>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          finish(selected);
        }}
      >
        <SubmitButton isLoading={updateProfile.isPending} text="حفظ والبدء" />
      </form>
      <SkipButton onClick={() => finish([])} text="تخطي والإعداد لاحقاً" />
    </CardWrapper>
  );
}
