import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Check, ImageOff, Loader2, ShieldAlert, Wallet, X } from "lucide-react";
import { useMemo, useState } from "react";

import { TelegramLayout } from "@/components/telegram/TelegramLayout";
import type { RechargeRequestWithUser } from "@/lib/types";

/**
 * Operator review of wallet top-ups, inside the Telegram Mini App.
 *
 * This is the "open it and decide" half of the notification: the member's
 * details and the payment receipt on one screen, with approve and reject under
 * them. Authentication is the signed launch payload Telegram provides — the
 * server verifies it and checks the operator id, so a member who reaches this
 * URL is told the page does not exist.
 */
export const Route = createFileRoute("/telegram/wallet-review")({
  component: WalletReviewPage,
  validateSearch: (search: Record<string, unknown>) => ({
    request: typeof search["request"] === "string" ? search["request"] : undefined,
  }),
});

const MONEY = new Intl.NumberFormat("en-US");
const money = (amount: number | undefined) =>
  `${MONEY.format(Math.round(Number(amount ?? 0)))} د.ع`;

const METHOD_LABEL: Record<string, string> = {
  zain_cash: "زين كاش",
  rafidain: "ماستركارد الرافدين",
  crypto: "عملات رقمية",
  eshop_card: "بطاقة Nintendo",
  banan_code: "كود بنانتو",
};

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

function ProofImage({ requestId }: { requestId: string }) {
  const [failed, setFailed] = useState(false);
  const src = useMemo(
    () =>
      `/api/public/telegram/wallet-review?requestId=${encodeURIComponent(requestId)}&initData=${encodeURIComponent(launchInitData())}`,
    [requestId],
  );

  if (failed) {
    return (
      <div className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-2 bg-surface-2 text-xs font-bold text-[var(--ink-mute)]">
        <ImageOff className="h-5 w-5" />
        لا يوجد إثبات مرفق
      </div>
    );
  }

  return (
    <img
      src={src}
      alt="إثبات الدفع"
      onError={() => setFailed(true)}
      className="max-h-[60vh] w-full rounded-2xl border border-line-2 object-contain bg-surface-2"
    />
  );
}

function RequestCard({
  request,
  onDecide,
  busy,
}: {
  request: RechargeRequestWithUser;
  onDecide: (approve: boolean) => void;
  busy: boolean;
}) {
  const settled = request.status !== "pending";
  return (
    <div className="space-y-3 rounded-[24px] border border-line-2 bg-surface-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-black">{request.user?.name || request.userId}</p>
          <div className="flex flex-wrap gap-x-3 text-[11px] font-bold text-[var(--ink-mute)]">
            {request.user?.phone && <span dir="ltr">{request.user.phone}</span>}
            {request.user?.username && <span dir="ltr">@{request.user.username}</span>}
          </div>
          <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-[var(--ink-soft)]">
            <Wallet className="h-3 w-3" />
            الرصيد الحالي: {money(request.user?.walletBalance)}
          </p>
        </div>
        <div className="shrink-0 text-left">
          <p className="text-xl font-black text-[var(--brand-red)]">{money(request.amount)}</p>
          <p className="text-[11px] font-bold text-[var(--ink-mute)]">
            {METHOD_LABEL[request.method] ?? request.method}
          </p>
        </div>
      </div>

      <ProofImage requestId={request.id} />

      {settled ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl bg-surface-2 py-3 text-sm font-black">
          {request.status === "approved" ? (
            <>
              <BadgeCheck className="h-4 w-4 text-emerald-600" />
              <span className="text-emerald-600">
                تمت الموافقة — {money(request.creditedAmount ?? request.amount)}
              </span>
            </>
          ) : (
            <>
              <X className="h-4 w-4 text-rose-600" />
              <span className="text-rose-600">تم الرفض</span>
            </>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(true)}
            className="flex flex-[2] items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 py-3 text-sm font-black text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            موافقة وإضافة الرصيد
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(false)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-rose-600 py-3 text-sm font-black text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            رفض
          </button>
        </div>
      )}

      {request.reviewedByName && (
        <p className="text-center text-[10px] font-bold text-[var(--ink-mute)]">
          بواسطة {request.reviewedByName}
        </p>
      )}
    </div>
  );
}

function WalletReviewPage() {
  const { request: focusedId } = Route.useSearch();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ["tg-wallet-review", focusedId ?? "all"],
    queryFn: async () => {
      if (focusedId) {
        const single = await reviewApi<{ request: RechargeRequestWithUser }>({
          action: "get",
          requestId: focusedId,
        });
        return [single.request];
      }
      const all = await reviewApi<{ requests: RechargeRequestWithUser[] }>({ action: "list" });
      return all.requests;
    },
    retry: false,
  });

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      reviewApi<{ creditedAmount?: number; balance?: number }>({
        action: approve ? "approve" : "reject",
        requestId: id,
      }),
    onSuccess: (result, variables) => {
      setMessage(
        variables.approve
          ? `✅ تمت الموافقة — أضيف ${money(result.creditedAmount)}`
          : "❌ تم رفض الطلب",
      );
      void queryClient.invalidateQueries({ queryKey: ["tg-wallet-review"] });
    },
    onError: (error: Error) => {
      const code = String(error.message);
      setMessage(
        code.includes("already_settled")
          ? "سبق أن تمت معالجة هذا الطلب"
          : code.includes("credit_failed")
            ? "تعذر إضافة الرصيد — الطلب ما زال معلقاً"
            : "تعذر تنفيذ العملية",
      );
      void queryClient.invalidateQueries({ queryKey: ["tg-wallet-review"] });
    },
  });

  const unauthorised =
    queue.isError && /not_found|invalid_launch/.test(String((queue.error as Error)?.message));

  return (
    <TelegramLayout title="مراجعة التعبئة">
      <div className="space-y-4 pb-8">
        {message && (
          <div className="rounded-2xl bg-surface-2 p-3 text-center text-sm font-black">
            {message}
          </div>
        )}

        {queue.isLoading && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--ink-mute)]" />
          </div>
        )}

        {unauthorised && (
          <div className="flex flex-col items-center gap-2 rounded-[24px] border border-line-2 bg-surface-3 p-8 text-center">
            <ShieldAlert className="h-8 w-8 text-[var(--ink-mute)]" />
            <p className="text-sm font-black">هذه الصفحة غير متاحة</p>
          </div>
        )}

        {!queue.isLoading &&
          !unauthorised &&
          (queue.data ?? []).map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              busy={decide.isPending}
              onDecide={(approve) => decide.mutate({ id: request.id, approve })}
            />
          ))}

        {!queue.isLoading && !unauthorised && (queue.data ?? []).length === 0 && (
          <div className="rounded-[24px] border border-dashed border-line-2 bg-surface-2 p-10 text-center text-sm font-black text-[var(--ink-mute)]">
            لا توجد طلبات تعبئة
          </div>
        )}
      </div>
    </TelegramLayout>
  );
}
