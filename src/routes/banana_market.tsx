import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { RewardsShelf } from "@/components/market/RewardsShelf";
import { SellBananasSheet } from "@/components/market/SellBananasSheet";
import { TicketShop } from "@/components/market/TicketShop";
import { useAuth } from "@/hooks/useAuth";
import { useBananaMarket } from "@/hooks/useBananaMarket";
import { useRoulette } from "@/hooks/useRoulette";
import { formatPrice } from "@/lib/banana-price";
import { lazyWithRetry } from "@/lib/lazyRetry";

const BananaPriceChart = lazyWithRetry(() => import("@/components/BananaPriceChart"));

/**
 * سوق الموز — one page, three things a member can do.
 *
 * The owner removed the marketplace outright and made the rest a single scroll:
 *
 *   «سوق الموز الجديد يحتوي فقط على 3 وظائف رئيسية: بيع الموز مباشرة للنظام
 *    بسعر السوق الحالي · شراء/استبدال الموز بتذاكر الروليت · استبدال الموز
 *    بالهدايا والمكافآت.»
 *
 *   «لا تقسم تجربة سوق الموز إلى صفحات مستقلة… لا تجعل المستخدم ينتقل إلى
 *    banana_buy أو banana_redeem أو صفحات فرعية لتنفيذ هذه العمليات.»
 *
 * So everything happens here. Selling opens a sheet over this page, buying
 * tickets is inline, redeeming is a confirmation on the shelf below — and the
 * URL never changes to do any of it. The two old routes still exist and now
 * send a visitor to the right section of this one, because links to them are
 * out in the world and a dead link is a worse answer than a redirect.
 *
 * WHAT IS GONE, AND WHAT IS ONLY CLOSED. The listing UI is gone: no offers, no
 * «عروضي النشطة», no promotion, no private listings, no bots to buy from.
 * `create_listing` and `update_listing` are refused by the API. But nothing is
 * deleted — every offer ever made is still in `banana_market_offers`, and an
 * offer still standing can still be cancelled by its owner. «لا تحذف بيانات
 * الإنتاج بشكل أعمى.»
 */

