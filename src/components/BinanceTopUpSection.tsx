import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { walletApi } from "@/lib/api";
import {
  Zap,
  Copy,
  Check,
  Clock,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  HelpCircle,
  Clipboard,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

interface BinanceTopUpSectionProps {
  onBalanceUpdated?: () => void;
}

const PRESET_SUGGESTIONS = [5, 10, 25, 50, 100];

export default function BinanceTopUpSection({ onBalanceUpdated }: BinanceTopUpSectionProps) {
  const queryClient = useQueryClient();
  const [amountInput, setAmountInput] = useState("");
  const [txIdInput, setTxIdInput] = useState("");
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<{
    amount?: string;
    currency?: string;
    transactionId?: string;
    creditedIqd?: number;
    usdIqdRate?: number;
  } | null>(null);

  // Load active intent and public config
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["binance-active-intent"],
    queryFn: () => walletApi.getActiveBinanceIntent(),
    refetchInterval: 10000,
  });

  const activeIntent = data?.activeIntent;
  const config = data?.config;

  // Countdown timer for active intent
  const [timeRemaining, setTimeRemaining] = useState<string>("");

  useEffect(() => {
    if (!activeIntent || activeIntent.status !== "pending") {
      setTimeRemaining("");
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const diff = activeIntent.expires_at - now;

      if (diff <= 0) {
        setTimeRemaining("انتهت الصلاحية");
        refetch();
      } else {
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        setTimeRemaining(`${mins}:${secs.toString().padStart(2, "0")}`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [activeIntent, refetch]);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const timer = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownRemaining]);

  // Create Intent Mutation
  const createIntent = useMutation({
    mutationFn: (amount: string | number) => walletApi.createBinanceIntent(amount),
    onSuccess: (res) => {
      if (res.success) {
        toast.success("تم إنشاء طلب التعبئة بنجاح");
        setErrorMessage(null);
        setSuccessResult(null);
        setTxIdInput("");
        refetch();
      }
    },
    onError: (err: any) => {
      const msg = err?.message || "فشل إنشاء طلب التعبئة";
      setErrorMessage(msg);
      toast.error(msg);
    },
  });

  // Verify Mutation
  const verifyTopUp = useMutation({
    mutationFn: ({ intentId, transactionId }: { intentId: string; transactionId: string }) =>
      walletApi.verifyBinanceTopUp(intentId, transactionId),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(res.message || "تم استلام التحويل وإضافة الرصيد بنجاح!");
        setSuccessResult(res);
        setErrorMessage(null);
        setTxIdInput("");
        queryClient.invalidateQueries({ queryKey: ["user"] });
        queryClient.invalidateQueries({ queryKey: ["wallet-transactions"] });
        onBalanceUpdated?.();
        refetch();
      } else {
        setErrorMessage(
          res.message ||
            "لم نتمكن من التحقق من هذه المعاملة حتى الآن. تأكد من رقم المعاملة وحاول مرة أخرى.",
        );
        if (res.retryAfter) {
          setCooldownRemaining(res.retryAfter);
        }
        refetch();
      }
    },
    onError: (err: any) => {
      const msg =
        err?.message ||
        "تعذر الاتصال بخدمة التحقق حاليًا. لم يتم إضافة أي رصيد. حاول مرة أخرى بعد قليل.";
      setErrorMessage(msg);
      if (err?.retryAfter) {
        setCooldownRemaining(err.retryAfter);
      }
      toast.error(msg);
      refetch();
    },
  });

  // Cancel Intent Mutation
  const cancelIntent = useMutation({
    mutationFn: (intentId: string) => walletApi.cancelBinanceIntent(intentId),
    onSuccess: () => {
      toast.info("تم إلغاء الطلب");
      setErrorMessage(null);
      refetch();
    },
  });

  const handleCopy = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("تم نسخ Binance ID");
    setTimeout(() => setCopied(false), 2500);
  };

  const handlePaste = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setTxIdInput(text.trim());
          toast.success("تم لصق رقم العملية");
        }
      }
    } catch {
      // Ignore if clipboard permission not granted
    }
  };

  const isServiceDisabled = config && config.enabled === false;
  // Same rate the server credits with, so the quote and the credit always agree.
  const usdIqdRate = Number((config as { usdIqdRate?: number } | undefined)?.usdIqdRate ?? 0);

  const expectedUsdt = activeIntent
    ? (activeIntent.expected_amount_atomic / 1_000_000).toFixed(2)
    : "";

  if (isLoading) {
    return (
      <div className="py-10 text-center">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-500 mb-2" />
        <p className="text-xs text-muted-foreground font-medium">جاري فحص خدمة التعبئة...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pt-1">
      {/* Kill Switch Banner */}
      {isServiceDisabled && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/60 p-4 rounded-2xl flex items-center gap-3 text-amber-900 dark:text-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <div className="text-xs font-bold leading-relaxed">
            التعبئة عبر Binance متوقفة مؤقتًا.
          </div>
        </div>
      )}

      {/* What this method is, in one line — the sheet's title already names it. */}
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Zap className="mt-0.5 size-4 shrink-0 fill-amber-400 text-amber-500" />
        <span>حوّل USDT عبر Binance Pay ويُضاف الرصيد تلقائيًا فور التحقق، بلا انتظار مراجعة.</span>
      </p>

      {/* Success Notification Card */}
      {successResult && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800/60 rounded-2xl p-5 text-emerald-950 dark:text-emerald-100 space-y-2 animate-in fade-in zoom-in duration-300">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-black">
            <CheckCircle2 className="w-5 h-5" />
            <span>تم استلام التحويل وإضافة الرصيد بنجاح!</span>
          </div>
          <p className="text-xs text-emerald-800 dark:text-emerald-200 font-medium">
            تم قيد{" "}
            <span className="font-black text-sm">
              {successResult.creditedIqd != null
                ? `${successResult.creditedIqd.toLocaleString("en-US")} د.ع`
                : `${successResult.amount} USDT`}
            </span>{" "}
            في محفظتك
            {successResult.creditedIqd != null && successResult.amount
              ? ` (بقيمة ${successResult.amount}$).`
              : "."}
            {successResult.transactionId && (
              <span className="block mt-1 font-mono text-[11px] opacity-80">
                رقم المعاملة: {successResult.transactionId}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Error Message Banner */}
      {errorMessage && (
        <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800/60 rounded-2xl p-4 text-rose-900 dark:text-rose-200 text-xs font-bold flex items-start gap-2.5 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span>{errorMessage}</span>
          </div>
        </div>
      )}

      {/* State A: Active Pending Intent */}
      {activeIntent && activeIntent.status === "pending" ? (
        <div className="space-y-5">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <span className="text-[11px] font-bold text-muted-foreground uppercase">
                طلب التعبئة النشط
              </span>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-black text-foreground">{expectedUsdt}</span>
                <span className="text-sm font-black text-amber-500">USDT</span>
              </div>
            </div>
            <div className="text-left">
              <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1 justify-end">
                <Clock className="w-3.5 h-3.5" /> الوقت المتبقي
              </span>
              <span className="font-mono font-bold text-base text-rose-600 dark:text-rose-400">
                {timeRemaining}
              </span>
            </div>
          </div>

          {/* Receiver Binance ID Box */}
          <div className="bg-amber-50/70 dark:bg-amber-950/30 rounded-2xl p-4 border border-amber-200 dark:border-amber-800/50 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                1. حوّل المبلغ إلى معرف Binance الخاص بنا:
              </span>
              <span className="text-[10px] font-black text-amber-800 dark:text-amber-300 bg-amber-200/60 dark:bg-amber-900/60 px-2 py-0.5 rounded-md">
                Binance Pay ID
              </span>
            </div>

            <div className="flex items-center justify-between bg-card p-3.5 rounded-xl border border-amber-200 dark:border-amber-800/60 shadow-xs">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-muted-foreground">
                  معرف المستلم (Pay ID)
                </span>
                <span className="font-mono font-black text-lg text-foreground tracking-wider">
                  {config?.receiverId || "—"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleCopy(config?.receiverId || "")}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-400 hover:bg-amber-500 text-black rounded-xl font-bold text-xs transition-colors shadow-xs"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-900" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                {copied ? "تم النسخ" : "نسخ المعرف"}
              </button>
            </div>

            <p className="text-[11px] text-amber-900/80 dark:text-amber-200/80 font-medium leading-relaxed">
              ⚠️ <strong>تنبيه هام:</strong> يرجى تحويل مبلغ{" "}
              <span className="font-black underline">{expectedUsdt} USDT</span> بالضبط من حساب
              Binance الخاص بك لضمان مطابقة العملية تلقائيًا.
            </p>
          </div>

          {/* Step 2: Verification Input */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-foreground flex items-center justify-between">
              <span>2. أدخل رقم العملية (Transaction ID / Order ID):</span>
              <span className="text-[10px] text-muted-foreground">
                المحاولات المتبقية: {Math.max(0, 5 - activeIntent.verify_attempts)}
              </span>
            </label>

            <div className="relative flex items-center">
              <input
                type="text"
                value={txIdInput}
                onChange={(e) => setTxIdInput(e.target.value.trim())}
                placeholder="مثال: 123456789012 أو M1234567"
                disabled={verifyTopUp.isPending || cooldownRemaining > 0}
                className="w-full p-4 pl-20 rounded-2xl bg-muted/40 border border-border outline-none focus:ring-2 ring-amber-500/20 font-mono font-bold text-base transition-all"
              />
              <button
                type="button"
                onClick={handlePaste}
                className="absolute left-2.5 px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground text-xs font-bold rounded-xl border border-border flex items-center gap-1"
              >
                <Clipboard className="w-3.5 h-3.5" />
                <span>لصق</span>
              </button>
            </div>

            <p className="text-[10px] text-muted-foreground">
              * تجد رقم العملية في تطبيق Binance تحت:{" "}
              <strong>
                Pay &gt; السجل (History) &gt; تفاصيل المعاملة &gt; رقم المعاملة (Transaction ID)
              </strong>
              .
            </p>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2 pt-2">
            <button
              type="button"
              onClick={() =>
                verifyTopUp.mutate({
                  intentId: activeIntent.id,
                  transactionId: txIdInput,
                })
              }
              disabled={
                verifyTopUp.isPending ||
                !txIdInput ||
                cooldownRemaining > 0 ||
                activeIntent.verify_attempts >= 5
              }
              className="w-full bg-amber-400 hover:bg-amber-500 active:scale-[0.99] text-black font-black py-4 rounded-2xl shadow-lg shadow-amber-400/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              {verifyTopUp.isPending ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>جاري التحقق من التحويل...</span>
                </>
              ) : cooldownRemaining > 0 ? (
                <>
                  <Clock className="w-5 h-5" />
                  <span>يرجى الانتظار {cooldownRemaining} ثانية قبل محاولة التحقق مرة أخرى...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-5 h-5" />
                  <span>تحقق وأضف الرصيد</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => cancelIntent.mutate(activeIntent.id)}
              disabled={cancelIntent.isPending || verifyTopUp.isPending}
              className="w-full py-2.5 text-xs text-muted-foreground hover:text-rose-600 font-bold transition-colors"
            >
              إلغاء هذا الطلب والبدء بمبلغ آخر
            </button>
          </div>
        </div>
      ) : (
        /* State B: Create Intent Form */
        <div className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-bold text-foreground">
              حدد المبلغ المراد شحنه (USDT)
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => {
                  const val = e.target.value;
                  // Allow only valid numbers and at most one dot
                  if (/^\d*\.?\d{0,6}$/.test(val)) {
                    setAmountInput(val);
                  }
                }}
                placeholder="0.00"
                disabled={isServiceDisabled}
                className="w-full p-4 rounded-2xl bg-muted/40 border border-border outline-none focus:ring-2 ring-amber-500/20 font-black text-2xl transition-all pl-16"
              />
              <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-amber-500 text-sm">
                USDT
              </span>
            </div>
            {usdIqdRate > 0 && Number(amountInput) > 0 && (
              <p className="text-[11px] font-bold text-muted-foreground px-1">
                سيُضاف إلى رصيدك:{" "}
                <span className="text-foreground font-black">
                  {Math.floor(Number(amountInput) * usdIqdRate).toLocaleString("en-US")} د.ع
                </span>{" "}
                <span className="opacity-70">
                  (سعر الصرف: 1$ = {usdIqdRate.toLocaleString("en-US")} د.ع)
                </span>
              </p>
            )}
          </div>

          {/* Preset Buttons */}
          <div className="space-y-2">
            <span className="text-[11px] font-bold text-muted-foreground">اقتراحات سريعة:</span>
            <div className="grid grid-cols-5 gap-2">
              {PRESET_SUGGESTIONS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmountInput(String(preset))}
                  disabled={isServiceDisabled}
                  className={`py-2 rounded-xl text-xs font-black transition-all border ${
                    amountInput === String(preset)
                      ? "bg-amber-400 border-amber-400 text-black shadow-xs"
                      : "bg-muted/40 border-border hover:bg-muted text-foreground"
                  }`}
                >
                  ${preset}
                </button>
              ))}
            </div>
          </div>

          {/* Information box */}
          <div className="bg-muted/30 rounded-2xl p-4 border border-border space-y-2">
            <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
              كيف تعمل التعبئة الفورية؟
            </h4>
            <ol className="text-[11px] text-muted-foreground space-y-1 list-decimal list-inside font-medium leading-relaxed">
              <li>أدخل أي مبلغ ترغب به واضغط على "متابعة التعبئة".</li>
              <li>حوّل المبلغ إلى معرف Binance Pay الخاص بالمتجر.</li>
              <li>انسخ رقم العملية من Binance Pay وضعه للتحقق الفوري وإضافة الرصيد.</li>
            </ol>
          </div>

          <button
            type="button"
            onClick={() => createIntent.mutate(amountInput)}
            disabled={
              createIntent.isPending ||
              !amountInput ||
              Number(amountInput) <= 0 ||
              isServiceDisabled
            }
            className="w-full bg-amber-400 hover:bg-amber-500 active:scale-[0.99] text-black font-black py-4 rounded-2xl shadow-lg shadow-amber-400/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
          >
            {createIntent.isPending ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>جاري إنشاء طلب التعبئة...</span>
              </>
            ) : (
              <>
                <span>متابعة التعبئة عبر Binance</span>
                <ArrowRight className="w-4 h-4 rotate-180" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
