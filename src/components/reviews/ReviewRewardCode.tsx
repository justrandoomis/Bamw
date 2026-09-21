import { useState } from "react";
import { Check, Copy, Gift } from "lucide-react";
import { toast } from "sonner";

export interface ReviewRewardData {
  code: string;
  amountIqd: number;
  expiresAt: string;
}

export function ReviewRewardCode({ reward }: { reward: ReviewRewardData }) {
  const [copied, setCopied] = useState(false);
  const expiry = new Date(reward.expiresAt);
  const expiryText = Number.isNaN(expiry.getTime())
    ? ""
    : expiry.toLocaleDateString("ar-IQ", { year: "numeric", month: "2-digit", day: "2-digit" });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reward.code);
      setCopied(true);
      toast.success("تم نسخ كود الخصم");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("تعذّر النسخ، انسخ الكود يدويًا");
    }
  };

  return (
    <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-right">
      <div className="mb-2 flex items-center gap-2 text-xs font-black text-emerald-700 dark:text-emerald-300">
        <Gift className="h-4 w-4" />
        <span>كود خصم {Number(reward.amountIqd).toLocaleString("ar-IQ")} د.ع</span>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-xl bg-background/80 px-3 py-2">
        <code className="select-all text-sm font-black tracking-wider text-foreground" dir="ltr">
          {reward.code}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-lg p-1.5 text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-300"
          aria-label="نسخ كود الخصم"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <p className="mt-2 text-[10px] font-semibold text-muted-foreground">
        صالح لحسابك مرة واحدة{expiryText ? ` حتى ${expiryText}` : ""}.
      </p>
    </div>
  );
}

export default ReviewRewardCode;
