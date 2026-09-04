import { tr } from "@/i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useState, useRef, useEffect } from "react";
import {
  Zap,
  Gift,
  CreditCard,
  Coins,
  Image as ImageIcon,
  Copy,
  Check,
  UploadCloud,
} from "lucide-react";
import BinanceTopUpSection from "@/components/BinanceTopUpSection";
import { toast } from "sonner";
import { api, uploadFileWithProgress } from "@/lib/api";
import { prepareImageForUpload } from "@/lib/imageForUpload";

const METHOD_DETAILS: Record<string, { label: string; icon: any; color: string }> = {
  binance: { label: "Binance Pay (فوري)", icon: Zap, color: "bg-amber-400 text-black font-black" },
  banan_code: { label: "كود بنانتو", icon: Gift, color: "bg-emerald-500" },
  zain_cash: { label: "زين كاش", icon: CreditCard, color: "bg-red-600" },
  rafidain: { label: "ماستركارد الرافدين", icon: CreditCard, color: "bg-blue-600" },
  crypto: { label: "عملات رقمية", icon: Coins, color: "bg-amber-500" },
  eshop_card: { label: "Nintendo Gift Card", icon: Gift, color: "bg-red-500" },
};

interface TopUpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  settings: Record<string, any>;
  onRecharge: (payload: any) => Promise<any> | void;
  onConsumeBanan: (code: string) => Promise<any> | void;
  isPending: boolean;
}

