/** Hand-drawn banana decorations and framing for the auth cards. */
import type { ReactNode } from "react";
import { Loader2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";

import mascot from "@/assets/bananto_logo.webp.asset.json";
import { COUNTRIES, DEFAULT_COUNTRY } from "@/lib/countries";
import { cleanPhoneInput, getExpectedPhoneLength, DEFAULT_DIAL_CODE } from "@/lib/phone";
import { tr } from "@/i18n";

export const BananaChefIcon = ({
  className = "w-[90px] h-[90px] sm:w-[130px] sm:h-[130px]",
}: {
  className?: string;
}) => (
  <div className={`${className} flex items-center justify-center`}>
    <img src={mascot.url} alt="شعار بنانا ستور" className="h-full w-full object-contain" />
  </div>
);

export const BoyFaceIcon = ({
  className = "w-[30px] h-[30px] sm:w-[38px] sm:h-[38px]",
}: {
  className?: string;
}) => (
  <svg
    className={className}
    viewBox="0 0 48 48"
    fill="none"
    stroke="var(--ink-soft)"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 38 C 14 30, 18 28, 24 28 C 30 28, 34 30, 34 38 Z" fill="var(--gold-deep)" />
    <path d="M21 24 V 28 H 27 V 24 Z" fill="var(--gold-soft)" stroke="none" />
    <path d="M21 24 V 28 H 27 V 24 Z" />
    <circle cx="24" cy="20" r="8" fill="var(--gold-soft)" />
    <path
      d="M16 21 C 15 13, 19 11, 24 11 C 29 11, 33 13, 32 21 C 32 18, 29 15, 24 15 C 19 15, 16 18, 16 21 Z"
      fill="var(--gold-soft)"
      stroke="none"
    />
    <path d="M16 21 C 15 13, 19 11, 24 11 C 29 11, 33 13, 32 21" />
    <path d="M16 17 Q 21 20, 24 16 Q 27 20, 32 17" />
    <circle cx="20.5" cy="21" r="1.5" fill="var(--ink-soft)" stroke="none" />
    <circle cx="27.5" cy="21" r="1.5" fill="var(--ink-soft)" stroke="none" />
    <path d="M22 25 Q 24 26.5, 26 25" />
    <path d="M15 19 Q 13 21, 15 23" fill="var(--gold-soft)" />
    <path d="M33 19 Q 35 21, 33 23" fill="var(--gold-soft)" />
  </svg>
);

export const LockIcon = ({
  className = "w-[30px] h-[30px] sm:w-[38px] sm:h-[38px]",
}: {
  className?: string;
}) => (
  <svg
    className={className}
    viewBox="0 0 48 48"
    fill="none"
    stroke="var(--ink-soft)"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="14" y="22" width="20" height="15" rx="5" fill="#fce874" />
    <path d="M17 22 V 15 C 17 10, 31 10, 31 15 V 22" />
    <path d="M24 27 V 31" />
    <circle cx="24" cy="27" r="2.5" fill="var(--ink-soft)" stroke="none" />
  </svg>
);

export const GoogleIcon = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

const CornerBanana = ({ className = "" }: { className?: string }) => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    stroke="var(--ink-soft)"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M 15 45 C 15 65, 55 60, 55 15 C 45 25, 25 25, 15 45 Z" fill="#fcd34d" />
    <path d="M 55 15 L 59 9 L 63 12 L 56 19" fill="var(--amber-ink)" />
    <path d="M 15 45 L 11 49 L 14 51 Z" fill="var(--amber-ink)" />
    <path d="M 22 43 C 32 35, 45 30, 52 20" stroke="#d97706" strokeWidth="1.5" />
  </svg>
);

export const ButtonBananaOutline = ({ className = "w-7 h-7" }: { className?: string }) => (
  <CornerBanana className={className} />
);

export const InputLeftLeaf = ({ className = "" }: { className?: string }) => (
  <svg
    viewBox="0 0 50 80"
    fill="none"
    stroke="var(--ink-soft)"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M 25 10 C 40 15, 45 35, 35 50 C 25 65, 10 50, 15 35 C 20 20, 20 15, 25 10 Z"
      fill="var(--page-3)"
    />
    <path d="M 12 70 C 18 55, 25 35, 25 10" />
    <path d="M 21 40 L 30 35" />
    <path d="M 23 25 L 32 20" />
    <path d="M 17 50 L 25 48" />
  </svg>
);

