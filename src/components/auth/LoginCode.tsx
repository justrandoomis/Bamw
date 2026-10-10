import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Copy, Download, KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { tr } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { LOGIN_CODE_LENGTH, formatTypedCode } from "@/lib/loginCode";

/*
  The login code, end to end on the member's side:

  - `LoginCodeDialog` — the one time a code is shown. It cannot be closed by a
    stray tap: the member copies it or saves it as a picture, ticks that they
    kept it, and only then goes on.
  - `CodeInput` — where it is typed back, grouped as it was shown.
  - `LoginCodeReminder` — a code account that left before ticking is asked,
    on its next visit, whether it kept the code or wants a new one.
*/

/* ------------------------------------------------------------------ dialog */

/** The code as a picture for the phone's gallery: what «صوّر الشاشة» asks for, done for them. */
function downloadCodeImage(code: string, username: string | undefined): void {
  const width = 1080;
  const height = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const font =
    getComputedStyle(document.body).fontFamily || "system-ui, -apple-system, Segoe UI, sans-serif";

  /* `roundRect` is Safari 16+; a square corner is fine on anything older. */
  const box = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  };

  ctx.fillStyle = "#fbf4e4";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#3b2a24";
  ctx.lineWidth = 10;
  box(50, 50, width - 100, height - 100, 48);
  ctx.stroke();

  ctx.fillStyle = "#3b2a24";
  ctx.textAlign = "center";
  ctx.direction = "rtl";
  ctx.font = `900 64px ${font}`;
  ctx.fillText("كود الدخول — بنانا ستور", width / 2, 230);
  if (username) {
    ctx.direction = "ltr";
    ctx.font = `700 46px ${font}`;
    ctx.fillText(`@${username}`, width / 2, 330);
  }

  ctx.fillStyle = "#ffffff";
  box(110, 470, width - 220, 220, 36);
  ctx.fill();
  ctx.strokeStyle = "#d5a840";
  ctx.lineWidth = 8;
  ctx.setLineDash([22, 14]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#3b2a24";
  ctx.direction = "ltr";
  ctx.font = `800 76px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.fillText(code, width / 2, 605);

  ctx.direction = "rtl";
  ctx.font = `700 40px ${font}`;
  const lines = [
    "احتفظ بهذه الصورة في مكان آمن.",
    "بهذا الكود وحده تدخل حسابك من أي جهاز.",
    "لا تشاركه مع أحد — فريق بنانا لا يطلبه منك أبداً.",
  ];
  lines.forEach((line, index) => ctx.fillText(line, width / 2, 860 + index * 72));
  ctx.font = `500 32px ${font}`;
  ctx.fillStyle = "#7a6a5f";
  ctx.fillText(new Date().toLocaleDateString("ar"), width / 2, height - 130);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bananto-login-code${username ? `-${username}` : ""}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, "image/png");
}

/**
 * «يظهر له نافذة منبثقة له كود فريد ... يصور الشاشة وينسخه في مكان آمن ويضغط
 * على أنه تم حفظ الكود وتأكيد». Shown once, and closed only by its own button,
 * after the member ticks that they kept it.
 */
export function LoginCodeDialog({
  code,
  username,
  isNew,
  onConfirmed,
}: {
  code: string;
  username?: string;
  /** a brand new account, rather than a new code for an existing one */
  isNew: boolean;
  onConfirmed: () => void;
}) {
  const [kept, setKept] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const { refreshSession } = useAuth();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error(tr("تعذّر النسخ — اكتب الكود أو صوّر الشاشة"));
    }
  };

  const confirm = async () => {
    setSaving(true);
    try {
      await api.codeSaved();
      await refreshSession();
      onConfirmed();
    } catch (error) {
      toast.error((error as Error)?.message || tr("تعذّر الحفظ، حاول مرة أخرى"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogPrimitive.Root open>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          aria-describedby="login-code-explainer"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          dir="rtl"
          className="fixed left-1/2 top-1/2 z-[90] max-h-[calc(100dvh-1.5rem)] w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto bg-[var(--page-3)] p-5 text-[var(--ink-soft)] shadow-2xl outline-none sm:p-6"
          style={{ borderRadius: "22px" }}
        >
          <div className="mb-3 flex flex-col items-center gap-2 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#d5a840]/25">
              <KeyRound className="h-6 w-6 text-[var(--ink-soft)]" aria-hidden="true" />
            </span>
            <DialogPrimitive.Title className="text-[20px] font-[900] leading-tight">
              {isNew ? tr("تم إنشاء حسابك 🎉") : tr("كود الدخول الجديد")}
            </DialogPrimitive.Title>
            {username && (
              <p className="text-[14px] font-[800] text-[var(--ink-mute)]" dir="ltr">
                @{username}
              </p>
            )}
          </div>

          <p
            id="login-code-explainer"
            className="mb-3 text-center text-[14px] font-[700] leading-relaxed"
          >
            {tr(
              "هذا كود الدخول لحسابك. صوّر الشاشة أو انسخه أو اكتبه على ورقة واحفظه في مكان آمن — به وحده تدخل حسابك من أي جهاز.",
            )}
          </p>

          <div
            className="mb-3 border-[2.5px] border-dashed border-[#d5a840] bg-[var(--surface-2)] px-3 py-4 text-center"
            style={{ borderRadius: "22px" }}
          >
            {/*
              Each group of four keeps together, so a narrow phone breaks the
              code between groups — never inside one, where «6W / ZB» reads as
              two different codes. Selecting it still copies it whole.
            */}
            <span
              dir="ltr"
              data-login-code
              className="block select-all font-mono text-[clamp(19px,5.6vw,27px)] font-[800] tracking-[0.05em] text-[var(--ink-base)]"
            >
              {code.split("-").map((group, index, groups) => (
                <span key={index} className="inline-block whitespace-nowrap">
                  {group}
                  {index < groups.length - 1 ? "-" : ""}
                </span>
              ))}
            </span>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              className="flex h-11 items-center justify-center gap-2 rounded-full border-[2px] border-[var(--ink-soft)] bg-[var(--surface-2)] text-[14px] font-[900] transition-transform active:scale-95"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? tr("تم النسخ") : tr("نسخ الكود")}
            </button>
            <button
              type="button"
              onClick={() => downloadCodeImage(code, username)}
              className="flex h-11 items-center justify-center gap-2 rounded-full border-[2px] border-[var(--ink-soft)] bg-[var(--surface-2)] text-[14px] font-[900] transition-transform active:scale-95"
            >
              <Download className="h-4 w-4" />
              {tr("حفظ كصورة")}
            </button>
          </div>

          <div
            className="mb-4 flex items-start gap-2 bg-[var(--danger)]/10 p-3 text-[12.5px] font-[700] leading-relaxed text-[var(--danger)]"
            style={{ borderRadius: "22px" }}
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {tr(
                "لا يمكن استرجاع الكود إن ضاع، ولا تشاركه مع أحد — فريق بنانا لا يطلبه منك أبداً.",
              )}
            </span>
          </div>

          <label className="mb-4 flex cursor-pointer items-center gap-3 text-[15px] font-[900]">
            <input
              type="checkbox"
              checked={kept}
              onChange={(event) => setKept(event.target.checked)}
              className="h-5 w-5 shrink-0 accent-[#d5a840]"
            />
            {tr("حفظت الكود في مكان آمن")}
          </label>

          <button
            type="button"
            disabled={!kept || saving}
            onClick={() => void confirm()}
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-full text-[17px] font-[900] text-[var(--ink-soft)] transition-all ${
              kept && !saving
                ? "cursor-pointer bg-[#d5a840] shadow-md hover:bg-[#c69a35] active:scale-[0.98]"
                : "cursor-not-allowed bg-[var(--gold-soft)]/25 opacity-70"
            }`}
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : tr("تأكيد والمتابعة")}
          </button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ------------------------------------------------------------------- input */

