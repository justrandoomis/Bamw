import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Gift, Loader2, Ticket } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { tr } from "@/i18n";
import { playSound } from "@/utils/audio";

export const Route = createFileRoute("/wheel")({
  head: () => ({
    meta: [
      { title: "عجلة الحظ — بنانتو" },
      {
        name: "description",
        content: "استبدل الموز بتذكرة ودوّر عجلة الحظ لتربح لعبة عشوائية من متجر بنانتو.",
      },
      { property: "og:title", content: "عجلة الحظ — بنانتو" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: WheelPage,
});

interface WheelState {
  tickets: number;
  /** The member's banana balance, so the screen can say what a ticket leaves. */
  bananas?: number;
  poolSize: number;
  candidates: { id: string; title: string; image: string | null }[];
  spins: {
    id: string;
    product_title: string;
    coupon_code: string | null;
    expires_at: string | null;
    created_at: string;
  }[];
  prizeValidDays: number;
  odds: { label: string; weight: number; games: number; chance: number }[];
  /** What the owner charges for one ticket. 0 means tickets are not for sale. */
  ticketPriceBananas?: number;
}

interface SpinResult {
  ok?: boolean;
  /** False on «حظ أوفر» — the spin happened, the ticket is spent, nothing won. */
  won?: boolean;
  prize?: { productId: string; title: string; price: number; image: string | null };
  /** The gift order the win created — the prize itself, not a way to get it. */
  giftOrder?: { orderId: string; code: string; threadId: string };
  couponCode?: string;
  expiresAt?: string;
  tickets?: number;
}

interface PurchaseResult {
  ok?: boolean;
  tickets?: number;
  /** The balance AFTER the purchase, straight from the ledger that debited it. */
  bananas?: number;
}

const shortDate = (iso: string | null) => {
  if (!iso) return "";
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
};

/**
 * عجلة الحظ.
 *
 * The wheel is an animation, not a decision. The server has already chosen
 * the prize by the time anything here moves — so the spin runs for a fixed,
 * satisfying moment and then reveals what was always going to be revealed.
 * Pretending otherwise would mean the browser choosing, and the browser is
 * not a place to decide who gets a game worth money.
 */
export function WheelPage() {
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  /*
    Nothing is deducted until this has been answered. Buying a ticket spends
    real bananas the member worked for, and a single tap on a button that sits
    directly under the wheel is not consent to spend them.
  */
  const [confirmingPurchase, setConfirmingPurchase] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["wheel-summary"],
    queryFn: () => api.fetch<WheelState>("/api/wheel"),
    retry: false,
  });

  /*
    Buying a ticket. The price is NOT sent — the server reads its own setting —
    so this can only ever ask for a quantity.
  */
  const buy = useMutation({
    mutationFn: (quantity: number) =>
      api.fetch<PurchaseResult>("/api/wheel", {
        method: "POST",
        body: JSON.stringify({
          action: "buy_ticket",
          quantity,
          /*
            One id per press. A network retry of this same press carries it
            again and costs once; pressing the button a second time is a second
            purchase and carries a new one.
          */
          requestId: crypto.randomUUID(),
        }),
      }),
    onSuccess: () => {
      setConfirmingPurchase(false);
      /*
        `["wheel-summary"]`, which is the key this page's query actually uses.
        `["wheel"]` matched nothing, so a bought ticket never appeared and the
        member was left looking at the same «اشترِ تذكرة» button they had just
        pressed — and would reasonably press again.
      */
      void queryClient.invalidateQueries({ queryKey: ["wheel-summary"] });
      /*
        The wallet is shown in several places at once; the chip above is only
        one of them. Whatever else reads the balance should see the new one.
      */
      void queryClient.invalidateQueries({ queryKey: ["banana-summary"] });
    },
  });

  const spin = useMutation({
    mutationFn: () => api.fetch<SpinResult>("/api/wheel", { method: "POST", body: "{}" }),
    onMutate: () => {
      setResult(null);
      setSpinning(true);
      playSound("hover", 0.5);
    },
    onSuccess: async (outcome) => {
      /*
        Let the wheel turn before the answer lands. The result is already in
        hand; holding it for a moment is the difference between a game and a
        form submission.
      */
      await new Promise((wake) => setTimeout(wake, reduceMotion ? 300 : 2600));
      setSpinning(false);
      setResult(outcome);
      playSound("bumper_end", 0.7);
      void queryClient.invalidateQueries({ queryKey: ["wheel-summary"] });
    },
    onError: (failure: unknown) => {
      setSpinning(false);
      toast.error(failure instanceof Error ? failure.message : tr("تعذر تدوير العجلة"));
      void queryClient.invalidateQueries({ queryKey: ["wheel-summary"] });
    },
  });

  /*
    Escape closes it, as every dialog on the web should — but not while the
    purchase is in flight, because closing then would hide the outcome of a
    charge that is already happening.
  */
  const purchasePending = buy.isPending;
  useEffect(() => {
    if (!confirmingPurchase) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !purchasePending) setConfirmingPurchase(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmingPurchase, purchasePending]);

  const tickets = data?.tickets ?? 0;
  const ticketPrice = Number(data?.ticketPriceBananas ?? 0);
  const bananas = Number(data?.bananas ?? 0);
  const affordable = ticketPrice > 0 && bananas >= ticketPrice;
  const remainingAfter = Math.max(0, bananas - ticketPrice);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6" dir="rtl">
      {/*
        The balance, where the member can see it before they decide.

        This screen asks for bananas and never said how many there were, so
        deciding whether to buy a ticket meant leaving the wheel to go and look.
        `justify-start` inside a `dir="rtl"` page puts it at the TOP RIGHT,
        which is where the owner asked for it and where the eye starts reading.
      */}
      {!error && !isLoading ? (
        <div className="mb-3 flex justify-start">
          <Link
            to="/banana_redeem"
            aria-label={`${tr("رصيدك")}: ${bananas.toLocaleString("en-US")} ${tr("موزة")}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[12px] font-black text-foreground transition-colors hover:border-amber-500/60"
          >
            <span aria-hidden="true">🍌</span>
            <span className="tabular-nums">{bananas.toLocaleString("en-US")}</span>
            <span className="font-bold text-muted-foreground">{tr("موزة")}</span>
          </Link>
        </div>
      ) : null}

      <header className="mb-5 space-y-1.5 text-center">
        <h1 className="text-2xl font-black tracking-[-0.02em] text-foreground">
          {tr("عجلة الحظ")}
        </h1>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {tr("تذكرة واحدة = دورة واحدة. الجائزة لعبة من المتجر.")}
        </p>
      </header>

      {error ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-center">
          <p className="text-sm font-bold text-foreground">{tr("سجّل الدخول للعب")}</p>
          <Link
            to="/auth"
            className="mt-3 inline-block rounded-xl bg-foreground px-5 py-2.5 text-xs font-bold text-background"
          >
            {tr("تسجيل الدخول")}
          </Link>
        </div>
      ) : isLoading ? (
        <div className="flex h-60 items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          <div className="relative mx-auto mb-5 flex h-64 w-64 items-center justify-center">
            {/* The rim. Purely decorative — the segments are not the outcome. */}
            <motion.div
              className="absolute inset-0 rounded-full border-[10px] border-amber-500/30 bg-gradient-to-br from-amber-400/20 via-card to-card shadow-inner"
              animate={spinning && !reduceMotion ? { rotate: 360 * 6 } : { rotate: 0 }}
              transition={
                spinning && !reduceMotion
                  ? { duration: 2.6, ease: [0.16, 0.9, 0.2, 1] }
                  : { duration: 0.3 }
              }
            >
              {Array.from({ length: 12 }, (_, index) => (
                <span
                  key={index}
                  aria-hidden="true"
                  className="absolute left-1/2 top-1/2 h-1/2 w-px origin-top bg-amber-500/25"
                  style={{ transform: `rotate(${index * 30}deg)` }}
                />
              ))}
            </motion.div>

            <div className="relative z-10 flex h-28 w-28 flex-col items-center justify-center rounded-full border border-border bg-card shadow-lg">
              {spinning ? (
                <Loader2 className="h-7 w-7 animate-spin text-amber-500" />
              ) : (
                <>
                  <Ticket className="h-6 w-6 text-amber-500" />
                  <span className="mt-1 text-xl font-black text-foreground">{tickets}</span>
                  <span className="text-[10px] font-bold text-muted-foreground">{tr("تذكرة")}</span>
                </>
              )}
            </div>
          </div>

          {tickets > 0 ? (
            <button
              type="button"
              onClick={() => spin.mutate()}
              disabled={spinning || spin.isPending}
              className="mx-auto flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-amber-500 px-6 py-3.5 text-sm font-black text-amber-950 transition-transform active:scale-[0.98] disabled:opacity-50"
            >
              <Gift className="h-4 w-4" />
              {spinning ? tr("تدور...") : tr("دوّر العجلة")}
            </button>
          ) : (
            <div className="mx-auto max-w-sm space-y-2.5 text-center">
              {/*
                One button when the owner has set a price, and the redemption
                screen when they have not. A price of zero is not a free
                ticket — it means tickets are not on sale — so the button is
                not offered rather than offered and refused.
              */}
              {ticketPrice > 0 ? (
                <>
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                    {tr("لا توجد لديك تذاكر. التذكرة الواحدة بـ")}{" "}
                    <span className="font-black text-foreground">
                      {ticketPrice.toLocaleString("en-US")}
                    </span>{" "}
                    {tr("موزة")}.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      // A failure from a previous attempt is not this one's news.
                      buy.reset();
                      setConfirmingPurchase(true);
                    }}
                    disabled={buy.isPending}
                    className="inline-block rounded-2xl bg-foreground px-6 py-3 text-[13px] font-bold text-background disabled:opacity-50"
                  >
                    {buy.isPending ? tr("...") : tr("اشترِ تذكرة")}
                  </button>
                  {buy.isError ? (
                    <p className="text-[12px] font-bold text-red-500">
                      {buy.error instanceof Error && buy.error.message
                        ? buy.error.message
                        : tr("تعذّر الشراء")}
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                    {tr("لا توجد لديك تذاكر. التذاكر تُشترى بالموز من شاشة الاسترداد.")}
                  </p>
                  <Link
                    to="/banana_redeem"
                    className="inline-block rounded-2xl bg-foreground px-6 py-3 text-[13px] font-bold text-background"
                  >
                    {tr("استبدل الموز بتذكرة")}
                  </Link>
                </>
              )}
            </div>
          )}

          {/*
            Nothing is deducted until this is answered.

            The owner asked for a confirmation before the bananas go, and the
            reason is plain enough on the screen it guards: «اشترِ تذكرة» sits
            directly beneath the wheel, one thumb-width from «دوّر العجلة», and
            it spends a balance the member earned. So the dialog states the
            price, the balance and what is left afterwards — the three figures
            someone needs to say yes — and the mutation is not called until
            they do.

            The figures are the server's. The chip and this dialog read the
            same `bananas` the purchase itself debits, so they cannot disagree
            with the charge.
          */}
          <AnimatePresence>
            {confirmingPurchase ? (
              <motion.div
                className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                role="presentation"
                onClick={() => {
                  if (!buy.isPending) setConfirmingPurchase(false);
                }}
              >
                <motion.div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="wheel-buy-title"
                  dir="rtl"
                  className="w-full max-w-sm space-y-4 rounded-3xl border border-border bg-card p-5 shadow-2xl"
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
                  transition={
                    reduceMotion
                      ? { duration: 0.15 }
                      : { type: "spring", bounce: 0, visualDuration: 0.3 }
                  }
                  onClick={(event) => event.stopPropagation()}
                >
                  <h2
                    id="wheel-buy-title"
                    className="text-center text-base font-black text-foreground"
                  >
                    {tr("تأكيد شراء التذكرة")}
                  </h2>

                  <dl className="space-y-2 rounded-2xl bg-muted/40 p-3.5 text-[13px]">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="font-bold text-muted-foreground">{tr("سعر التذكرة")}</dt>
                      <dd className="font-black tabular-nums text-foreground">
                        {ticketPrice.toLocaleString("en-US")} {tr("موزة")}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="font-bold text-muted-foreground">{tr("رصيدك الآن")}</dt>
                      <dd className="font-black tabular-nums text-foreground">
                        {bananas.toLocaleString("en-US")} {tr("موزة")}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
                      <dt className="font-bold text-muted-foreground">{tr("الرصيد بعد الشراء")}</dt>
                      <dd className="font-black tabular-nums text-foreground">
                        {affordable ? remainingAfter.toLocaleString("en-US") : "—"}{" "}
                        {affordable ? tr("موزة") : ""}
                      </dd>
                    </div>
                  </dl>

                  {affordable ? null : (
                    <p className="text-center text-[12px] font-bold text-red-500">
                      {tr("رصيد الموز لا يكفي.")}
                    </p>
                  )}

                  {buy.isError ? (
                    <p className="text-center text-[12px] font-bold text-red-500">
                      {buy.error instanceof Error && buy.error.message
                        ? buy.error.message
                        : tr("تعذّر الشراء")}
                    </p>
                  ) : null}

                  <div className="flex gap-2.5">
                    <button
                      type="button"
                      onClick={() => setConfirmingPurchase(false)}
                      disabled={buy.isPending}
                      className="flex-1 rounded-2xl border border-border bg-background px-4 py-3 text-[13px] font-bold text-foreground disabled:opacity-50"
                    >
                      {tr("إلغاء")}
                    </button>
                    <button
                      type="button"
                      onClick={() => buy.mutate(1)}
                      disabled={buy.isPending || !affordable}
                      className="flex-1 rounded-2xl bg-amber-500 px-4 py-3 text-[13px] font-black text-amber-950 transition-transform active:scale-[0.98] disabled:opacity-50"
                    >
                      {buy.isPending ? tr("...") : tr("تأكيد الشراء")}
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {result?.ok && !result.prize ? (
              <motion.div
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", bounce: 0.2, visualDuration: 0.4 }}
                className="mt-6 space-y-2 rounded-3xl border border-border bg-muted/40 p-5 text-center"
              >
                {/*
                  A spin that won nothing still happened, and the ticket is
                  spent. Saying so is the whole of the honesty here: without
                  this block the member pressed the button, watched their
                  ticket disappear and was shown an empty screen.
                */}
                <p className="text-sm font-black text-foreground">
                  {tr("حظ أوفر في المرة القادمة")}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  {tr("لم تربح هذه المرة. التذكرة استُخدمت.")}
                </p>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {result?.ok && result.prize ? (
              <motion.div
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", bounce: 0.2, visualDuration: 0.4 }}
                className="mt-6 space-y-3 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center"
              >
                <p className="text-sm font-black text-emerald-800 dark:text-emerald-300">
                  {tr("مبروك! ربحت")}
                </p>
                <p className="text-base font-bold text-foreground">{result.prize.title}</p>
                {/*
                  The prize IS the order. Nothing to copy, nothing to spend,
                  nothing to do before a date — «يتم عمل طلب لا مباشرة». The
                  coupon below is the fallback for a win whose order could not
                  be written, and a member sees one or the other, never both.
                */}
                {result.giftOrder ? (
                  <>
                    <p className="text-[12px] text-muted-foreground">
                      {tr("أنشأنا لك طلب الهدية. سعرها")}{" "}
                      <span className="font-black text-foreground">{tr("صفر دينار")}</span>{" "}
                      {tr("ولا حاجة لأي دفع.")}
                    </p>
                    <p className="rounded-xl bg-background px-4 py-2.5 font-mono text-base font-black tracking-widest text-foreground">
                      {result.giftOrder.code}
                    </p>
                    <Link
                      to="/orders/$orderId"
                      params={{ orderId: result.giftOrder.orderId }}
                      className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-foreground px-5 py-2.5 text-[13px] font-bold text-background"
                    >
                      <Gift className="h-4 w-4" />
                      {tr("افتح طلب الهدية")}
                    </Link>
                  </>
                ) : result.couponCode ? (
                  <>
                    <p className="text-[12px] text-muted-foreground">
                      {tr("استخدم هذا الكود عند الشراء ليصبح سعر اللعبة صفراً:")}
                    </p>
                    <p className="select-all rounded-xl bg-background px-4 py-2.5 font-mono text-lg font-black tracking-widest text-foreground">
                      {result.couponCode}
                    </p>
                    <p className="text-[11px] font-bold text-muted-foreground">
                      {tr("صالح حتى")} {shortDate(result.expiresAt ?? null)}
                    </p>
                  </>
                ) : null}
              </motion.div>
            ) : null}
          </AnimatePresence>

          {data?.odds?.length ? (
            <section className="mt-8 space-y-2">
              <h2 className="text-[13px] font-bold text-foreground">{tr("الفرص")}</h2>
              {/*
                Stated, not hidden. A wheel that will not say what the chances
                are is one nobody should trust, and these are counted from the
                catalogue as it stands rather than promised.
              */}
              <ul className="space-y-1.5">
                {data.odds
                  /*
                    A band with no games in it is noise; «حظ أوفر» has no games
                    BY DEFINITION and is the one row a member most needs to
                    see. Filtering on `games > 0` alone hid it, and the
                    percentages on screen then did not add up to a hundred with
                    nothing to explain the gap.
                  */
                  .filter((tier) => tier.games > 0 || tier.chance > 0)
                  .map((tier, index) => {
                    // A price band, or the losing segment, which is not a price.
                    const isPrice = tier.games > 0 || /[0-9]/.test(tier.label);
                    return (
                      <li
                        /*
                          By position. A label stops being unique the moment an
                          admin can rename a band, and two rows sharing a key
                          is how React starts showing one band's numbers under
                          another band's name.
                        */
                        key={`${index}-${tier.label}`}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2 text-[12px]"
                      >
                        <span className="font-bold text-foreground" dir={isPrice ? "ltr" : "rtl"}>
                          {tier.label}
                          {isPrice ? ` ${tr("دينار")}` : ""}
                        </span>
                        <span className="text-muted-foreground">
                          {tier.games > 0 ? `${tier.games} ${tr("لعبة")} · ` : ""}
                          {tier.chance >= 0.001
                            ? `${(tier.chance * 100).toFixed(1)}%`
                            : tr("نادرة جداً")}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </section>
          ) : null}

          {data?.spins?.length ? (
            <section className="mt-8 space-y-2">
              <h2 className="text-[13px] font-bold text-foreground">{tr("جوائزك السابقة")}</h2>
              <ul className="space-y-1.5">
                {data.spins.map((won) => (
                  <li
                    key={won.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2 text-[12px]"
                  >
                    <span className="min-w-0 truncate font-bold text-foreground">
                      {won.product_title}
                    </span>
                    {won.coupon_code ? (
                      <span className="select-all shrink-0 font-mono text-[11px] font-bold text-amber-600 dark:text-amber-400">
                        {won.coupon_code}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
