import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { RewardsShelf } from "@/components/market/RewardsShelf";
import { SellBananasSheet } from "@/components/market/SellBananasSheet";
import { TicketShop } from "@/components/market/TicketShop";
import { useAuth } from "@/hooks/useAuth";
import { useBananaMarket } from "@/hooks/useBananaMarket";
import { useRoulette } from "@/hooks/useRoulette";
import { formatPrice } from "@/lib/banana-price";
import { lazyWithRetry } from "@/lib/lazyRetry";
import { playSound } from "@/utils/audio";

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
 *
 * ## The shape of the page
 *
 * One thing is loud and everything else is quiet. The price is the market —
 * it is the only number that changes on its own, the only one a member opens
 * this page to look at — so it gets the size, the chart gets a frame it can
 * actually fill, and the three actions below it are one row of equal
 * segments rather than three buttons arguing about which is the important
 * one. Under that, one card per section and air between them. Nothing here
 * is nested inside anything else it does not belong to.
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
    <div className="rounded-xl border border-border bg-card px-2.5 py-1.5 text-[11px] shadow-lg">
      <span dir="ltr" className="font-black tabular-nums tracking-tight text-foreground">
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
  const down = changePct < 0;

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
        if (!res.ok) {
          playSound("error", 0.5);
          return { ok: false as const, error: data.error || "تعذّر شراء التذاكر" };
        }
        /*
          Both balances move on a ticket purchase — bananas out, tickets in —
          and they live in two different queries, so both are told to refetch.
          A screen that updated one of them would show a member paying for
          something that never arrived.
        */
        refreshRoulette();
        refreshMarket();
        playSound("turn_on", 0.55);
        return { ok: true as const, tickets: Number(data.tickets ?? 0) };
      } catch (error) {
        playSound("error", 0.5);
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
        playSound("turn_on", 0.55);
        return { ok: true as const };
      } catch (error) {
        playSound("error", 0.5);
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
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[19px] font-black tracking-[-0.02em] text-foreground">سوق الموز</h1>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            بِع موزك للمتجر مباشرة، أو بدّله بتذاكر وهدايا.
          </p>
        </div>
        <p className="flex shrink-0 items-center gap-1.5 rounded-full border border-banana/30 bg-banana/15 px-3 py-1.5 text-[13px] font-black text-foreground">
          <span aria-hidden="true">🍌</span>
          <span dir="ltr" className="tabular-nums">
            {money(bananas)}
          </span>
        </p>
      </header>

      {/* ──────────────────────── The price, in full ─────────────────────
          The one element on the page worth being loud about: the number, what
          it did, that it is live, and the shape it made getting here. */}
      <section
        aria-labelledby="market-price-title"
        className="mt-4 rounded-3xl border border-border bg-card p-4 shadow-soft"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="market-price-title" className="text-[12px] font-bold text-muted-foreground">
              سعر موزة واحدة
            </h2>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span
                dir="ltr"
                className="text-[32px] font-black leading-none tracking-[-0.04em] tabular-nums text-foreground"
              >
                {formatPrice(price)}
              </span>
              <span className="text-[12px] font-bold text-muted-foreground">د.ع</span>
              <span
                dir="ltr"
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-black tabular-nums ${
                  down ? "bg-rind/15 text-rind" : "bg-leaf/15 text-leaf"
                }`}
              >
                {down ? (
                  <TrendingDown className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <TrendingUp className="h-3 w-3" aria-hidden="true" />
                )}
                {changePct > 0 ? "+" : ""}
                {changePct}%
              </span>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-leaf/10 px-2.5 py-1 text-[11px] font-black text-leaf">
            <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-leaf opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-leaf" />
            </span>
            السوق مباشر
          </span>
        </div>

        {/* A frame the line can fill, rather than a tall box with a line in it. */}
        <div className="-mx-1 mt-3 h-[132px]">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              </div>
            }
          >
            <BananaPriceChart data={snapshot?.chart ?? []} tooltip={<PriceTooltip />} />
          </Suspense>
        </div>

        {/* One control with five segments, not five pills that drift apart. */}
        <div
          role="group"
          aria-label="مدة الرسم البياني"
          className="mt-3 flex gap-0.5 rounded-2xl bg-muted/70 p-1"
        >
          {RANGES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                playSound("klick", 0.4);
                setRange(option);
              }}
              aria-pressed={range === option}
              className={`min-h-11 flex-1 rounded-xl text-[12px] font-black tabular-nums transition-colors ${
                range === option
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </section>

      {/* ──────────────────────────── Actions ────────────────────────────
          Three doors of equal width and equal weight. The one that spends
          nothing and earns dinars is filled rather than shaped differently. */}
      <div
        role="group"
        aria-label="إجراءات السوق"
        className="mt-4 grid grid-cols-3 gap-1 rounded-2xl border border-border bg-card p-1"
      >
        <button
          type="button"
          onClick={() => {
            playSound("klick", 0.45);
            setSellOpen(true);
          }}
          className="min-h-12 rounded-xl bg-banana text-[13px] font-black text-banana-ink transition-colors active:bg-peel"
        >
          بيع الموز
        </button>
        <button
          type="button"
          onClick={() => {
            playSound("klick", 0.45);
            scrollTo(ticketsRef);
          }}
          className="min-h-12 rounded-xl text-[13px] font-black text-foreground transition-colors hover:bg-muted/70"
        >
          التذاكر
        </button>
        <button
          type="button"
          onClick={() => {
            playSound("klick", 0.45);
            scrollTo(rewardsRef);
          }}
          className="min-h-12 rounded-xl text-[13px] font-black text-foreground transition-colors hover:bg-muted/70"
        >
          الاستبدال
        </button>
      </div>

      {/* ───────────────────────── Tickets / roulette ───────────────────── */}
      <div ref={ticketsRef} className="mt-7 scroll-mt-4">
        <TicketShop
          tickets={roulette?.tickets ?? 0}
          bananas={bananas}
          ticketPriceBananas={roulette?.ticketPriceBananas ?? 0}
          onBuy={onBuyTickets}
        />
        {/* A way out of the section, not a fourth card competing with it. */}
        <Link
          to="/wheel"
          data-ui-sound="klick"
          className="mt-2 flex min-h-12 items-center justify-center gap-2 rounded-2xl text-[13px] font-black text-foreground transition-colors hover:bg-muted/60"
        >
          🎰 افتح الروليت
          {roulette?.tickets ? (
            /* The count reads LTR; the word it counts stays in the sentence. */
            <span className="rounded-lg bg-muted px-2 py-0.5 text-[12px] font-bold">
              <span dir="ltr" className="tabular-nums">
                {roulette.tickets}
              </span>{" "}
              تذكرة
            </span>
          ) : null}
          <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </Link>
      </div>

      {/* ──────────────────────────── Rewards ───────────────────────────── */}
      <div ref={rewardsRef} className="mt-7 scroll-mt-4">
        <RewardsShelf rewards={rewards} bananas={bananas} onRedeem={onRedeem} />
      </div>

      {!user ? (
        <p className="mt-6 text-center text-[12px] font-bold text-muted-foreground">
          سجّل الدخول لتتمكن من البيع والاستبدال.
        </p>
      ) : null}

      {isPending && !snapshot ? (
        <div className="mt-6 flex justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />
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
          if (answer.ok) {
            playSound("bumper_end", 0.6);
            toast.success("تم البيع ✅");
          } else {
            playSound("error", 0.5);
          }
          return answer;
        }}
      />
    </div>
  );
}
