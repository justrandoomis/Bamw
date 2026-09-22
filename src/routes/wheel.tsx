import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { RouletteStrip, type RouletteCard } from "@/components/roulette/RouletteStrip";
import {
  pressId,
  useRoulette,
  type RoulettePrizeData,
  type SpinResponse,
} from "@/hooks/useRoulette";
import { playSound } from "@/utils/audio";

/**
 * The roulette.
 *
 * The owner replaced the circular wheel outright: «ألغِ تصميم العجلة الدائرية
 * الحالي. استبدله بـ Horizontal Case Opening Roulette».
 *
 * Three rules shape this screen and none of them are cosmetic.
 *
 * THE SERVER DECIDES, THE STRIP SHOWS. The press sends a ticket count and an
 * id; the answer comes back complete — won or lost, and which game — and only
 * then does anything move. «الفائز معروف مسبقاً من استجابة السيرفر
 * والAnimation فقط تعرضه.»
 *
 * A WIN IS NOT AN ORDER. It is an entitlement sitting in «ألعابك القابلة
 * للاستيراد» until the member presses «استيراد». Nothing is ordered, prepared
 * or owed before that.
 *
 * THE PICTURE IS THE RIGHT GAME'S OR THERE IS NO PICTURE. A card with no
 * square art prints its name on a plain tile. Never a hero, never a sequel,
 * never «close enough» — a wrong picture on a prize is the shop telling a
 * member they won a different game.
 */