export const InputRightBanana = ({ className = "" }: { className?: string }) => (
  <svg
    viewBox="0 0 40 40"
    fill="none"
    stroke="var(--ink-soft)"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M 10 30 C 15 35, 25 35, 35 25 C 25 15, 15 15, 10 30 Z" fill="var(--gold)" />
    <path d="M 8 32 L 10 30" />
  </svg>
);

export const FieldDecorations = () => (
  <>
    <div className="pointer-events-none absolute top-1/2 -left-[1.5rem] z-20 -translate-y-1/2 sm:-left-[3rem]">
      <InputLeftLeaf className="h-16 w-10 rotate-[-5deg] sm:h-24 sm:w-16" />
    </div>
    <div className="pointer-events-none absolute -right-[0.5rem] bottom-[-1.5rem] z-20 sm:-right-[1.5rem]">
      <InputRightBanana className="h-8 w-8 rotate-[15deg] sm:h-12 sm:w-12" />
    </div>
  </>
);

export const CardWrapper = ({
  children,
  title,
  subtitle,
  logo,
}: {
  children: ReactNode;
  title: string;
  subtitle: string;
  logo?: string;
}) => (
  <div
    dir="rtl"
    className="relative z-10 mx-auto my-auto flex w-full max-w-[500px] min-w-0 flex-col rounded-2xl bg-[var(--page-3)] px-[clamp(0.75rem,4vw,2.5rem)] pt-[clamp(1rem,4vw,2rem)] pb-[clamp(1rem,5vw,2.25rem)] shadow-2xl sm:rounded-xl"
  >
    <CornerBanana className="pointer-events-none absolute top-3 left-3 h-8 w-8 rotate-[-15deg] opacity-90 sm:top-4 sm:left-4 sm:h-10 sm:w-10" />
    <CornerBanana className="pointer-events-none absolute top-5 right-3 h-8 w-8 rotate-[15deg] opacity-90 sm:top-6 sm:right-4 sm:h-10 sm:w-10" />
    <CornerBanana className="pointer-events-none absolute bottom-3 left-3 h-9 w-9 rotate-[-10deg] opacity-90 sm:bottom-4 sm:left-4 sm:h-12 sm:w-12" />
    <CornerBanana className="pointer-events-none absolute right-3 bottom-3 h-12 w-9 rotate-[20deg] opacity-90 sm:right-4 sm:bottom-4 sm:h-16 sm:w-12" />
    <div className="absolute -top-[clamp(38px,11vw,58px)] left-1/2 z-20 flex -translate-x-1/2 justify-center">
      <div className="flex h-[clamp(78px,20vw,118px)] w-[clamp(78px,20vw,118px)] items-center justify-center">
        <img
          src={logo || mascot.url}
          alt="شعار بنانا ستور"
          className="h-full w-full object-contain"
        />
      </div>
    </div>
    <div className="mt-[clamp(1.5rem,7vw,2.5rem)] flex min-w-0 flex-col items-center">
      <h1 className="mb-0 text-center text-[clamp(20px,5.5vw,32px)] font-[900] tracking-tight text-[var(--ink-soft)]">
        {title}
      </h1>
      <p
        className="mb-[clamp(0.5rem,2.5vw,1.5rem)] text-center font-sans text-[clamp(10px,2.5vw,15px)] font-[500] tracking-[0.05em] text-[var(--ink-soft)] uppercase"
        dir="ltr"
      >
        {subtitle}
      </p>
    </div>

    {children}
  </div>
);

