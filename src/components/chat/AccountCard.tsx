import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Camera,
  Check,
  Clock,
  Copy,
  FileText,
  Gamepad2,
  KeyRound,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { normalizeAccountCard, isRenderableAccountCard } from "@/lib/account-cards";
import CodeValidity from "@/components/CodeValidity";
import { DELIVERY_OTP_TTL_MINUTES } from "@/lib/delivery-otp";

interface AccountCardProps {
  kind: string;
  body: Record<string, unknown> | null | undefined;
  /** "ar" (default) or "en" labels */
  locale?: "ar" | "en";
  /** visual tone */
  tone?: "default" | "admin";
  /**
   * The member's own delivery controls. Present only on the buyer's side of an
   * order conversation, where the next step after receiving an account is to
   * prove the sign-in and ask for the following one.
   */
  delivery?: {
    onAttachProof: (itemId: string, deliveryItemId?: string) => void | Promise<void>;
    onNext: (itemId: string, deliveryItemId?: string) => void | Promise<void>;
    /** True once this account's proof has been sent. */
    proofSent?: boolean;
    busy?: boolean;
  };
}

const LABELS = {
  ar: {
    credentials: "معلومات الحساب",
    verification: "كود التحقق",
    instructions: "التعليمات",
    accountUser: "اسم المستخدم",
    password: "كلمة المرور",
    code: "كود التحقق",
    copy: "نسخ",
    copied: "تم النسخ",
    show: "إظهار",
    hide: "إخفاء",
    validFor: "صالح لمدة 60 دقيقة",
  },
  en: {
    credentials: "Account details",
    verification: "Verification Code",
    instructions: "Instructions",
    accountUser: "Account user",
    password: "Password",
    code: "Verification Code",
    copy: "Copy",
    copied: "Copied",
    show: "Show",
    hide: "Hide",
    validFor: "Valid for 60 minutes",
  },
} as const;

