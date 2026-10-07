import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ImagePlus,
  QrCode,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import BinanceTopUpSection from "@/components/BinanceTopUpSection";
import { uploadFileWithProgress } from "@/lib/api";
import { prepareImageForUpload } from "@/lib/imageForUpload";
import { cn } from "@/lib/utils";
import {
  availableMethods,
  methodInfo,
  transferTarget,
  type TopUpMethod,
  type TopUpMethodInfo,
} from "@/components/wallet/methods";

interface TopUpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  settings: Record<string, any>;
  onRecharge: (payload: any) => Promise<any> | void;
  onConsumeBanan: (code: string) => Promise<any> | void;
  isPending: boolean;
  /** Open straight on one method — the wallet page's shortcuts — instead of the list. */
  initialMethod?: TopUpMethod;
}

/* Amounts a tap away. Dinars for a transfer; dollars for a card or crypto. */
const DINAR_PRESETS = [10_000, 25_000, 50_000, 100_000];
const ESHOP_PRESETS = [10, 20, 35, 50, 70, 100];
const DOLLAR_PRESETS = [10, 25, 50, 100];

/** Arabic-Indic and Persian digits typed on an Arabic keyboard, read as digits. */
function latinDigits(text: string) {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".");
}

/**
 * Wallet top-up, as a sheet: one list of methods in the owner's order, and on
 * picking one, that method alone — what to send where, how much, the proof —
 * as numbered steps with the button always in reach.
 *
 * On a phone it rises from the bottom and stays above the keyboard; on a wide
 * screen it is a centred card. Every colour is a theme token, so it reads the
 * same on the light and the dark packs.
 */