export const Route = createFileRoute("/banana_market")({
  head: () => ({
    meta: [
      { title: "سوق الموز — بنانتو" },
      {
        name: "description",
        content: "بِع موزك للمتجر بسعر السوق، أو بدّله بتذاكر الروليت وبالهدايا.",
      },
      { property: "og:title", content: "سوق الموز — بنانتو" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: BananaMarketPage,
});

const RANGES = ["1H", "4H", "12H", "1D", "7D"] as const;

const money = (n: number) => Number(n || 0).toLocaleString("en-US");

/**
 * The chart's tooltip.
 *
 * Recharts clones this element and passes it `active` and `payload`, so it is
 * given as an element rather than a component — which is what the chart's own
 * prop type asks for.
 */
function PriceTooltip({ active, payload }: { active?: boolean; payload?: { value?: number }[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-2 py-1 text-[11px] shadow-sm">
      <span dir="ltr" className="font-bold tabular-nums text-foreground">
        {formatPrice(Number(payload[0]?.value ?? 0))}
      </span>
      <span className="text-muted-foreground"> د.ع</span>
    </div>
  );
}

function BananaMarketPage() {
  const { user } = useAuth();
  const [range, setRange] = useState<string>("1D");
  const { snapshot, isPending, act, refresh: refreshMarket } = useBananaMarket(range);
  /*
    The roulette's own state, for the ticket shop only. One ticket is the
    cheapest question to ask of `/api/roulette`, and the ticket balance and
    price are the same at every count.
  */
  const { state: roulette, refresh: refreshRoulette } = useRoulette(1);

  const [sellOpen, setSellOpen] = useState(false);
  const rewardsRef = useRef<HTMLDivElement | null>(null);
  const ticketsRef = useRef<HTMLDivElement | null>(null);

  const price = snapshot?.price ?? 0;
  const bananas = snapshot?.balance ?? 0;
  const changePct = snapshot?.changePct ?? 0;
  const rewards = useMemo(() => snapshot?.rewards ?? [], [snapshot?.rewards]);

  /*
    «يمكن استخدام anchors داخل الصفحة فقط عند الحاجة… الضغط على الاستبدال يعمل
    smooth scroll إلى Rewards section» — a scroll, not a navigation, so the URL
    stays put and the back button still means what it meant.
  */
  const scrollTo = useCallback((ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const onSell = useCallback(
    async (quantity: number, requestId: string) => {
      try {
        const answer = (await act.mutateAsync({
          action: "sell_bananas",
          quantity,
          requestId,
        })) as unknown as {
          sale?: { quantity: number; pricePerBanana: number; proceeds: number };
        };
        const sale = answer?.sale;
        if (!sale) return { ok: false as const, error: "تعذّر قراءة نتيجة البيع" };
        return {
          ok: true as const,
          quantity: sale.quantity,
          pricePerBanana: sale.pricePerBanana,
          proceeds: sale.proceeds,
        };
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : "تعذّر إتمام البيع",
        };
      }
    },
    [act],
  );

  const onBuyTickets = useCallback(
    async (quantity: number, requestId: string) => {
      try {
        const res = await fetch("/api/wheel", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "buy_ticket", quantity, requestId }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          tickets?: number;
          error?: string;
        };
        if (!res.ok) return { ok: false as const, error: data.error || "تعذّر شراء التذاكر" };
        /*
          Both balances move on a ticket purchase — bananas out, tickets in —
          and they live in two different queries, so both are told to refetch.
          A screen that updated one of them would show a member paying for
          something that never arrived.
        */
        refreshRoulette();
        refreshMarket();
        return { ok: true as const, tickets: Number(data.tickets ?? 0) };
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : "تعذّر شراء التذاكر",
        };
      }
    },
    [refreshMarket, refreshRoulette],
  );

  const onRedeem = useCallback(
    async (rewardId: string) => {
      try {
        await act.mutateAsync({ action: "redeem_reward", rewardId });
        refreshRoulette();
        return { ok: true as const };
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : "تعذّر الاستبدال",
        };
      }
    },
    [act, refreshRoulette],
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-4" dir="rtl">
      {/* ───────────────────────────── Header ───────────────────────────── */}
      <header className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold text-foreground">سوق الموز</h1>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            بِع موزك للمتجر مباشرة، أو بدّله بتذاكر وهدايا.
          </p>
        </div>
        <div className="shrink-0 rounded-2xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-left">
          <div className="text-[11px] text-muted-foreground">رصيدك</div>
          <div dir="ltr" className="text-sm font-extrabold tabular-nums text-foreground">
            🍌 {money(bananas)}
          </div>
        </div>
      </header>

      {/* ────────────────────────── Market price ────────────────────────── */}
      <section className="rounded-2xl border border-border/60 bg-card p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">سعر موزة واحدة</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span dir="ltr" className="text-lg font-extrabold tabular-nums text-foreground">
                {formatPrice(price)}
              </span>
              <span className="text-[11px] text-muted-foreground">د.ع</span>
              <span
                dir="ltr"
                className={`inline-flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                  changePct < 0 ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"
                }`}
              >
                {changePct < 0 ? (
                  <TrendingDown className="h-3 w-3" />
                ) : (
                  <TrendingUp className="h-3 w-3" />
                )}
                {changePct > 0 ? "+" : ""}
                {changePct}%
              </span>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> السوق مباشر
          </span>
        </div>

        <div className="mt-3 flex gap-1 overflow-x-auto">
          {RANGES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              aria-pressed={range === option}
              className={`min-h-[36px] shrink-0 rounded-xl px-3 text-xs font-bold tabular-nums transition ${
                range === option
                  ? "bg-foreground text-background"
                  : "bg-muted/60 text-muted-foreground"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="mt-2 h-40">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            }
          >
            <BananaPriceChart data={snapshot?.chart ?? []} tooltip={<PriceTooltip />} />
          </Suspense>
        </div>
      </section>

      {/* ──────────────────────────── Actions ───────────────────────────── */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => setSellOpen(true)}
          className="min-h-[52px] rounded-2xl bg-foreground text-sm font-extrabold text-background"
        >
          بيع الموز
        </button>
        <button
          type="button"
          onClick={() => scrollTo(ticketsRef)}
          className="min-h-[52px] rounded-2xl border border-border bg-card text-sm font-extrabold text-foreground"
        >
          التذاكر
        </button>
        <button
          type="button"
          onClick={() => scrollTo(rewardsRef)}
          className="min-h-[52px] rounded-2xl border border-border bg-card text-sm font-extrabold text-foreground"
        >
          الاستبدال
        </button>
      </div>

      {/* ───────────────────────── Tickets / roulette ───────────────────── */}
      <div ref={ticketsRef} className="scroll-mt-4">
        <TicketShop
          tickets={roulette?.tickets ?? 0}
          bananas={bananas}
          ticketPriceBananas={roulette?.ticketPriceBananas ?? 0}
          onBuy={onBuyTickets}
        />
        <Link
          to="/wheel"
          className="mt-2 flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-border bg-card text-sm font-extrabold text-foreground"
        >
          🎰 افتح الروليت
          {roulette?.tickets ? (
            <span dir="ltr" className="rounded-lg bg-muted px-2 py-0.5 text-xs tabular-nums">
              {roulette.tickets} تذكرة
            </span>
          ) : null}
        </Link>
      </div>

      {/* ──────────────────────────── Rewards ───────────────────────────── */}
      <div ref={rewardsRef} className="scroll-mt-4">
        <RewardsShelf rewards={rewards} bananas={bananas} onRedeem={onRedeem} />
      </div>

      {!user ? (
        <p className="mt-4 rounded-2xl bg-muted/50 p-3 text-center text-xs text-muted-foreground">
          سجّل الدخول لتتمكن من البيع والاستبدال.
        </p>
      ) : null}

      {isPending && !snapshot ? (
        <div className="mt-6 flex justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : null}

      <SellBananasSheet
        open={sellOpen}
        onClose={() => setSellOpen(false)}
        balance={bananas}
        pricePerBanana={price}
        enabled={snapshot?.directSellEnabled !== false}
        minQuantity={snapshot?.minSellQuantity ?? 100}
        onSell={async (quantity, requestId) => {
          const answer = await onSell(quantity, requestId);
          if (answer.ok) toast.success("تم البيع ✅");
          return answer;
        }}
      />
    </div>
  );
}
