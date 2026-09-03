import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Gift, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useCurrency } from "@/context/CurrencyContext";
import { playSound } from "@/utils/audio";
import type { CartLine } from "@/store/useCartStore";

/**
 * The referral in the cart.
 *
 * Three states, and only ever one of them:
 *
 * 1. A quiet text button under the coupon box — "لديك كود إحالة؟" — for a
 *    member who has neither spent the discount nor been bound to anybody.
 *    Deliberately smaller and plainer than the coupon field beside it: a
 *    referral is the rarer thing, and it must not compete with the summary.
 * 2. A small line, "يدعم @username", once a referral is in force. It replaces
 *    the button rather than sitting beside it.
 * 3. Nothing at all, once the discount has been used. Not a disabled field —
 *    gone. A second code cannot change the referrer or give a second discount,
 *    so a field that accepted one would be lying about what it does.
 *
 * Which of the three is not decided here. `canApply` comes from the server,
 * which reads it from the member's row; local storage is never consulted.
 *
 * Everything shown is the server's arithmetic. The component sends the cart's
 * *identifiers* — which game, which option — and never its prices; the
 * original price, the discount and the total all come back from
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
    /*
      The edition and the add-ons decide the price too. Sending the selection
      without them let the preview quote a percentage of the record's headline
      price while checkout charged the resolved one.
    */
    editionId: String(line.editionId ?? line.meta?.["editionId"] ?? ""),
    dlcIds: Array.isArray(line.meta?.["dlcIds"])
      ? (line.meta["dlcIds"] as unknown[]).map((id) => String(id))
      : [],
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
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ReferralCartState | null>(null);
  const [error, setError] = useState("");

  /** What the server says: the terms, the binding, and whether to offer at all. */
  const { data: referralState } = useQuery<{
    terms?: { enabled?: boolean; buyerPercent?: number };
    attribution?: { productId: string | null } | null;
    canApply?: boolean;
    discountUsed?: boolean;
    supporting?: { username: string } | null;
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
  /*
    The server's decision, not a guess from what is in the browser. Undefined
    while the first request is still in flight, and treated as "do not offer"
    until it answers — showing a field and taking it away again is worse than
    a moment with nothing there.
  */
  const canApply = referralState?.canApply === true;
  const supporting = referralState?.supporting?.username ?? state?.referrerAlias ?? "";

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
      // The sheet closes and the button it came from is replaced by the
      // "يدعم @username" line, so success is visible without it.
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["referral-state"] });
      if (data.quote?.applicable) publish({ ...data.quote, applicable: true });
      else revalidate.mutate();
      /*
        The store's own sound library, and the same two cues the coupon field
        beside this one uses — so applying a referral and applying a coupon
        sound like the same action, because they are.
      */
      playSound("turn_on", 0.5);
      toast.success(data.message || "تم تطبيق كود الإحالة");
    },
    onError: (err: Error) => {
      publish(null);
      setError(err.message);
      playSound("Error", 0.5);
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
      playSound("turn_off", 0.6);
      toast.info("تمت إزالة كود الإحالة");
    },
  });

  if (!enabled) return null;

  const busy = apply.isPending || remove.isPending || revalidate.isPending;

  /*
    Nothing to show at all.

    Either the programme is off, or this member has already spent their one
    lifetime discount and is not bound to anybody whose name is worth showing.
    A disabled field here would be a control that cannot do anything.
  */
  if (!enabled) return null;
  if (!canApply && !supporting) return null;

  return (
    <>
      {supporting ? (
        /*
          In force. One quiet line, the referrer's public username only — no
          real name, no email, no phone. It stays visible after the discount is
          spent, because the relationship continues: that member still earns
          5% of everything bought here.
        */
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="chip max-w-full border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <Check className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">
              يدعم <span dir="ltr">@{supporting}</span>
            </span>
          </span>
          {state?.applicable && state.buyerDiscountIqd > 0 ? (
            <span className="text-[11px] font-bold text-muted-foreground" dir="ltr">
              −{formatIQDPrice(state.buyerDiscountIqd)}
            </span>
          ) : null}
        </div>
      ) : (
        /*
          Not in force yet. A text button, not a field: smaller than the coupon
          box above it and carrying no box of its own, so it cannot crowd the
          summary on a narrow screen.
        */
        <button
          type="button"
          id="referral-open-btn"
          onClick={() => {
            setError("");
            setOpen(true);
          }}
          className="focusable px-1 text-start text-[12px] font-bold text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
        >
          لديك كود إحالة؟
        </button>
      )}

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="referral-modal-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          {/*
            `w-full max-w-sm` with the padding on the backdrop: the sheet can
            never be wider than the viewport, so the page behind it cannot be
            pushed into a horizontal scroll on a small screen.
          */}
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3
                id="referral-modal-title"
                className="flex min-w-0 items-center gap-2 text-sm font-black text-foreground"
              >
                <Gift className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span className="truncate">كود الإحالة</span>
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="إغلاق"
                className="focusable shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <input
              id="referral-code-input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && code.trim()) apply.mutate(code.trim());
              }}
              placeholder="اسم المستخدم أو كود الإحالة"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              className="w-full min-w-0 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500"
            />

            {error ? (
              <p className="mt-2 text-[12px] font-bold text-destructive">{error}</p>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                خصم {referralState?.terms?.buyerPercent ?? 10}% على أول طلب مؤهل.
              </p>
            )}

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                id="referral-apply-btn"
                onClick={() => code.trim() && apply.mutate(code.trim())}
                disabled={busy || !code.trim()}
                className="focusable flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {apply.isPending ? (
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                ) : (
                  "تطبيق"
                )}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="focusable rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-muted-foreground transition hover:bg-muted"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default ReferralCartField;