export const Route = createFileRoute("/wheel")({
  head: () => ({
    meta: [
      { title: "روليت بنانتو" },
      {
        name: "description",
        content: "اختر عدد التذاكر ودوّر الروليت لتربح لعبة من متجر بنانتو، ثم استوردها متى شئت.",
      },
      { property: "og:title", content: "روليت بنانتو" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: RoulettePage,
});

const money = (n: number) => Number(n || 0).toLocaleString("en-US");

/** One of the three numbers the owner asked to see at the top of the screen. */
function Balance({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className={`flex flex-1 items-center gap-2 rounded-2xl border border-border/60 px-3 py-2.5 ${tone}`}>
      <span aria-hidden className="text-lg leading-none">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[11px] text-muted-foreground">{label}</div>
        <div dir="ltr" className="text-sm font-extrabold tabular-nums text-foreground">
          {money(value)}
        </div>
      </div>
    </div>
  );
}

export function RoulettePage() {
  const [tickets, setTickets] = useState(1);
  const { state, isPending, spin, importPrize, refresh } = useRoulette(tickets);

  /*
    The outcome the strip is running to, and the popup that follows it.

    They are separate pieces of state on purpose: the answer exists the moment
    the request resolves, and the popup must not appear until the strip has
    actually stopped on it. Showing the prize while the cards are still moving
    would make the animation decoration on top of a result the member has
    already read.
  */
  const [outcome, setOutcome] = useState<{ runId: string; card: RouletteCard | null } | null>(null);
  const [result, setResult] = useState<SpinResponse | null>(null);
  const [showResult, setShowResult] = useState(false);

  const maxTickets = state?.maxTicketsPerSpin ?? 10;
  const affordable = (state?.tickets ?? 0) >= tickets;
  const strip: RouletteCard[] = useMemo(
    () => (state?.strip ?? []).map((card) => ({ id: card.id, title: card.title, image: card.image })),
    [state?.strip],
  );

  /* Never leave the selector pointing at more tickets than the shop allows. */
  useEffect(() => {
    if (tickets > maxTickets) setTickets(maxTickets);
  }, [maxTickets, tickets]);

  const onSpin = useCallback(() => {
    if (spin.isPending || outcome) return;
    void spin
      .mutateAsync(tickets)
      .then((answer) => {
        setResult(answer);
        /*
          A LOSS STILL RUNS THE STRIP. The member paid for a spin and is owed
          the spin — stopping the cards dead on a loss would make losing feel
          like a failure of the machine rather than an outcome of it.
        */
        const card: RouletteCard | null = answer.won && answer.prize
          ? {
              id: answer.prize.productId,
              title: answer.prize.productTitle,
              image: answer.prize.productImage,
            }
          : null;
        setOutcome({ runId: answer.spinId || pressId("run"), card });
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : "تعذّر تنفيذ الدورة");
      });
  }, [outcome, spin, tickets]);

  const onSettled = useCallback(() => {
    setShowResult(true);
    if (result?.won) void playSound("success");
  }, [result?.won]);

  const closeResult = useCallback(() => {
    setShowResult(false);
    setOutcome(null);
    setResult(null);
    refresh();
  }, [refresh]);

  const available = (state?.prizes ?? []).filter((prize) => prize.status === "available");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-4" dir="rtl">
      <header className="mb-4">
        <h1 className="text-xl font-extrabold text-foreground">روليت بنانتو</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          اختر عدد التذاكر، ثم دوّر. كلما زادت التذاكر تحسّنت فرصك.
        </p>
      </header>

      {/* «اعرض 3 أرصدة واضحة» — and they update without a full refresh. */}
      <div className="mb-4 flex gap-2">
        <Balance icon="🍌" label="الموز" value={state?.bananas ?? 0} tone="bg-amber-50/60" />
        <Balance icon="🎟" label="التذاكر" value={state?.tickets ?? 0} tone="bg-sky-50/60" />
        <Balance icon="🎁" label="جاهزة للاستيراد" value={available.length} tone="bg-emerald-50/60" />
      </div>

      <section className="rounded-2xl border border-border/60 bg-card p-3">
        {isPending && !state ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : strip.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            لا توجد ألعاب متاحة في الروليت الآن.
          </p>
        ) : (
          <RouletteStrip cards={strip} outcome={outcome} onSettled={onSettled} />
        )}

        {/* «قبل تشغيل الروليت يستطيع المستخدم اختيار 1..10 تذاكر». */}
        <div className="mt-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-xs font-bold text-foreground">عدد التذاكر لهذه الدورة</span>
            <span dir="ltr" className="text-xs tabular-nums text-muted-foreground">
              {tickets} / {maxTickets}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: maxTickets }, (_, i) => i + 1).map((count) => {
              const active = count === tickets;
              const canAfford = (state?.tickets ?? 0) >= count;
              return (
                <button
                  key={count}
                  type="button"
                  onClick={() => setTickets(count)}
                  disabled={spin.isPending || Boolean(outcome)}
                  aria-pressed={active}
                  className={`min-h-[44px] min-w-[44px] rounded-xl border px-3 text-sm font-bold tabular-nums transition ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : canAfford
                        ? "border-border bg-background text-foreground"
                        : "border-border/50 bg-muted/40 text-muted-foreground"
                  }`}
                >
                  {count}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={onSpin}
          disabled={spin.isPending || Boolean(outcome) || !affordable || strip.length === 0}
          className="mt-4 min-h-[48px] w-full rounded-2xl bg-foreground px-4 text-base font-extrabold text-background disabled:opacity-50"
        >
          {spin.isPending ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> جارٍ التنفيذ…
            </span>
          ) : outcome ? (
            "…"
          ) : affordable ? (
            `ابدأ — ${tickets} تذكرة`
          ) : (
            "لا تملك هذا العدد من التذاكر"
          )}
        </button>

        {!affordable ? (
          <Link
            to="/banana_market"
            className="mt-2 block text-center text-xs font-bold text-primary underline"
          >
            اشترِ تذاكر من سوق الموز
          </Link>
        ) : null}
      </section>

      {/* «أسفل الروليت اعرض للمستخدم الاحتمالات الحالية بناءً على عدد التذاكر». */}
      <section className="mt-4 rounded-2xl border border-border/60 bg-card p-3">
        <h2 className="mb-2 text-sm font-extrabold text-foreground">
          فرصك بـ {tickets} تذكرة
        </h2>
        <ul className="space-y-1">
          {(state?.odds ?? []).map((row) => (
            <li
              key={row.key}
              className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2"
            >
              <span className="min-w-0 truncate text-xs text-foreground">{row.label}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                {row.games > 0 ? (
                  <span dir="ltr" className="text-[10px] tabular-nums text-muted-foreground">
                    {row.games} لعبة
                  </span>
                ) : null}
                <span dir="ltr" className="text-xs font-extrabold tabular-nums text-foreground">
                  {row.percent >= 1
                    ? `${row.percent.toFixed(1)}%`
                    : `${row.percent.toFixed(row.percent >= 0.1 ? 2 : 3)}%`}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          هذه نِسب حقيقية من مئة، يحسبها الخادم لعدد التذاكر الذي اخترته. «حظ أوفر» يعني أن الدورة
          لا تربح شيئًا، والتذاكر تُستهلك.
        </p>
      </section>

      <PrizeShelf
        prizes={state?.prizes ?? []}
        onImport={(prizeId) => importPrize.mutateAsync(prizeId)}
        importing={importPrize.isPending}
      />

      {showResult && result ? (
        <ResultDialog
          result={result}
          onClose={closeResult}
          onImport={(prizeId) => importPrize.mutateAsync(prizeId)}
        />
      ) : null}
    </div>
  );
}

/** «أنشئ قسم ألعابك» — what has been won and not yet imported. */
function PrizeShelf({
  prizes,
  onImport,
  importing,
}: {
  prizes: readonly RoulettePrizeData[];
  onImport: (prizeId: string) => Promise<{ orderId?: string; threadId?: string; message?: string }>;
  importing: boolean;
}) {
  const navigate = useNavigate();
  if (!prizes.length) return null;

  return (
    <section className="mt-4 rounded-2xl border border-border/60 bg-card p-3">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-extrabold text-foreground">
        <Gift className="h-4 w-4" /> ألعابك
      </h2>
      <ul className="space-y-2">
        {prizes.map((prize) => (
          <li
            key={prize.id}
            className="flex items-center gap-3 rounded-xl border border-border/50 bg-background p-2"
          >
            <PrizeThumb title={prize.productTitle} image={prize.productImage} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-bold text-foreground" dir="auto">
                {prize.productTitle}
              </div>
              <div dir="ltr" className="text-[10px] tabular-nums text-muted-foreground">
                {new Date(prize.wonAt).toLocaleDateString("en-GB")}
              </div>
            </div>
            {prize.status === "claimed" && prize.orderId ? (
              <button
                type="button"
                onClick={() =>
                  void navigate({ to: "/chat", search: { initialOrderId: prize.orderId! } })
                }
                className="min-h-[44px] shrink-0 rounded-xl border border-border px-3 text-xs font-bold text-foreground"
              >
                فتح الطلب
              </button>
            ) : (
              <button
                type="button"
                disabled={importing || prize.status !== "available"}
                onClick={() => {
                  void onImport(prize.id)
                    .then((answer) => {
                      toast.success(answer.message || "تم إنشاء طلب الهدية ✅");
                      /*
                        «ثم افتح محادثة الطلب مباشرة للمستخدم» — the chat route
                        opens a conversation by its ORDER, which is the id the
                        import returns beside the thread's.
                      */
                      if (answer.orderId) {
                        void navigate({ to: "/chat", search: { initialOrderId: answer.orderId } });
                      }
                    })
                    .catch((error: unknown) =>
                      toast.error(error instanceof Error ? error.message : "تعذّر الاستيراد"),
                    );
                }}
                className="min-h-[44px] shrink-0 rounded-xl bg-foreground px-3 text-xs font-extrabold text-background disabled:opacity-50"
              >
                استيراد
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">
        الاستيراد ينشئ طلب هدية بسعر صفر ويفتح محادثته مباشرة — بلا سلة وبلا دفع.
      </p>
    </section>
  );
}

/**
 * The prize's picture, or its name.
 *
 * The same rule as the strip, and the reason is the same: there is no such
 * thing as a close-enough picture of a game somebody just won.
 */
function PrizeThumb({ title, image }: { title: string; image: string | null }) {
  if (!image) {
    return (
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-muted text-center text-[8px] font-bold leading-tight text-muted-foreground">
        <span className="line-clamp-3 px-0.5" dir="auto">
          {title}
        </span>
      </div>
    );
  }
  return (
    <img
      src={image}
      alt={title}
      loading="lazy"
      className="h-12 w-12 shrink-0 rounded-lg object-cover"
    />
  );
}

/** «بعد توقف الروليت افتح Popup أنيق». */
export function ResultDialog({
  result,
  onClose,
  onImport,
}: {
  result: SpinResponse;
  onClose: () => void;
  onImport: (prizeId: string) => Promise<{ orderId?: string; message?: string }>;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const prize = result.prize ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={result.won ? "مبروك" : "حظ أوفر"}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-t-3xl bg-card p-5 text-center sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        {result.won && prize ? (
          <>
            <div className="mb-1 text-2xl">🎉</div>
            <h2 className="text-lg font-extrabold text-foreground">مبروك</h2>
            <div className="mx-auto my-3 w-32">
              <PrizeSquare title={prize.productTitle} image={prize.productImage} />
            </div>
            <p className="text-sm font-bold text-foreground" dir="auto">
              {prize.productTitle}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">أُضيفت إلى ألعابك القابلة للاستيراد</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void onImport(prize.id)
                  .then((answer) => {
                    toast.success(answer.message || "تم إنشاء طلب الهدية ✅");
                    onClose();
                    if (answer.orderId) {
                      void navigate({ to: "/chat", search: { initialOrderId: answer.orderId } });
                    }
                  })
                  .catch((error: unknown) =>
                    toast.error(error instanceof Error ? error.message : "تعذّر الاستيراد"),
                  )
                  .finally(() => setBusy(false));
              }}
              className="mt-4 min-h-[48px] w-full rounded-2xl bg-foreground text-base font-extrabold text-background disabled:opacity-50"
            >
              {busy ? "جارٍ الإنشاء…" : "استيراد اللعبة"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 min-h-[44px] w-full rounded-2xl border border-border text-sm font-bold text-foreground"
            >
              لاحقًا
            </button>
          </>
        ) : (
          <>
            <div className="mb-1 text-2xl">🍀</div>
            <h2 className="text-lg font-extrabold text-foreground">حظ أوفر</h2>
            <p className="mt-1 text-sm text-muted-foreground">لم تربح هذه المرة.</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 min-h-[48px] w-full rounded-2xl bg-foreground text-base font-extrabold text-background"
            >
              حسنًا
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PrizeSquare({ title, image }: { title: string; image: string | null }) {
  if (!image) {
    return (
      <div className="grid aspect-square w-full place-items-center rounded-xl bg-muted p-2 text-center text-xs font-bold text-muted-foreground">
        <span className="line-clamp-4" dir="auto">
          {title}
        </span>
      </div>
    );
  }
  return (
    <img src={image} alt={title} className="aspect-square w-full rounded-xl object-cover" />
  );
}