export function TopUpModal({
  open,
  onOpenChange,
  onSuccess,
  settings,
  onRecharge,
  onConsumeBanan,
  isPending,
  initialMethod,
}: TopUpModalProps) {
  const methods = useMemo(() => availableMethods(settings || {}), [settings]);
  const [method, setMethod] = useState<TopUpMethod | null>(initialMethod ?? null);
  const [amount, setAmount] = useState("");
  const [bananCode, setBananCode] = useState("");
  const [eshopCode, setEshopCode] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const nintendoBonusEnabled = settings?.["nintendoBonusEnabled"] !== false;
  const nintendoBonusPercent = Number(settings?.["nintendoBonusPercent"] || 15);
  const usdIqdRate = Number(settings?.["usdExchangeRate"] || 1500);

  const current = method ? methodInfo(method) : undefined;

  /* Each opening starts where it was asked to: on a method, or on the list. */
  useEffect(() => {
    if (open) setMethod(initialMethod ?? null);
  }, [open, initialMethod]);

  /*
    The sheet sits on the keyboard, not under it.

    A phone's keyboard shrinks the visual viewport and leaves the layout one
    alone, so a sheet pinned to the bottom of the layout viewport hid its own
    input and button behind the keys. The gap between the two is the
    keyboard; the sheet is lifted by it and kept within what is left.
  */
  useEffect(() => {
    if (typeof window === "undefined" || !open) return;
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const update = () => {
      const height = viewport ? viewport.height : window.innerHeight;
      const inset = viewport
        ? Math.max(0, window.innerHeight - (viewport.height + viewport.offsetTop))
        : 0;
      root.style.setProperty("--visual-viewport-height", `${height}px`);
      root.style.setProperty("--keyboard-inset", `${inset}px`);
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      root.style.setProperty("--keyboard-inset", "0px");
    };
  }, [open]);

  // Full form state resetter
  const resetForm = () => {
    setAmount("");
    setProofUrl("");
    setBananCode("");
    setEshopCode("");
    setIsUploading(false);
    setShowQr(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const pickMethod = (next: TopUpMethod | null) => {
    /* What was typed for one method means nothing to another. */
    if (next !== method) {
      setAmount("");
      setEshopCode("");
      setShowQr(false);
    }
    setMethod(next);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      // Clean up file input when closed
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const bonusOf = (usdAmount: number) => {
    if (method !== "eshop_card" || !nintendoBonusEnabled) return 0;
    return (usdAmount * nintendoBonusPercent) / 100;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    /*
      Cleared immediately, so picking the same photo again fires `change`.

      A browser does not fire it when the selection is identical to the current
      value, so after a failure the obvious next move — tap, choose that same
      receipt — did nothing at all, and the modal looked frozen.
    */
    e.target.value = "";
    if (!file) return;
    setIsUploading(true);
    try {
      /*
        Scaled down here, and sent as a file rather than as text.

        This read the whole photo into a base64 data URL and posted it inside a
        JSON body. Base64 inflates by a third, the server refuses a body over
        20 MB, and a current phone hands the page an 8–15 MB, 48-megapixel
        JPEG — so an ordinary receipt photo failed, and retrying failed the
        same way for the same reason. Every one of those megabytes was wasted
        on a picture that gets read, not enlarged.

        `prepareImageForUpload` also re-encodes, which is what makes an iPhone
        photo work: HEIC has no decoder on the server, and Safari — where HEIC
        comes from — decodes it natively.
      */
      const prepared = await prepareImageForUpload(file);
      const res = await uploadFileWithProgress(prepared, "wallets");
      setProofUrl(res.url);
      toast.success("تم رفع الصورة");
    } catch (err) {
      /*
        The server's own reason. It says whether the format cannot be read, the
        hourly limit is spent, or storage did not confirm the write — and all
        of it used to be replaced by "try again", which is advice that does not
        work for any of them.
      */
      const reason =
        err instanceof Error && err.message
          ? err.message
          : "فشل رفع الصورة، يرجى المحاولة مرة أخرى";
      toast.error(reason);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveProof = (e: React.MouseEvent) => {
    e.stopPropagation();
    setProofUrl("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(true);
      toast.success("تم النسخ");
      setTimeout(() => setCopiedText(false), 2000);
    } catch {
      toast.error("تعذّر النسخ — اضغط مطولًا على الرقم لنسخه");
    }
  };

  const amountValue = Number(amount);
  const canSubmitRecharge =
    !isPending &&
    !isUploading &&
    amountValue > 0 &&
    (method === "eshop_card" ? Boolean(eshopCode.trim() || proofUrl) : Boolean(proofUrl));

  const handleRechargeSubmit = async () => {
    if (!canSubmitRecharge || !method) return;
    try {
      await Promise.resolve(
        onRecharge({ amount: amountValue, method, proofUrl, eshopCode: eshopCode.trim() }),
      );
      // Reset form ONLY on success
      resetForm();
    } catch {
      // Do NOT reset form on error so user keeps inputs
    }
  };

  const handleConsumeBananSubmit = async () => {
    const code = bananCode.trim();
    if (isPending || !code) return;
    try {
      await Promise.resolve(onConsumeBanan(code));
      // Reset code ONLY on success
      setBananCode("");
    } catch {
      // Do NOT reset code on error
    }
  };

  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    // Smoothly scroll the focused input into comfortable view on mobile devices
    const target = e.target;
    setTimeout(() => {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 160);
  };

  const onAmountChange = (raw: string, dollars: boolean) => {
    const text = latinDigits(raw);
    if (dollars) {
      const cleaned = text.replace(/[^\d.]/g, "");
      if (/^\d*\.?\d{0,2}$/.test(cleaned)) setAmount(cleaned);
    } else {
      setAmount(text.replace(/\D/g, "").replace(/^0+(?=\d)/, ""));
    }
  };

  const isTransfer = method === "rafidain" || method === "zain_cash" || method === "crypto";
  const hasFooter = isTransfer || method === "eshop_card" || method === "banan_code";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          dir="rtl"
          aria-describedby={undefined}
          className={cn(
            "fixed inset-x-0 z-50 flex flex-col overflow-hidden border border-border bg-card text-card-foreground shadow-2xl outline-none",
            "bottom-[var(--keyboard-inset,0px)] rounded-t-[1.75rem] pb-[env(safe-area-inset-bottom)]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom duration-300",
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:pb-0 sm:data-[state=open]:slide-in-from-bottom-4 sm:data-[state=closed]:slide-out-to-bottom-4",
          )}
          style={{
            maxHeight: "min(92dvh, calc(var(--visual-viewport-height, 100dvh) - 0.75rem))",
          }}
        >
          {/* Grab handle — a phone's sheet, not a window. */}
          <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden>
            <span className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>

          <header className="flex items-center gap-2 px-3 pb-2 pt-2 sm:pt-4">
            {current ? (
              <button
                type="button"
                onClick={() => pickMethod(null)}
                className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-foreground transition-colors hover:bg-muted"
                aria-label="رجوع إلى طرق الشحن"
              >
                <ChevronRight className="size-5" />
              </button>
            ) : (
              <span className="size-10 shrink-0" aria-hidden />
            )}
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-center text-base font-black">
              {current ? current.label : "شحن الرصيد"}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="إغلاق"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 no-scrollbar">
            {!current ? (
              <MethodList
                methods={methods}
                bonusPercent={nintendoBonusEnabled ? nintendoBonusPercent : 0}
                onPick={(key) => pickMethod(key)}
              />
            ) : method === "binance" ? (
              <BinanceTopUpSection
                onBalanceUpdated={() => {
                  resetForm();
                  onSuccess();
                }}
              />
            ) : method === "banan_code" ? (
              <div className="space-y-3 pt-1">
                <p className="text-sm text-muted-foreground">
                  أدخل كود بنانتو كما وصلك، ويُضاف رصيده إلى محفظتك فورًا.
                </p>
                <input
                  value={bananCode}
                  onChange={(e) => setBananCode(latinDigits(e.target.value))}
                  onFocus={handleInputFocus}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleConsumeBananSubmit();
                  }}
                  placeholder="مثال: BANAN-XXXX-XXXX"
                  dir="ltr"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-14 w-full rounded-2xl border border-input bg-background px-4 text-center font-mono text-lg font-bold tracking-wider text-foreground outline-none transition-shadow placeholder:font-sans placeholder:text-sm placeholder:font-medium placeholder:tracking-normal placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring/40"
                />
              </div>
            ) : (
              <ol className="space-y-5 pt-1">
                {isTransfer && (
                  <TransferStep
                    method={current}
                    target={transferTarget(current.key, settings || {})}
                    copied={copiedText}
                    showQr={showQr}
                    onToggleQr={() => setShowQr((v) => !v)}
                    onCopy={copyToClipboard}
                  />
                )}

                <Step
                  n={isTransfer ? 2 : 1}
                  title={
                    method === "eshop_card"
                      ? "قيمة البطاقة"
                      : current.dollars
                        ? "المبلغ المحوَّل بالدولار"
                        : "المبلغ المحوَّل"
                  }
                >
                  <AmountField
                    value={amount}
                    dollars={Boolean(current.dollars)}
                    onChange={(raw) => onAmountChange(raw, Boolean(current.dollars))}
                    onFocus={handleInputFocus}
                  />
                  <div className="flex flex-wrap gap-2">
                    {(method === "eshop_card"
                      ? ESHOP_PRESETS
                      : current.dollars
                        ? DOLLAR_PRESETS
                        : DINAR_PRESETS
                    ).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setAmount(String(preset))}
                        className={cn(
                          "h-9 cursor-pointer rounded-full border px-3.5 text-xs font-bold tabular-nums transition-colors",
                          amount === String(preset)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-foreground hover:bg-muted",
                        )}
                        dir="ltr"
                      >
                        {current.dollars ? `$${preset}` : preset.toLocaleString("en-US")}
                      </button>
                    ))}
                  </div>
                  {method === "eshop_card" && nintendoBonusEnabled && amountValue > 0 && (
                    <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-3">
                      <Sparkles className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <div className="min-w-0 flex-1 text-xs leading-relaxed">
                        <p className="font-bold text-emerald-700 dark:text-emerald-300">
                          بونص نينتندو +{nintendoBonusPercent}%
                        </p>
                        <p className="text-muted-foreground">
                          يُضاف إلى رصيدك{" "}
                          <span className="font-black text-foreground" dir="ltr">
                            ${(amountValue + bonusOf(amountValue)).toFixed(2)}
                          </span>{" "}
                          ≈{" "}
                          <span className="font-bold text-foreground" dir="ltr">
                            {Math.round(
                              (amountValue + bonusOf(amountValue)) * usdIqdRate,
                            ).toLocaleString("en-US")}{" "}
                            د.ع
                          </span>
                        </p>
                      </div>
                    </div>
                  )}
                </Step>

                {method === "eshop_card" && (
                  <Step n={2} title="كود البطاقة">
                    <input
                      value={eshopCode}
                      onChange={(e) => setEshopCode(latinDigits(e.target.value).toUpperCase())}
                      onFocus={handleInputFocus}
                      placeholder="XXXX-XXXX-XXXX-XXXX"
                      dir="ltr"
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      className="h-12 w-full rounded-2xl border border-input bg-background px-4 text-center font-mono text-base font-bold tracking-wider text-foreground outline-none transition-shadow placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ring/40"
                    />
                  </Step>
                )}

                <Step
                  n={3}
                  title={method === "eshop_card" ? "صورة البطاقة (اختياري)" : "صورة إيصال التحويل"}
                >
                  <ProofPicker
                    proofUrl={proofUrl}
                    isUploading={isUploading}
                    onPick={() => fileInputRef.current?.click()}
                    onRemove={handleRemoveProof}
                  />
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/*"
                    onChange={handleFileUpload}
                  />
                </Step>
              </ol>
            )}
          </div>

          {current && hasFooter && (
            <footer className="border-t border-border bg-card px-4 pb-4 pt-3">
              {method === "banan_code" ? (
                <SubmitButton
                  disabled={isPending || !bananCode.trim()}
                  busy={isPending}
                  busyLabel="جاري التفعيل…"
                  label="تفعيل الكود"
                  onClick={handleConsumeBananSubmit}
                />
              ) : (
                <>
                  <SubmitButton
                    disabled={!canSubmitRecharge}
                    busy={isPending}
                    busyLabel="جاري الإرسال…"
                    label="إرسال للمراجعة"
                    onClick={handleRechargeSubmit}
                  />
                  <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
                    {method === "eshop_card"
                      ? "نراجع البطاقة ثم يُضاف الرصيد، وتتابع الطلب في سجل المحفظة."
                      : "نراجع الإيصال ثم يُضاف الرصيد، وتتابع الطلب في سجل المحفظة."}
                  </p>
                </>
              )}
            </footer>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ pieces */

function MethodList({
  methods,
  bonusPercent,
  onPick,
}: {
  methods: TopUpMethodInfo[];
  bonusPercent: number;
  onPick: (key: TopUpMethod) => void;
}) {
  return (
    <div className="space-y-3 pt-1">
      <p className="px-1 text-sm text-muted-foreground">اختر طريقة الشحن</p>
      <ul className="overflow-hidden rounded-2xl border border-border bg-background/60">
        {methods.map((m, index) => (
          <li key={m.key} className={cn(index > 0 && "border-t border-border")}>
            <button
              type="button"
              onClick={() => onPick(m.key)}
              className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-3.5 text-start transition-colors hover:bg-muted/60 active:bg-muted"
            >
              <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl", m.tint)}>
                <m.icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 text-[15px] font-bold text-foreground">
                  {m.label}
                  {m.instant && (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-700 dark:text-emerald-300">
                      فوري
                    </span>
                  )}
                  {m.key === "eshop_card" && bonusPercent > 0 && (
                    <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-black text-primary">
                      +{bonusPercent}% بونص
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{m.hint}</span>
              </span>
              <ChevronLeft className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-black text-primary-foreground">
          {n}
        </span>
        {title}
      </h3>
      {children}
    </li>
  );
}

function TransferStep({
  method,
  target,
  copied,
  showQr,
  onToggleQr,
  onCopy,
}: {
  method: TopUpMethodInfo;
  target: { value: string; qr: string };
  copied: boolean;
  showQr: boolean;
  onToggleQr: () => void;
  onCopy: (text: string) => void;
}) {
  const what =
    method.key === "zain_cash"
      ? "رقم زين كاش"
      : method.key === "rafidain"
        ? "رقم بطاقة الرافدين"
        : "عنوان المحفظة";
  return (
    <Step n={1} title={`حوّل المبلغ إلى ${what}`}>
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/40 p-2 ps-4">
        <span
          dir="ltr"
          className="min-w-0 flex-1 select-all truncate text-center font-mono text-lg font-black tracking-wider text-foreground"
        >
          {target.value || "—"}
        </span>
        <button
          type="button"
          disabled={!target.value}
          onClick={() => onCopy(target.value)}
          className="flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-xs font-bold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {copied ? (
            <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Copy className="size-4" />
          )}
          {copied ? "تم" : "نسخ"}
        </button>
      </div>
      {target.qr && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={onToggleQr}
            className="flex cursor-pointer items-center gap-1.5 text-xs font-bold text-primary"
            aria-expanded={showQr}
          >
            <QrCode className="size-4" />
            {showQr ? "إخفاء رمز QR" : "عرض رمز QR"}
          </button>
          {showQr && (
            <img
              src={target.qr}
              alt={`رمز QR — ${method.label}`}
              className="mx-auto size-48 rounded-2xl border border-border bg-white object-contain p-2"
            />
          )}
        </div>
      )}
    </Step>
  );
}

function AmountField({
  value,
  dollars,
  onChange,
  onFocus,
}: {
  value: string;
  dollars: boolean;
  onChange: (raw: string) => void;
  onFocus: (e: React.FocusEvent<HTMLInputElement>) => void;
}) {
  const shown = dollars || !value ? value : Number(value).toLocaleString("en-US");
  return (
    <div className="flex h-14 items-center gap-2 rounded-2xl border border-input bg-background px-4 transition-shadow focus-within:ring-2 focus-within:ring-ring/40">
      <input
        value={shown}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        inputMode={dollars ? "decimal" : "numeric"}
        placeholder={dollars ? "0.00" : "25,000"}
        dir="ltr"
        aria-label={dollars ? "المبلغ بالدولار" : "المبلغ بالدينار"}
        className="min-w-0 flex-1 bg-transparent text-right text-2xl font-black tabular-nums text-foreground outline-none placeholder:text-muted-foreground/40"
      />
      <span className="shrink-0 text-sm font-bold text-muted-foreground">
        {dollars ? "$" : "د.ع"}
      </span>
    </div>
  );
}

function ProofPicker({
  proofUrl,
  isUploading,
  onPick,
  onRemove,
}: {
  proofUrl: string;
  isUploading: boolean;
  onPick: () => void;
  onRemove: (e: React.MouseEvent) => void;
}) {
  if (proofUrl) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-background p-2 pe-3">
        <img
          src={proofUrl}
          alt="صورة الإثبات"
          className="size-16 shrink-0 rounded-xl object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-bold text-foreground">
            <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
            تم رفع الصورة
          </p>
          <div className="mt-1 flex gap-3 text-xs font-bold">
            <button type="button" onClick={onPick} className="cursor-pointer text-primary">
              تغيير
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="cursor-pointer text-rose-600 dark:text-rose-400"
            >
              حذف
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={isUploading}
      className="flex h-24 w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-border bg-background/60 text-center transition-colors hover:bg-muted/50 disabled:cursor-wait"
    >
      {isUploading ? (
        <>
          <RefreshCw className="size-5 animate-spin text-muted-foreground" />
          <span className="text-xs font-bold text-muted-foreground">جاري رفع الصورة…</span>
        </>
      ) : (
        <>
          <ImagePlus className="size-6 text-muted-foreground" />
          <span className="text-sm font-bold text-foreground">اضغط لاختيار صورة</span>
          <span className="text-[11px] text-muted-foreground">لقطة شاشة أو صورة واضحة</span>
        </>
      )}
    </button>
  );
}

function SubmitButton({
  disabled,
  busy,
  busyLabel,
  label,
  onClick,
}: {
  disabled: boolean;
  busy: boolean;
  busyLabel: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary text-base font-black text-primary-foreground shadow-soft transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {busy && <RefreshCw className="size-4 animate-spin" />}
      {busy ? busyLabel : label}
    </button>
  );
}