export function CodeInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="relative space-y-3 px-2 text-right">
      <label
        htmlFor="login-code"
        className="block pr-2 text-[15px] font-[900] text-[var(--ink-soft)] sm:text-[17px]"
      >
        {label}
      </label>
      <div className="relative">
        <div className="clay-well relative z-10 flex w-full items-center gap-3 rounded-2xl border border-transparent bg-[var(--surface-2)] px-3 py-2 transition-colors focus-within:border-[var(--gold-deep)] sm:px-4 sm:py-3">
          <KeyRound className="h-5 w-5 shrink-0 text-[var(--ink-soft)]" aria-hidden="true" />
          <input
            id="login-code"
            dir="ltr"
            value={value}
            onChange={(event) => onChange(formatTypedCode(event.target.value))}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={LOGIN_CODE_LENGTH + 3}
            className="w-full min-w-0 flex-1 bg-transparent text-center font-mono text-[16px] font-[800] tracking-[0.08em] text-[var(--ink-base)] outline-none placeholder:text-[var(--ink-mute)] sm:text-[18px]"
          />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- tabs */

export function MethodTabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="clay-well mx-2 mb-4 grid gap-1 border border-transparent bg-[var(--surface-2)] p-1"
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        borderRadius: "22px",
      }}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          onClick={() => onChange(option.id)}
          className={`min-h-10 rounded-[12px] px-2 text-[13.5px] font-[900] transition-colors sm:text-[15px] ${
            value === option.id
              ? "bg-[#d5a840] text-[var(--ink-soft)] shadow-sm"
              : "text-[var(--ink-mute)] hover:text-[var(--ink-soft)]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- reminder */

/**
 * A code account that never said it kept its code.
 *
 * The dialog that shows a new code waits for a tick, but a tab can be closed
 * before it — and a code account has no email and no phone to fall back on:
 * when its session ends, the code is the only way in. So on the next visit,
 * anywhere in the shop, it is asked once: did you keep it, or do you want a
 * new one now, while you are still signed in?
 */
export function LoginCodeReminder({ pathname }: { pathname: string }) {
  const { user, refreshSession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const due =
    Boolean(user) &&
    user?.provider === "code" &&
    user.hasLoginCode === true &&
    !user.loginCodeSavedAt &&
    !pathname.startsWith("/auth");

  if (fresh) {
    return (
      <LoginCodeDialog
        code={fresh}
        username={user?.username}
        isNew={false}
        onConfirmed={() => setFresh(null)}
      />
    );
  }
  if (!due) return null;

  const kept = async () => {
    setBusy(true);
    try {
      await api.codeSaved();
      await refreshSession();
    } catch (error) {
      toast.error((error as Error)?.message || tr("تعذّر الحفظ، حاول مرة أخرى"));
    } finally {
      setBusy(false);
    }
  };

  const replace = async () => {
    setBusy(true);
    try {
      const res = await api.codeRotate();
      setFresh(res.code);
    } catch (error) {
      toast.error((error as Error)?.message || tr("تعذّر إنشاء كود جديد، حاول مرة أخرى"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogPrimitive.Root open>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-black/55" />
        <DialogPrimitive.Content
          aria-describedby="login-code-reminder"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          dir="rtl"
          className="fixed left-1/2 top-1/2 z-[90] w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 bg-[var(--page-3)] p-5 text-center text-[var(--ink-soft)] shadow-2xl outline-none"
          style={{ borderRadius: "22px" }}
        >
          <span className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-[#d5a840]/25">
            <KeyRound className="h-6 w-6" aria-hidden="true" />
          </span>
          <DialogPrimitive.Title className="mb-2 text-[19px] font-[900]">
            {tr("هل حفظت كود الدخول؟")}
          </DialogPrimitive.Title>
          <p id="login-code-reminder" className="mb-4 text-[14px] font-[700] leading-relaxed">
            {tr(
              "حسابك يدخل بكود الدخول وحده. إن لم تحفظه، خذ كوداً جديداً الآن وأنت ما زلت داخل حسابك — بدونه لن تستطيع الدخول بعد الخروج أو من جهاز آخر.",
            )}
          </p>
          <div className="grid gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void kept()}
              className="flex h-12 items-center justify-center rounded-full bg-[#d5a840] text-[16px] font-[900] shadow-md transition-all hover:bg-[#c69a35] active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : tr("نعم، حفظته")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void replace()}
              className="flex h-12 items-center justify-center rounded-full border-[2px] border-[var(--ink-soft)] bg-[var(--surface-2)] text-[15px] font-[900] transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {tr("أعطني كوداً جديداً")}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ------------------------------------------------------------- profile row */

/**
 * The login code in the profile: whether the account has one, whether its
 * member confirmed keeping it, and a new one on request.
 *
 * A new code replaces the old at once and signs every other device out — the
 * thing a member wants when someone else has seen it — so it asks first. An
 * account without a code yet gets one without the question: nothing is lost.
 */
export function LoginCodeRow() {
  const { user } = useAuth();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  if (!user) return null;

  const codeAccount = user.provider === "code";
  const status = user.hasLoginCode
    ? user.loginCodeSavedAt
      ? tr("محفوظ ✓ — به تدخل من أي جهاز")
      : tr("لم تؤكد حفظه بعد")
    : tr("أضف كوداً تدخل به بلا كلمة مرور");

  const issue = async () => {
    setAsking(false);
    setBusy(true);
    try {
      const res = await api.codeRotate();
      setFresh(res.code);
    } catch (error) {
      toast.error((error as Error)?.message || tr("تعذّر إنشاء كود جديد، حاول مرة أخرى"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => (user.hasLoginCode ? setAsking(true) : void issue())}
        className="w-full flex items-center justify-between p-3 hover:bg-muted rounded-2xl transition-colors text-right disabled:opacity-60"
      >
        <div className="flex min-w-0 items-center gap-4">
          <div className="shrink-0 p-3 bg-amber-100 text-amber-700 rounded-full dark:bg-amber-500/15 dark:text-amber-300">
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <KeyRound className="w-5 h-5" />}
          </div>
          <div className="min-w-0">
            <div className="font-bold text-foreground">
              {user.hasLoginCode ? tr("كود الدخول") : tr("إنشاء كود دخول")}
            </div>
            <div
              className={`truncate text-xs ${
                user.hasLoginCode && !user.loginCodeSavedAt
                  ? "font-bold text-amber-700 dark:text-amber-300"
                  : "text-muted-foreground"
              }`}
            >
              {status}
            </div>
          </div>
        </div>
        {user.hasLoginCode && (
          <span className="shrink-0 text-xs font-bold text-muted-foreground">{tr("كود جديد")}</span>
        )}
      </button>

      {asking && (
        <DialogPrimitive.Root open onOpenChange={(open) => !open && setAsking(false)}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-black/55" />
            <DialogPrimitive.Content
              aria-describedby="login-code-replace"
              dir="rtl"
              className="fixed left-1/2 top-1/2 z-[90] w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-card p-5 text-center text-foreground shadow-2xl outline-none"
            >
              <DialogPrimitive.Title className="mb-2 text-[18px] font-[900]">
                {tr("إنشاء كود دخول جديد؟")}
              </DialogPrimitive.Title>
              <p
                id="login-code-replace"
                className="mb-4 text-[14px] leading-relaxed text-muted-foreground"
              >
                {codeAccount
                  ? tr(
                      "سيتوقف الكود القديم فوراً وتخرج الأجهزة الأخرى من حسابك. ستحتاج الكود الجديد لتدخل به مرة أخرى.",
                    )
                  : tr("سيتوقف الكود القديم فوراً وتخرج الأجهزة الأخرى من حسابك.")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void issue()}
                  className="h-11 rounded-full bg-primary text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  {tr("نعم، كود جديد")}
                </button>
                <DialogPrimitive.Close className="h-11 rounded-full border border-border text-sm font-bold">
                  {tr("إلغاء")}
                </DialogPrimitive.Close>
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}

      {fresh && (
        <LoginCodeDialog
          code={fresh}
          username={user.username}
          isNew={false}
          onConfirmed={() => setFresh(null)}
        />
      )}
    </>
  );
}