export const InputField = ({
  label,
  icon,
  type,
  placeholder,
  value,
  onChange,
  dir = "rtl",
  decoration,
  autoComplete,
  inputMode,
  onKeyDown,
}: {
  label: string;
  icon: ReactNode;
  type: string;
  placeholder: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  dir?: "rtl" | "ltr";
  decoration?: ReactNode;
  autoComplete?: string;
  inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search";
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}) => (
  <div className="relative space-y-3 px-2 text-right">
    <label className="block pr-2 text-[15px] font-[900] text-[var(--ink-soft)] sm:text-[17px]">
      {label}
    </label>
    <div className="relative">
      <div
        className="pointer-events-none absolute inset-0 translate-x-[2.5px] translate-y-[3.5px] border-[2.5px] border-[var(--ink-soft)]"
        style={{ borderRadius: "10px 22px 10px 22px/22px 10px 22px 10px" }}
      />
      <div
        className="relative z-10 flex w-full flex-row-reverse items-center gap-3 border-[2.5px] border-[var(--ink-soft)] bg-[var(--surface-2)] px-3 py-1.5 sm:gap-4 sm:px-4 sm:py-2.5"
        style={{ borderRadius: "22px 10px 22px 10px/10px 22px 10px 22px" }}
      >
        <div className="flex shrink-0 items-center justify-center pl-1">{icon}</div>
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="w-full flex-1 bg-transparent text-right text-[14px] font-[600] text-[var(--ink-base)] outline-none placeholder:text-[var(--ink-mute)] sm:text-[17px]"
          dir={dir}
          inputMode={inputMode}
          onKeyDown={onKeyDown}
        />
      </div>
      {decoration}
    </div>
  </div>
);

export const SubmitButton = ({
  isLoading,
  text,
  progress = 1,
}: {
  isLoading: boolean;
  text: string;
  progress?: number;
}) => {
  const isComplete = progress >= 1;

  return (
    <div className="px-2 pt-4">
      <button
        type="submit"
        disabled={isLoading || !isComplete}
        className={`relative z-10 flex w-full items-center justify-center overflow-hidden rounded-full py-1.5 text-[18px] font-[900] text-[var(--ink-soft)] shadow-sm transition-all duration-300 sm:py-3 sm:text-[28px] ${
          isComplete && !isLoading
            ? "cursor-pointer bg-[#d5a840] hover:bg-[#c69a35] hover:scale-[1.02] active:scale-[0.98] shadow-md shadow-[#d5a840]/20"
            : "cursor-not-allowed bg-[var(--gold-soft)]/25 opacity-75"
        }`}
      >
        {/* Animated Progress Fill Bar */}
        {!isComplete && (
          <div
            className="absolute inset-y-0 right-0 bg-gradient-to-l from-[#d5a840] to-[#f0c862] transition-all duration-200 ease-out z-0 opacity-80"
            style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
          />
        )}

        <div className="relative z-10 flex items-center justify-center gap-3 w-full">
          {isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin sm:h-8 sm:w-8" />
          ) : (
            <>
              <span>{text}</span>
              <ButtonBananaOutline
                className={`h-8 w-8 sm:h-10 sm:w-10 transition-transform duration-300 ${isComplete ? "scale-105" : "scale-95 opacity-60"}`}
              />
            </>
          )}
        </div>
      </button>
    </div>
  );
};

export const ErrorMsg = ({
  error,
  hint,
}: {
  error?: string | undefined;
  hint?: string | undefined;
}) =>
  error ? (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative mb-4 flex flex-col items-start gap-2 border-[2px] border-[var(--danger)] bg-[#fff3f3] p-2.5 text-[var(--danger)] shadow-sm sm:p-3"
      style={{ borderRadius: "12px 6px 12px 6px/6px 12px 6px 12px" }}
    >
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" strokeWidth={2.5} />
        <span className="text-[12px] leading-tight font-[800] sm:text-[14px]">{error}</span>
      </div>
      {hint && (
        <span className="text-[11px] leading-snug font-[600] opacity-80 sm:text-[12px] pr-6">
          {hint}
        </span>
      )}
    </motion.div>
  ) : null;

/** The Google button on its own, for a page that offers it first. */
export const GoogleButton = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <div className="px-2">
    <button
      type="button"
      onClick={onClick}
      className="group relative flex min-h-12 w-full items-center justify-center gap-3 overflow-hidden border-[2px] border-[var(--ink-soft)] bg-[var(--surface-2)] py-2.5 shadow-sm transition-all hover:bg-[var(--gold)]/30 active:scale-[0.98] sm:py-3"
      style={{ borderRadius: "18px 10px 18px 10px/10px 18px 10px 18px" }}
    >
      <div
        className="pointer-events-none absolute inset-0 translate-x-[2.5px] translate-y-[3.5px] border-[2px] border-[var(--ink-soft)]"
        style={{ borderRadius: "10px 18px 10px 18px/18px 10px 18px 10px" }}
      />
      <GoogleIcon className="relative z-10 h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
      <span className="relative z-10 text-[15px] font-[900] text-[var(--ink-soft)] sm:text-[18px]">
        {label}
      </span>
    </button>
  </div>
);

