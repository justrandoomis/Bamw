import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, X, Loader2, ArrowUpRight, DollarSign, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import type { RechargeRequestWithUser } from "@/lib/types";

/**
 * Top-up review inside the Telegram Mini App.
 *
 * It used to call the dashboard's own endpoints, which authenticate with the
 * site session cookie — and an operator reviewing a receipt on their phone has
 * no site session, so every call failed. It now talks to the Mini App endpoint,
 * which authenticates the signed Telegram launch itself and checks the operator
 * id server-side, and the receipt is fetched the same way.
 */
function launchInitData(): string {
  if (typeof window === "undefined") return "";
  const telegram = (window as any).Telegram?.WebApp;
  return typeof telegram?.initData === "string" ? telegram.initData : "";
}

async function reviewApi<T>(payload: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/public/telegram/wallet-review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: launchInitData(), ...payload }),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error((data as { error?: string }).error || "request_failed");
  return data;
}

function haptic() {
  (window as any).Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("medium");
}

export default function AdminWalletReview({ id }: { id: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["tg_wallet_review", id],
    queryFn: () =>
      reviewApi<{ request: RechargeRequestWithUser }>({ action: "get", requestId: id }),
    retry: false,
  });

  const [finished, setFinished] = useState(false);

  const req = data?.request;
  const proofSrc = `/api/public/telegram/wallet-review?requestId=${encodeURIComponent(id)}&initData=${encodeURIComponent(launchInitData())}`;

  const settle = (action: "approve" | "reject") => ({
    mutationFn: (requestId: string) =>
      reviewApi<{ creditedAmount?: number }>({ action, requestId }),
    onSuccess: (result: { creditedAmount?: number }) => {
      toast.success(
        action === "approve"
          ? `تمت الموافقة وإضافة ${Math.round(Number(result?.creditedAmount ?? 0)).toLocaleString("en-US")} د.ع`
          : "تم رفض طلب الشحن",
      );
      setFinished(true);
      haptic();
    },
    onError: (error: Error) => {
      toast.error(
        String(error.message).includes("already_settled")
          ? "سبق أن تمت معالجة هذا الطلب"
          : "تعذر تنفيذ العملية",
      );
      setFinished(true);
    },
  });

  const approveRecharge = useMutation(settle("approve"));
  const rejectRecharge = useMutation(settle("reject"));

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 p-6">
        <Loader2 className="h-10 w-10 animate-spin text-[var(--brand-red)]" />
        <p className="font-bold">جاري تحميل الطلب...</p>
      </div>
    );
  }

  if (!req && !finished) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 p-6 text-center">
        <AlertCircle className="w-16 h-16 text-rose-500" />
        <p className="font-bold text-lg">الطلب غير موجود أو تمت معالجته مسبقاً</p>
      </div>
    );
  }

  if (finished || req?.status !== "pending") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 p-6 text-center">
        <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <Check className="w-10 h-10" />
        </div>
        <p className="font-bold text-xl text-[var(--ink)]">تمت معالجة الطلب</p>
        <button
          onClick={() => window.Telegram?.WebApp?.close()}
          className="mt-6 px-8 py-3 bg-[var(--brand-red)] text-white rounded-2xl font-bold active:scale-95 transition-all"
        >
          إغلاق النافذة
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-md mx-auto" dir="rtl">
      <div className="bg-card rounded-[2rem] p-6 shadow-xl border border-border">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center shrink-0">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-black text-xl text-gray-900">مراجعة طلب تعبئة</h2>
            <p className="text-sm text-gray-500">
              من {req.user?.name || req.userName || req.userId}
            </p>
          </div>
        </div>

        <div className="space-y-4 mb-8">
          <div className="flex justify-between items-center bg-gray-50 p-4 rounded-2xl">
            <span className="text-sm font-bold text-gray-500">المبلغ المطلوب:</span>
            <span className="font-black text-lg text-emerald-600">
              {Math.round(Number(req.amount)).toLocaleString("en-US")} د.ع
            </span>
          </div>

          <div className="flex justify-between items-center bg-gray-50 p-4 rounded-2xl">
            <span className="text-sm font-bold text-gray-500">الطريقة:</span>
            <span className="font-bold text-gray-700">{req.method}</span>
          </div>

          {req.proofUrl && (
            <div className="bg-gray-50 p-4 rounded-2xl">
              <span className="text-sm font-bold text-gray-500 block mb-2">
                إثبات الدفع (الصورة):
              </span>
              <a
                href={proofSrc}
                target="_blank"
                rel="noreferrer"
                className="w-full aspect-[4/3] bg-gray-200 rounded-xl overflow-hidden block relative group"
              >
                <img src={proofSrc} alt="Proof" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-white font-bold flex items-center gap-1">
                    عرض بالحجم الكامل <ArrowUpRight className="w-4 h-4" />
                  </span>
                </div>
              </a>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => approveRecharge.mutate(req.id)}
            disabled={approveRecharge.isPending || rejectRecharge.isPending}
            className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-2xl font-bold flex flex-col items-center justify-center gap-1 transition-colors disabled:opacity-50"
          >
            <Check className="w-6 h-6" />
            <span>موافقة</span>
          </button>
          <button
            onClick={() => rejectRecharge.mutate(req.id)}
            disabled={approveRecharge.isPending || rejectRecharge.isPending}
            className="flex-1 bg-rose-500 hover:bg-rose-600 text-white py-4 rounded-2xl font-bold flex flex-col items-center justify-center gap-1 transition-colors disabled:opacity-50"
          >
            <X className="w-6 h-6" />
            <span>رفض</span>
          </button>
        </div>
      </div>
    </div>
  );
}