function CopyField({
  label,
  value,
  masked = false,
  copyLabel,
  copiedLabel,
  mono = true,
}: {
  label: string;
  value: string;
  masked?: boolean;
  copyLabel: string;
  copiedLabel: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(!masked);

  const safeVal = String(value ?? "");
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(safeVal);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const repeatCount = Math.max(0, Math.min(safeVal.length || 6, 12));

  return (
    <div className="space-y-1 min-w-0">
      <span className="block text-[11px] font-semibold opacity-70">{label}</span>
      <div className="flex items-center gap-2 rounded-xl border border-current/15 bg-current/5 px-2.5 py-2 min-w-0">
        <span
          dir="ltr"
          className={`flex-1 min-w-0 truncate select-all text-[13px] font-semibold ${
            mono ? "font-mono" : ""
          }`}
        >
          {revealed ? safeVal : "•".repeat(repeatCount)}
        </span>
        {masked ? (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold opacity-80 hover:opacity-100 hover:bg-current/10 transition-colors"
          >
            {revealed ? LABELS.ar.hide : LABELS.ar.show}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCopy}
          aria-label={`${copyLabel} — ${label}`}
          className="shrink-0 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold hover:bg-current/10 transition-colors min-h-8"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{copied ? copiedLabel : copyLabel}</span>
        </button>
      </div>
    </div>
  );
}

export function VerificationOtpCard({
  code,
  title,
  expiresAt,
  expiresInMinutes = DELIVERY_OTP_TTL_MINUTES,
  locale = "ar",
}: {
  code: string;
  title?: string | null;
  /** Server-stamped instant the code dies. Preferred over any minute count. */
  expiresAt?: string | null | undefined;
  expiresInMinutes?: number;
  locale?: "ar" | "en";
}) {
  const [copied, setCopied] = useState(false);
  const isAr = locale === "ar";

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(isAr ? "تم نسخ كود التحقق" : "Verification code copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className="w-full max-w-[270px] sm:max-w-[290px] rounded-2xl border border-border/80 bg-[#FCF9F5] dark:bg-card text-foreground p-3.5 shadow-2xs space-y-2.5 transition-all text-right"
    >
      {/* 1. Header: Small Title */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-amber-600 dark:text-amber-500 shrink-0" />
          <span className="text-[13px] font-bold text-foreground">
            {isAr ? "كود التحقق" : "Verification Code"}
          </span>
        </div>
      </div>

      {/* 2. Secondary Game Name / Title */}
      {title ? (
        <div className="text-[11px] font-medium text-muted-foreground truncate" title={title}>
          {title}
        </div>
      ) : null}

      {/* 3. Code & Copy on the SAME line */}
      <div className="flex items-center justify-between gap-2 rounded-xl bg-card border border-border/80 p-2 shadow-2xs">
        <span
          dir="ltr"
          className="font-mono text-lg sm:text-xl font-black tracking-widest text-foreground select-all px-1 truncate"
        >
          {code}
        </span>
        <button
          type="button"
          onClick={onCopy}
          aria-label={isAr ? "نسخ كود التحقق" : "Copy code"}
          className={`shrink-0 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-all active:scale-95 cursor-pointer ${
            copied ? "bg-emerald-600 text-white" : "bg-foreground text-background hover:opacity-90"
          }`}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              <span>{isAr ? "تم النسخ" : "Copied"}</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>{isAr ? "نسخ" : "Copy"}</span>
            </>
          )}
        </button>
      </div>

      {/*
        4. How long the code is good for.

        `expiresAt` is a fact the server stamped on the message, so prefer it:
        it counts down for real and a code that died while the tab was closed
        comes back already marked expired. The minute count is only the
        fallback for a card sent before that stamp existed — and its default is
        the real TTL, never the 10 minutes this used to claim.
      */}
      {expiresAt ? (
        <CodeValidity expiresAt={expiresAt} className="text-start" />
      ) : (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/80 font-medium">
          <Clock className="h-3 w-3 shrink-0 opacity-70" />
          <span>
            {isAr ? `صالح لمدة ${expiresInMinutes} دقيقة` : `Valid for ${expiresInMinutes} minutes`}
          </span>
        </div>
      )}
    </div>
  );
}

export function AccountCard({
  kind,
  body,
  locale = "ar",
  tone = "default",
  delivery,
}: AccountCardProps) {
  const card = normalizeAccountCard(kind, body);
  if (!card || !isRenderableAccountCard(card)) return null;

  // DEDICATED CLEAN OTP CARD
  if (card.type === "verification" && card.verificationCode) {
    const rawExpires =
      typeof body?.["expiresInMinutes"] === "number" && body["expiresInMinutes"] > 0
        ? (body["expiresInMinutes"] as number)
        : DELIVERY_OTP_TTL_MINUTES;
    const expiresAt =
      typeof body?.["expiresAt"] === "string" ? (body["expiresAt"] as string) : null;
    return (
      <VerificationOtpCard
        code={card.verificationCode}
        title={card.title}
        expiresAt={expiresAt}
        expiresInMinutes={rawExpires}
        locale={locale}
      />
    );
  }

  // Which order line this account belongs to; the delivery controls act on it.
  const itemId = typeof body?.["itemId"] === "string" ? (body["itemId"] as string) : "";
  const deliveryItemId =
    typeof body?.["deliveryItemId"] === "string" ? (body["deliveryItemId"] as string) : "";
  const t = LABELS[locale];

  const heading = card.type === "credentials" ? t.credentials : t.instructions;
  const Icon = card.type === "credentials" ? KeyRound : FileText;

  return (
    <div
      dir={locale === "ar" ? "rtl" : "ltr"}
      className="w-full max-w-[320px] space-y-3 rounded-2xl border border-border/70 bg-card/90 text-foreground p-3.5 shadow-2xs"
    >
      <div className="flex items-center justify-between border-b border-border/60 pb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 opacity-80" />
          <span className="text-[13px] font-bold">{heading}</span>
        </div>
        {card.type === "credentials" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {delivery?.proofSent ? "تم إرفاق الإثبات" : "جاهز للتسجيل"}
          </span>
        )}
      </div>

      {card.title ? (
        <div className="flex items-center gap-1.5 text-[12px] font-semibold opacity-90 min-w-0">
          <Gamepad2 className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span className="truncate">{card.title}</span>
        </div>
      ) : null}

      {card.accountUser ? (
        <CopyField
          label={t.accountUser}
          value={card.accountUser}
          copyLabel={t.copy}
          copiedLabel={t.copied}
        />
      ) : null}

      {card.type === "credentials" && card.password ? (
        <CopyField
          label={t.password}
          value={card.password}
          masked={false}
          copyLabel={t.copy}
          copiedLabel={t.copied}
        />
      ) : null}

      {card.type === "instructions" && card.text ? (
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{card.text}</p>
      ) : null}

      {/* Buyer's next steps for an account they were just handed. */}
      {card.type === "credentials" && delivery && itemId ? (
        <div className="space-y-2 border-t border-border/60 pt-2">
          {/* Quick Action: Login Instructions Guide */}
          {/*
            Straight to the sign-in steps, not the top of the manual.

            The customer holding this card has an account and needs step one of
            sixteen. Sending them to a page heading and letting them find it is
            the same as not linking. Signing in is identical for both account
            options, so one anchor is correct for every order.
          */}
          <a
            href="/account_guides#login-method-1"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 w-full rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-700 dark:text-blue-400 border border-blue-500/20 py-2 px-3 text-[11px] font-bold transition-colors cursor-pointer"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>
              {locale === "ar" ? "تعليمات تسجيل الدخول والشرح" : "Login Guides & Instructions"}
            </span>
          </a>

          <div className="group relative flex items-start gap-1.5 rounded-xl bg-amber-500/10 p-2.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300 border border-amber-500/20">
            <div
              className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white font-bold text-[10px]"
              title="يجب إرفاق صورة تثبت تسجيل الدخول إلى الحساب قبل طلب كود التحقق"
            >
              !
            </div>
            <div className="flex-1">
              <span className="font-bold">تنبيه مهم: </span>
              <span>
                {locale === "ar"
                  ? "يجب إرفاق صورة تثبت تسجيل الدخول إلى الحساب قبل طلب كود التحقق. صوّر شاشة الحساب داخل الجهاز بوضوح دون قص."
                  : "You must attach a screenshot proving sign-in before requesting the verification code."}
              </span>
              {/*
                The code is the step this notice is about, so its explanation
                belongs beside it — what to do while waiting, why not to press
                Resend, and that the code lasts an hour.
              */}
              <a
                href="/account_guides#resend-verification"
                target="_blank"
                rel="noreferrer"
                className="mt-1 block font-bold underline underline-offset-4"
              >
                {locale === "ar" ? "شرح رمز التحقق" : "About the verification code"}
              </a>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={delivery.busy}
              onClick={() => void delivery.onAttachProof(itemId, deliveryItemId || undefined)}
              className={`flex flex-[2] items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-bold transition-all active:scale-98 cursor-pointer shadow-xs ${
                delivery.proofSent
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "bg-primary hover:bg-primary/90 text-primary-foreground"
              } disabled:opacity-50`}
            >
              {delivery.busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
              {delivery.proofSent
                ? locale === "ar"
                  ? "✅ تم إرسال الإثبات (إرفاق صورة أخرى)"
                  : "✅ Proof attached (Send another)"
                : locale === "ar"
                  ? "📷 إرفاق إثبات تسجيل الدخول"
                  : "📷 Attach sign-in proof"}
            </button>
            <button
              type="button"
              disabled={delivery.busy || !delivery.proofSent}
              onClick={() => void delivery.onNext(itemId, deliveryItemId || undefined)}
              title={
                delivery.proofSent
                  ? undefined
                  : locale === "ar"
                    ? "يجب إرفاق صورة تثبت تسجيل الدخول أولاً"
                    : "Attach the sign-in proof first"
              }
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card hover:bg-muted px-3 py-2 text-xs font-bold disabled:opacity-40 transition-transform active:scale-95 cursor-pointer text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {locale === "ar" ? "التالي" : "Next"}
            </button>
          </div>
        </div>
      ) : null}

      {card.type === "instructions" && card.images.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {card.images.map((src) => (
            <a key={src} href={src} target="_blank" rel="noreferrer" className="block">
              <img
                src={src}
                alt={card.title ?? heading}
                loading="lazy"
                className="h-24 w-full rounded-xl object-cover border border-border/60"
              />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default AccountCard;