/** A dashed rule with a word in the middle: «أو». */
export const OrDivider = ({ text }: { text: string }) => (
  <div className="relative my-5 border-t-2 border-dashed border-[var(--ink-soft)]/20">
    <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--page-3)] px-3 text-[13px] font-[800] whitespace-nowrap text-[var(--ink-soft)] sm:text-[15px]">
      {text}
    </span>
  </div>
);

export const AlternativeLogins = ({ onGoogleClick }: { onGoogleClick: () => void }) => (
  <div className="relative mt-5 border-t-2 border-dashed border-[var(--ink-soft)]/20 pt-5 sm:mt-8 sm:pt-6">
    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--page-3)] px-4 text-[14px] font-[800] whitespace-nowrap text-[var(--ink-soft)] sm:text-[16px]">
      {tr("أو المتابعة عبر")}
    </div>
    <div className="mt-4 px-2">
      <button
        type="button"
        onClick={onGoogleClick}
        className="group relative flex w-full items-center justify-center gap-3 overflow-hidden border-[2px] border-[var(--ink-soft)] bg-[var(--page-3)] py-2 shadow-sm transition-all hover:bg-[var(--gold)]/30 active:scale-[0.98] sm:py-3"
        style={{ borderRadius: "18px 10px 18px 10px/10px 18px 10px 18px" }}
      >
        <div
          className="pointer-events-none absolute inset-0 translate-x-[2.5px] translate-y-[3.5px] border-[2px] border-[var(--ink-soft)]"
          style={{ borderRadius: "10px 18px 10px 18px/18px 10px 18px 10px" }}
        />
        <GoogleIcon className="relative z-10 h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
        <span className="relative z-10 text-[14px] font-[900] text-[var(--ink-soft)] sm:text-[18px]">
          Google
        </span>
      </button>
    </div>
  </div>
);

/** Password input with a show/hide eye so members can check what they typed. */
export const PasswordField = ({
  label,
  placeholder,
  value,
  onChange,
  autoComplete = "current-password",
  decoration,
  disabled,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  decoration?: ReactNode;
  disabled?: boolean;
}) => {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative space-y-3 px-2 text-right">
      <label className="block pr-2 text-[15px] font-[900] text-[var(--ink-soft)] sm:text-[17px]">
        {label}
      </label>
      <div className="relative">
        <div
          className="pointer-events-none absolute inset-0 translate-x-[2.5px] translate-y-[3.5px] border-[2.5px] border-[var(--ink-soft)]"
          style={{ borderRadius: "10px 22px 10px 22px/22px 10px 22px 10px" }}
        />
        <div
          className="relative z-10 flex w-full flex-row-reverse items-center gap-3 border-[2.5px] border-[var(--ink-soft)] bg-[var(--surface-2)] px-3 py-1.5 sm:gap-4 sm:px-4 sm:py-2.5"
          style={{ borderRadius: "22px 10px 22px 10px/10px 22px 10px 22px" }}
        >
          <div className="flex shrink-0 items-center justify-center pl-1">
            <LockIcon />
          </div>
          <input
            type={visible ? "text" : "password"}
            value={value}
            onChange={onChange}
            disabled={disabled}
            placeholder={placeholder}
            autoComplete={autoComplete}
            className="w-full flex-1 bg-transparent text-right text-[14px] font-[600] text-[var(--ink-base)] outline-none placeholder:text-[var(--ink-mute)] disabled:opacity-50 sm:text-[17px]"
            dir="ltr"
          />
          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
            className="shrink-0 rounded-full p-1 text-[var(--ink-soft)] transition-opacity hover:opacity-70"
          >
            {visible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        {decoration}
      </div>
    </div>
  );
};

