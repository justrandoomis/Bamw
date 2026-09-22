import { useCallback, useId, useRef, useState } from "react";
import { Loader2, Minus, Plus, Ticket } from "lucide-react";

import { tr } from "@/i18n";

/**
 * Buying wheel tickets with bananas, as many as the member wants.
 *
 * «المستخدم يستطيع شراء أكثر من تذكرة. لا يوجد قيد ليس لديك تذكرة اشتر واحدة
 *  فقط. يجب أن يوجد Ticket Balance حقيقي… يمكن اختيار كمية شراء التذاكر. السعر
 *  يقرأ من إعدادات السيرفر وليس من Client.»
 *
 * Three things the old wheel screen got wrong, and each one is a rule here:
 *
 * 1. It offered a purchase only to a member holding zero tickets, and only one
 *    at a time. So the balance is shown first, always, and the quantity is the
 *    member's to choose — 1..10 in one tap, anything up to 100 by typing.
 * 2. The cap is 100 because `buyTickets` in `src/lib/wheel.server.ts` refuses
 *    anything above it. A field that lets a member ask for 500 is a field that
 *    invites a refusal the shop could have prevented.
 * 3. `ticketPriceBananas` arrives from the wheel's saved settings on the
 *    server. This component multiplies it to show a total and sends only a
 *    quantity — the price it displays never travels back, so nothing a browser
 *    edits can change what a ticket costs.
 *
 * `ticketPriceBananas === 0` is not «free»; it is «the owner has not set a
 * price», which is how `not_for_sale` comes back. Saying so and offering
 * nothing beats a button that cannot work.
 */

export interface TicketShopProps {
  tickets: number; // ticket balance
  bananas: number;
  ticketPriceBananas: number; // 0 means the shop has not set a price: say so, offer nothing
  onBuy: (
    quantity: number,
    requestId: string,
  ) => Promise<{ ok: true; tickets: number } | { ok: false; error: string }>;
}

/** The ceiling `buyTickets` enforces; asking for more is a guaranteed refusal. */
const MAX_PER_PURCHASE = 100;