export function TopUpModal({
  open,
  onOpenChange,
  onSuccess,
  settings,
  onRecharge,
  onConsumeBanan,
  isPending,
}: TopUpModalProps) {
  const [method, setMethod] = useState("binance");
  const [amount, setAmount] = useState("");
  const [bananCode, setBananCode] = useState("");
  const [eshopCode, setEshopCode] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const nintendoBonusEnabled = settings?.["nintendoBonusEnabled"] !== false;
  const nintendoBonusPercent = Number(settings?.["nintendoBonusPercent"] || 15);
  const usdIqdRate = Number(settings?.["usdExchangeRate"] || 1500);

  // Dynamic visualViewport handler for mobile virtual keyboards (iOS Safari & Android Chrome)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateViewport = () => {
      if (window.visualViewport) {
        document.documentElement.style.setProperty(
          "--visual-viewport-height",
          `${window.visualViewport.height}px`,
        );
      }
    };

    updateViewport();
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateViewport);
      window.visualViewport.addEventListener("scroll", updateViewport);
    }

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", updateViewport);
        window.visualViewport.removeEventListener("scroll", updateViewport);
      }
    };
  }, [open]);

  // Full form state resetter
  const resetForm = () => {
    setAmount("");
    setProofUrl("");
    setBananCode("");
    setEshopCode("");
    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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

  const calculateBonus = (usdAmount: number) => {
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
      toast.success("تم رفع صورة الإثبات بنجاح");
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    toast.success("تم نسخ الرقم إلى الحافظة");
    setTimeout(() => setCopiedText(false), 2000);
  };

  const handleRechargeSubmit = async () => {
    if (isPending || !amount || (method !== "eshop_card" && !proofUrl)) return;
    try {
      await Promise.resolve(onRecharge({ amount: Number(amount), method, proofUrl, eshopCode }));
      // Reset form ONLY on success
      resetForm();
    } catch (err) {
      // Do NOT reset form on error so user keeps inputs
    }
  };

  const handleConsumeBananSubmit = async () => {
    if (isPending || !bananCode) return;
    try {
      await Promise.resolve(onConsumeBanan(bananCode));
      // Reset code ONLY on success
      setBananCode("");
    } catch (err) {
      // Do NOT reset code on error
    }
  };

  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    // Smoothly scroll the focused input into comfortable view on mobile devices
    const target = e.target;
    setTimeout(() => {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-[95vw] sm:w-full max-w-[500px] p-0 overflow-hidden rounded-[2rem] border bg-background shadow-2xl flex flex-col my-auto transition-all"
        style={{
          maxHeight: "min(88dvh, calc(var(--visual-viewport-height, 100dvh) - 1.5rem))",
        }}
      >
        {/* Mobile handle indicator */}
        <div className="sm:hidden pt-3 pb-0 flex justify-center">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        <DialogHeader className="p-5 pb-2 text-right sm:text-right">
          <DialogTitle className="text-xl font-black">{tr("شحن المحفظة")}</DialogTitle>
          <DialogDescription className="text-xs">
            {tr("اختر طريقة الشحن المناسبة لك")}
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 pt-1 space-y-5 flex-1 overflow-y-auto overscroll-contain no-scrollbar">
          {/* Method selector pills */}
          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
            {Object.entries(METHOD_DETAILS).map(([key, details]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMethod(key)}
                className={`flex flex-col items-center justify-center min-w-[86px] aspect-square rounded-2xl transition-all border-2 flex-shrink-0 cursor-pointer ${
                  method === key
                    ? "bg-zinc-900 border-zinc-900 text-white shadow-sm"
                    : "bg-muted/50 border-transparent text-muted-foreground hover:bg-muted"
                }`}
              >
                <details.icon
                  className={`w-5 h-5 mb-1 ${method === key ? "text-white" : "text-muted-foreground"}`}
                />
                <span className="text-[10px] font-bold text-center px-1 leading-tight">
                  {tr(details.label)}
                </span>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {method === "binance" ? (
              <BinanceTopUpSection
                onBalanceUpdated={() => {
                  resetForm();
                  onSuccess();
                }}
              />
            ) : method === "banan_code" ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold px-1 text-foreground">
                    {tr("كود بنانتو")}
                  </label>
                  <input
                    value={bananCode}
                    onChange={(e) => setBananCode(e.target.value)}
                    onFocus={handleInputFocus}
                    placeholder={tr("أدخل كود بنانتو (تعبئة فورية)")}
                    className="w-full rounded-xl border border-border px-4 py-3 outline-none focus:ring-2 ring-zinc-900/10 font-mono font-bold bg-background text-foreground text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleConsumeBananSubmit}
                  disabled={isPending || !bananCode.trim()}
                  className="w-full bg-zinc-900 text-white font-bold py-3.5 rounded-xl active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {isPending ? "جاري التفعيل..." : tr("تفعيل الشحن الفوري")}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Transfer Info Box */}
                <div className="bg-muted/40 rounded-2xl p-4 border border-border space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-muted-foreground">
                      {tr("بيانات التحويل")}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const text =
                          method === "zain_cash"
                            ? settings["zainCashNumber"]
                            : method === "rafidain"
                              ? settings["rafidainNumber"]
                              : settings["cryptoID"];
                        if (text) copyToClipboard(String(text));
                      }}
                      className="p-1.5 hover:bg-muted rounded-lg transition-colors text-foreground flex items-center gap-1 text-[11px] font-bold"
                    >
                      {copiedText ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-emerald-600">تم النسخ</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>نسخ الرقم</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="font-mono font-black text-lg text-center tracking-wider bg-background/80 py-2.5 px-3 rounded-xl border border-border/50 text-foreground select-all">
                    {method === "zain_cash"
                      ? settings["zainCashNumber"] || "—"
                      : method === "rafidain"
                        ? settings["rafidainNumber"] || "—"
                        : settings["cryptoID"] || "—"}
                  </div>
                </div>

                {/* Amount Input */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold px-1 text-foreground flex justify-between">
                    <span>
                      {method === "zain_cash" || method === "rafidain"
                        ? tr("المبلغ المطلوب شحنه (د.ع)")
                        : tr("المبلغ المطلوب شحنه ($)")}
                    </span>
                    {amount && (
                      <span className="text-muted-foreground font-mono text-[11px]">
                        {method === "zain_cash" || method === "rafidain"
                          ? `${Number(amount).toLocaleString()} د.ع`
                          : `$${Number(amount).toFixed(2)}`}
                      </span>
                    )}
                  </label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onFocus={handleInputFocus}
                    placeholder={
                      method === "zain_cash" || method === "rafidain" ? "25000" : "10.00"
                    }
                    className="w-full rounded-xl border border-border px-4 py-3 outline-none focus:ring-2 ring-zinc-900/10 font-black text-xl bg-background text-foreground"
                  />
                  {method === "eshop_card" && amount && nintendoBonusEnabled && (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 flex flex-col gap-1 mt-2">
                      <div className="flex justify-between items-center text-[10px] font-black uppercase text-emerald-600">
                        <span>{tr("عرض خاص: بونص نينتندو")}</span>
                        <span>+{nintendoBonusPercent}%</span>
                      </div>
                      <div className="flex justify-between items-end">
                        <div className="flex flex-col">
                          <span className="text-[9px] text-muted-foreground font-bold">
                            {tr("الرصيد الكلي")}
                          </span>
                          <span className="text-sm font-black text-foreground">
                            ${(Number(amount) + calculateBonus(Number(amount))).toFixed(2)}
                          </span>
                        </div>
                        <div className="text-right flex flex-col items-end">
                          <span className="text-[9px] text-muted-foreground font-bold">
                            {tr("بالدينار العراقي")}
                          </span>
                          <span className="text-xs font-bold text-emerald-600 font-mono">
                            {(
                              (Number(amount) + calculateBonus(Number(amount))) *
                              usdIqdRate
                            ).toLocaleString("en-US")}{" "}
                            {tr("IQD")}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* EShop Card Code */}
                {method === "eshop_card" && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold px-1 text-foreground">
                      {tr("كود التفعيل")}
                    </label>
                    <input
                      value={eshopCode}
                      onChange={(e) => setEshopCode(e.target.value)}
                      onFocus={handleInputFocus}
                      placeholder="XXXX-XXXX-XXXX-XXXX"
                      className="w-full rounded-xl border border-border px-4 py-3 outline-none focus:ring-2 ring-zinc-900/10 font-mono font-bold bg-background text-foreground text-sm"
                    />
                  </div>
                )}

                {/* Proof Image Upload */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <label className="text-xs font-bold text-foreground">
                      {tr("إثبات الدفع (صورة التحويل)")}
                    </label>
                    {proofUrl && (
                      <button
                        type="button"
                        onClick={handleRemoveProof}
                        className="text-[11px] font-bold text-rose-600 hover:underline"
                      >
                        حذف الصورة
                      </button>
                    )}
                  </div>

                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full aspect-video max-h-[160px] rounded-2xl border-2 border-dashed border-border flex flex-col items-center justify-center cursor-pointer hover:bg-muted/30 transition-all relative overflow-hidden bg-muted/10 group"
                  >
                    {proofUrl ? (
                      <div className="relative w-full h-full">
                        <img src={proofUrl} alt="Proof" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold">
                          اضغط لتغيير الصورة
                        </div>
                      </div>
                    ) : (
                      <>
                        {isUploading ? (
                          <div className="flex flex-col items-center gap-2">
                            <div className="animate-spin rounded-full h-7 w-7 border-3 border-zinc-900 border-t-transparent dark:border-white" />
                            <span className="text-[11px] font-bold text-muted-foreground">
                              جاري رفع الصورة...
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-1.5 p-3 text-center">
                            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                              <UploadCloud className="w-5 h-5" />
                            </div>
                            <span className="text-xs font-bold text-foreground">
                              {tr("اضغط لرفع صورة التحويل")}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              JPG, PNG, WebP (بحد أقصى 10MB)
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/*"
                    onChange={handleFileUpload}
                  />
                </div>

                {/* Submit Button */}
                <button
                  type="button"
                  onClick={handleRechargeSubmit}
                  disabled={
                    isPending ||
                    !amount ||
                    Number(amount) <= 0 ||
                    (method !== "eshop_card" && !proofUrl) ||
                    isUploading
                  }
                  className="w-full bg-zinc-900 text-white font-bold py-3.5 rounded-xl active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer shadow-md"
                >
                  {isPending ? "جاري الإرسال للمراجعة..." : tr("إرسال للمراجعة")}
                </button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