/** Phone input with a dial-code picker (Iraq +964 by default). */
export const PhoneField = ({
  label = "رقم الهاتف (للتوثيق عبر واتساب)",
  dial,
  onDialChange,
  value,
  onChange,
  decoration,
  disabled,
}: {
  label?: string;
  dial: string;
  onDialChange: (dial: string) => void;
  value: string;
  onChange: (value: string) => void;
  decoration?: ReactNode;
  disabled?: boolean;
}) => {
  const expectedLen = getExpectedPhoneLength(dial);
  const placeholder = dial === "964" ? "7XX XXX XXXX" : "X".repeat(expectedLen);

  const handleDialChange = (newDial: string) => {
    onDialChange(newDial);
    if (value) {
      onChange(cleanPhoneInput(value, newDial));
    }
  };

  return (
    <div className="relative space-y-3 px-2 text-right">
      <div className="flex items-center justify-between pr-2">
        <label className="block text-[15px] font-[900] text-[var(--ink-soft)] sm:text-[17px]">
          {label}
        </label>
        {value.length > 0 && (
          <span
            className={`text-[12px] font-[800] sm:text-[14px] ${value.length === expectedLen ? "text-[var(--gold-deep)] font-black" : "text-[var(--ink-mute)]"}`}
            dir="ltr"
          >
            {value.length}/{expectedLen}
          </span>
        )}
      </div>
      <div className="relative">
        <div
          className="pointer-events-none absolute inset-0 translate-x-[2.5px] translate-y-[3.5px] border-[2.5px] border-[var(--ink-soft)]"
          style={{ borderRadius: "10px 22px 10px 22px/22px 10px 22px 10px" }}
        />
        <div
          className="relative z-10 flex w-full flex-row-reverse items-center gap-2 border-[2.5px] border-[var(--ink-soft)] bg-[var(--surface-2)] px-3 py-1.5 sm:gap-3 sm:px-4 sm:py-2.5"
          style={{ borderRadius: "22px 10px 22px 10px/10px 22px 10px 22px" }}
        >
          <select
            value={dial}
            onChange={(event) => handleDialChange(event.target.value)}
            disabled={disabled}
            aria-label={tr("رمز الدولة")}
            className="shrink-0 cursor-pointer rounded-lg border-[2px] border-[var(--ink-soft)]/30 bg-[var(--gold)]/50 px-1.5 py-1 text-[13px] font-[800] text-[var(--ink-soft)] outline-none disabled:opacity-50 sm:text-[15px]"
            dir="ltr"
          >
            {COUNTRIES.map((country) => (
              <option key={country.code} value={country.dial}>
                {country.flag} +{country.dial}
              </option>
            ))}
          </select>
          <input
            type="tel"
            value={value}
            onChange={(event) => {
              const cleaned = cleanPhoneInput(event.target.value, dial);
              onChange(cleaned);
            }}
            disabled={disabled}
            placeholder={placeholder}
            autoComplete="tel"
            className="w-full flex-1 bg-transparent text-left text-[14px] font-[600] text-[var(--ink-base)] outline-none placeholder:text-[var(--ink-mute)] disabled:opacity-50 sm:text-[17px]"
            dir="ltr"
          />
        </div>
        {decoration}
      </div>
    </div>
  );
};

export const DEFAULT_DIAL = DEFAULT_COUNTRY.dial;

/** Small ghost button used for the "skip for now" steps. */
export const SkipButton = ({
  onClick,
  text = "تخطي لاحقاً",
}: {
  onClick: () => void;
  text?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="mt-4 block w-full text-[14px] font-[800] text-[var(--ink-soft)] underline decoration-[2px] underline-offset-8 transition-opacity hover:opacity-70 sm:text-[18px]"
  >
    {text}
  </button>
);

export function calculateProgress({
  phone,
  dial = DEFAULT_DIAL_CODE,
  email,
  password,
  otp,
  memberNo,
  text,
}: {
  phone?: string;
  dial?: string;
  email?: string;
  password?: string;
  otp?: string;
  memberNo?: string;
  text?: string;
}) {
  let total = 0;
  let conditions = 0;

  if (phone !== undefined) {
    conditions++;
    const expected = getExpectedPhoneLength(dial);
    total += Math.min(1, phone.length / expected);
  }
  if (email !== undefined) {
    conditions++;
    if (email.includes("@") && email.includes(".")) total += 1;
    else if (email.length > 0) total += Math.min(0.7, email.length / 8);
  }
  if (password !== undefined) {
    conditions++;
    total += Math.min(1, password.length / 8);
  }
  if (otp !== undefined) {
    conditions++;
    total += Math.min(1, otp.length / 6);
  }
  if (memberNo !== undefined) {
    conditions++;
    total += Math.min(1, memberNo.length / 6);
  }
  if (text !== undefined) {
    conditions++;
    total += Math.min(1, text.trim().length / 3);
  }

  return conditions === 0 ? 1 : total / conditions;
}