/** One tap for the common amounts, the field for everything else. */
const QUICK_QUANTITIES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** Same reasoning as the sell sheet: one id per press, and no dependency on `crypto.randomUUID`. */
function newRequestId(): string {
  const source = typeof globalThis === "undefined" ? undefined : globalThis.crypto;
  if (source && typeof source.randomUUID === "function") return `tkb-${source.randomUUID()}`;
  return `tkb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function TicketShop({ tickets, bananas, ticketPriceBananas, onBuy }: TicketShopProps) {
  const inputId = useId();
  const requestIdRef = useRef("");
  // State is not a lock — see `SellBananasSheet` for the tap that taught us.
  const inFlightRef = useRef(false);

  const [raw, setRaw] = useState("1");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [bought, setBought] = useState<{ quantity: number; tickets: number } | null>(null);

  const forSale = ticketPriceBananas > 0;
  const text = raw.trim();
  const quantity = text === "" ? null : Number(text);

  let problem = "";
  if (quantity !== null) {
    if (!Number.isFinite(quantity)) problem = tr("اكتب رقماً.");
    else if (!Number.isInteger(quantity)) problem = tr("عدد التذاكر يجب أن يكون صحيحاً.");
    else if (quantity <= 0) problem = tr("اشترِ تذكرة واحدة على الأقل.");
    else if (quantity > MAX_PER_PURCHASE)
      problem = `${tr("أكبر عدد في الشراء الواحد")} ${MAX_PER_PURCHASE} ${tr("تذكرة")}.`;
  }

  const valid = quantity !== null && problem === "";
  const cost = valid && quantity !== null ? quantity * ticketPriceBananas : 0;
  const affordable = valid && cost <= bananas;
  const short = Math.max(0, cost - bananas);
  const canBuy = forSale && valid && affordable && !pending;

  /** A different quantity is a different purchase, so it gets a different id. */
  const changeQuantity = (next: string) => {
    setRaw(next);
    setError("");
    setBought(null);
    requestIdRef.current = "";
  };

  const step = (delta: number) => {
    const base = valid && quantity !== null ? quantity : 1;
    changeQuantity(String(Math.min(MAX_PER_PURCHASE, Math.max(1, base + delta))));
  };

  const submit = useCallback(async () => {
    if (inFlightRef.current) return;
    if (!forSale || quantity === null || !Number.isInteger(quantity)) return;
    if (quantity <= 0 || quantity > MAX_PER_PURCHASE || quantity * ticketPriceBananas > bananas) {
      return;
    }

    inFlightRef.current = true;
    if (!requestIdRef.current) requestIdRef.current = newRequestId();
    setPending(true);
    setError("");
    try {
      const result = await onBuy(quantity, requestIdRef.current);
      if (result.ok) {
        // The new balance is the server's count, not `tickets + quantity`.
        setBought({ quantity, tickets: result.tickets });
        requestIdRef.current = "";
      } else {
        setError(result.error || tr("تعذّر شراء التذاكر."));
      }
    } catch (thrown) {
      setError(
        thrown instanceof Error && thrown.message ? thrown.message : tr("تعذّر شراء التذاكر."),
      );
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }, [bananas, forSale, onBuy, quantity, ticketPriceBananas]);

  return (
    <section
      dir="rtl"
      aria-labelledby={`${inputId}-title`}
      className="rounded-2xl border border-border bg-card p-4 text-foreground sm:p-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2
            id={`${inputId}-title`}
            className="text-[16px] font-black tracking-[-0.02em] text-foreground"
          >
            {tr("تذاكر عجلة الحظ")}
          </h2>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            {tr("اشترِ ما تشاء من التذاكر — لا يوجد حد بتذكرة واحدة.")}
          </p>
        </div>
        {/*
          The real balance, first and unconditionally. «يجب أن يوجد Ticket
          Balance حقيقي» — the screen it replaces showed a purchase button and
          left the member to guess how many tickets they were holding.
        */}
        <p className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[12px] font-black text-foreground">
          <Ticket className="h-4 w-4 text-amber-500" aria-hidden="true" />
          <span dir="ltr" className="tabular-nums">
            {tickets.toLocaleString("en-US")}
          </span>
          <span className="font-bold text-muted-foreground">{tr("تذكرة")}</span>
        </p>
      </header>

      {!forSale ? (
        <p className="mt-4 rounded-2xl border border-border bg-muted/40 p-4 text-[12.5px] font-bold leading-relaxed text-muted-foreground">
          {tr(
            "لم يحدّد المتجر سعر التذكرة بعد، فالشراء مغلق حالياً. تابع الصفحة — سيظهر السعر هنا فور تحديده.",
          )}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] font-bold text-muted-foreground">
            {tr("سعر التذكرة")}
            <span dir="ltr" className="tabular-nums text-[13px] font-black text-foreground">
              {ticketPriceBananas.toLocaleString("en-US")}
            </span>
            {tr("موزة")}
            <span aria-hidden="true">·</span>
            {tr("رصيدك")}
            <span dir="ltr" className="tabular-nums text-[13px] font-black text-foreground">
              {bananas.toLocaleString("en-US")}
            </span>
            {tr("موزة")}
          </p>

          <div>
            <label htmlFor={inputId} className="block text-[12.5px] font-bold text-foreground">
              {tr("كم تذكرة تريد؟")}
            </label>
            {/*
              Stepper and field together: the thumb has −/+ at 44px, and anyone
              who wants forty tickets types forty instead of tapping forty times.
            */}
            <div className="mt-2 flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => step(-1)}
                disabled={pending}
                aria-label={tr("إنقاص")}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted/40 text-foreground transition-transform active:scale-95 disabled:opacity-50"
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <input
                id={inputId}
                value={raw}
                onChange={(event) => changeQuantity(event.target.value)}
                disabled={pending}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                aria-invalid={problem !== ""}
                className="h-12 min-w-0 flex-1 rounded-2xl border border-border bg-background px-3 text-center text-[17px] font-black tabular-nums text-foreground outline-none focus:border-amber-500 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => step(1)}
                disabled={pending}
                aria-label={tr("زيادة")}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted/40 text-foreground transition-transform active:scale-95 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Five per row at 320px: ten chips that never push the page sideways. */}
          <div className="grid grid-cols-5 gap-2">
            {QUICK_QUANTITIES.map((count) => (
              <button
                key={count}
                type="button"
                disabled={pending}
                onClick={() => changeQuantity(String(count))}
                aria-pressed={valid && quantity === count}
                className={`min-h-11 rounded-2xl border px-1 text-[13px] font-black tabular-nums transition-transform active:scale-95 disabled:opacity-50 ${
                  valid && quantity === count
                    ? "border-amber-500 bg-amber-500/15 text-foreground"
                    : "border-border bg-muted/40 text-foreground hover:border-amber-500/60"
                }`}
              >
                {count}
              </button>
            ))}
          </div>

          {problem ? (
            <p className="text-[12px] font-bold leading-relaxed text-red-500">{problem}</p>
          ) : null}

          {/* The total, live, in the currency this shop actually charges: bananas. */}
          {valid && quantity !== null ? (
            <div
              aria-live="polite"
              className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5"
            >
              <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-[13px] font-bold text-foreground">
                <span dir="ltr" className="tabular-nums">
                  {quantity.toLocaleString("en-US")}
                </span>
                <span>{tr("تذكرة")}</span>
                <span>×</span>
                <span dir="ltr" className="tabular-nums">
                  {ticketPriceBananas.toLocaleString("en-US")}
                </span>
                <span>=</span>
                <span dir="ltr" className="tabular-nums font-black">
                  {cost.toLocaleString("en-US")}
                </span>
                <span>{tr("موزة")}</span>
              </p>
              <p className="mt-2 border-t border-amber-500/20 pt-2 text-center text-[12px] font-bold text-muted-foreground">
                {affordable ? (
                  <>
                    {tr("رصيدك بعد الشراء")}{" "}
                    <span dir="ltr" className="tabular-nums font-black text-foreground">
                      {(bananas - cost).toLocaleString("en-US")}
                    </span>{" "}
                    {tr("موزة")}
                  </>
                ) : (
                  <span className="font-bold text-red-500">
                    {tr("رصيد الموز لا يكفي — ينقصك")}{" "}
                    <span dir="ltr" className="tabular-nums font-black">
                      {short.toLocaleString("en-US")}
                    </span>{" "}
                    {tr("موزة")}
                  </span>
                )}
              </p>
            </div>
          ) : null}

          {bought ? (
            <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-[12.5px] font-bold leading-relaxed text-emerald-700 dark:text-emerald-300">
              {tr("تمت إضافة")}{" "}
              <span dir="ltr" className="tabular-nums">
                {bought.quantity.toLocaleString("en-US")}
              </span>{" "}
              {tr("تذكرة. رصيد تذاكرك الآن")}{" "}
              <span dir="ltr" className="tabular-nums">
                {bought.tickets.toLocaleString("en-US")}
              </span>
              .
            </p>
          ) : null}

          {error ? (
            <p className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] font-bold leading-relaxed text-red-600 dark:text-red-300">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canBuy}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-foreground px-4 py-3 text-[14px] font-black text-background transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {tr("اشترِ التذاكر")}
          </button>
        </div>
      )}
    </section>
  );
}

export default TicketShop;
