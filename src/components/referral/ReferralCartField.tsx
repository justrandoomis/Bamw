import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useCurrency } from "@/context/CurrencyContext";
import type { CartLine } from "@/store/useCartStore";

/**
 * "كود الإحالة" in the cart.
 *
 * Accepts a username or the fixed code, and fills itself in when the member
 * arrived through a link — the field is a convenience, not the mechanism: the
 * attribution already lives in a signed cookie, and this only offers a second
 * way to name it.
 *
 * Everything shown here is the server's arithmetic. The component sends the
 * cart's *identifiers* — which game, which option — and never its prices; the
 * original price, the discount and the total below all come back from
 * `/api/referral`, computed from the catalogue. Checkout recomputes the same
 * numbers, so what is displayed is what is charged.
 */

export interface ReferralCartState {
  applicable: boolean;
  referrerAlias: string | null;
  referralCode: string | null;
  productId: string | null;
  productTitle: string | null;
  originalPriceIqd: number;
  buyerDiscountIqd: number;
  buyerPercent: number;
  message: string | null;
}

/** Only the identifying fields travel — never a price. */
function toWireLines(lines: CartLine[]) {
  return lines.slice(0, 50).map((line) => ({
    productId: String(line.productId),
    kind: String(line.kind ?? ""),
    quantity: Number(line.quantity) || 1,
    optionId: String(line.optionId ?? line.meta?.["optionId"] ?? ""),
    optionName: String(line.optionName ?? line.meta?.["optionName"] ?? ""),
    typeId: String(line.typeId ?? line.meta?.["typeId"] ?? ""),
    typeName: String(line.typeName ?? line.meta?.["typeName"] ?? ""),
    offerKind: String(line.offerKind ?? ""),
    title: String(line.title ?? ""),
  }));
}

export function ReferralCartField({
  lines,
  onChange,
}: {
  lines: CartLine[];
  /** Tells the cart what the referral is worth, so the total can include it. */
  onChange: (state: ReferralCartState | null) => void;
}) {
  const queryClient = useQueryClient();
  const { formatIQDPrice } = useCurrency();
  const [code, setCode] = useState("");
  const [state, setState] = useState<ReferralCartState | null>(null);
  const [error, setError] = useState("");

  /** What the cookie already carries, and the programme's terms. */
  const { data: referralState } = useQuery<{
    terms?: { enabled?: boolean; buyerPercent?: number };
    attribution?: { productId: string | null } | null;
  }>({
    queryKey: ["referral-state"],
    queryFn: async () => {
      const res = await fetch("/api/referral", { credentials: "include" });
      if (!res.ok) throw new Error("referral_state_unavailable");
      return await res.json();
    },
    staleTime: 60_000,
  });

  const enabled = referralState?.terms?.enabled !== false;
  const hasAttribution = Boolean(referralState?.attribution);

  const publish = (next: ReferralCartState | null) => {
    setState(next);
    onChange(next);
  };

  /** Price the attribution already in force against the current cart. */
  const revalidate = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/referral", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines: toWireLines(lines) }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { applicable: boolean; quote: ReferralCartState | null };
      return data.quote && data.applicable ? { ...data.quote, applicable: true } : null;
    },
    onSuccess: (quote) => {
      publish(quote);
      if (quote?.referralCode) setCode(quote.referralCode);
    },
  });

  /*
    Re-price whenever the cart changes.

    A referral is tied to one game; removing that game has to take the discount
    off, and adding it back has to bring it back. The cart's own totals read
    from what this publishes, so leaving a stale quote in place would show a
    discount the server would then refuse at checkout.
  */
  useEffect(() => {
    if (!enabled || !hasAttribution || lines.length === 0) {
      if (lines.length === 0) publish(null);
      return;
    }
    revalidate.mutate();
    // The cart's identity, not its object identity: re-run when contents move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hasAttribution, lines.map((l) => `${l.productId}:${l.optionId ?? ""}`).join("|")]);

  const apply = useMutation({
    mutationFn: async (input: string) => {
      const res = await fetch("/api/referral", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: input, lines: toWireLines(lines) }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        quote?: ReferralCartState | null;
      } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.message || "تعذر تطبيق كود الإحالة");
      return data;
    },
    onSuccess: async (data) => {
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["referral-state"] });
      if (data.quote?.applicable) publish({ ...data.quote, applicable: true });
      else revalidate.mutate();
      toast.success(data.message || "تم تطبيق كود الإحالة");
    },
    onError: (err: Error) => {
      publish(null);
      setError(err.message);
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      await fetch("/api/referral", { method: "DELETE", credentials: "include" });
    },
    onSuccess: async () => {
      publish(null);
      setCode("");
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["referral-state"] });
      toast.info("تمت إزالة كود الإحالة");
    },
  });

  if (!enabled) return null;

  const busy = apply.isPending || remove.isPending || revalidate.isPending;

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Gift className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <h3 className="text-sm font-black text-foreground">كود الإحالة</h3>
      </div>

      {state?.applicable ? (
        <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-bold text-emerald-700 dark:text-emerald-300">
                إحالة @{state.referrerAlias}
              </p>
              {state.productTitle ? (
                <p className="truncate text-[11px] text-muted-foreground">{state.productTitle}</p>
              ) : null}
            </div>
            <button
              type="button"
              id="referral-remove-btn"
              onClick={() => remove.mutate()}
              disabled={busy}
              aria-label="إزالة كود الإحالة"
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <dl className="space-y-1 text-[12px]">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">السعر الأصلي</dt>
              <dd className="font-bold text-foreground" dir="ltr">
                {formatIQDPrice(state.originalPriceIqd)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">خصم الإحالة ({state.buyerPercent}%)</dt>
              <dd className="font-bold text-emerald-700 dark:text-emerald-300" dir="ltr">
                −{formatIQDPrice(state.buyerDiscountIqd)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-emerald-500/20 pt-1">
              <dt className="text-muted-foreground">السعر بعد الخصم</dt>
              <dd className="font-black text-foreground" dir="ltr">
                {formatIQDPrice(Math.max(0, state.originalPriceIqd - state.buyerDiscountIqd))}
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="referral-code-input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="اسم المستخدم أو كود الإحالة"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500"
            />
            <button
              type="button"
              id="referral-apply-btn"
              onClick={() => code.trim() && apply.mutate(code.trim())}
              disabled={busy || !code.trim()}
              className="shrink-0 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {apply.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "تطبيق"}
            </button>
          </div>
          {error ? (
            <p className="mt-2 text-[12px] font-bold text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              يُطبَّق خصم الإحالة على لعبة واحدة بحساب أوفلاين، ولا يُجمع مع كوبون خصم آخر — يُحتسب
              الأفضل لك.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default ReferralCartField;
