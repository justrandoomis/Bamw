import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Banana, Gift, Loader2, Minus, Plus, Ticket } from "lucide-react";
import { toast } from "sonner";

import {
  ROULETTE_SOUND_CHANNEL,
  RouletteStrip,
  type RouletteCard,
} from "@/components/roulette/RouletteStrip";
import {
  pressId,
  useRoulette,
  type OddsRow,
  type RoulettePrizeData,
  type SpinResponse,
} from "@/hooks/useRoulette";
import { cn } from "@/lib/utils";
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

/**
 * The colour a bucket wears, in the bar and beside its name.
 *
 * One ramp, ordered by rarity, over the market's three prize hues: banana for
 * the outcome that happens most, through peel, to leaf for the one that almost
 * never does. Reading it needs no key — the yellow end is ordinary and the
 * green end is the good news — and it introduces no colour the rest of the shop
 * does not already use. Losing is the one thing that is NOT a prize, so it is
 * the one segment with no hue at all: a warm neutral, which is what makes the
 * three quarters of the bar it usually occupies read as absence rather than as
 * a fourth flavour of win.
 *
 * `color-mix` rather than fixed hexes so a theme pack that lifts `--banana`,
 * `--peel` and `--leaf` for a dark surface lifts the whole ramp with them.
 */
const BUCKET_FILL: Readonly<Record<string, string>> = {
  lose: "color-mix(in oklab, var(--ink-mute) 42%, var(--surface-3))",
  low_cheap: "var(--banana)",
  medium_cheap: "color-mix(in oklab, var(--banana) 50%, var(--peel))",
  high_cheap: "var(--peel)",
  low_premium: "color-mix(in oklab, var(--peel) 45%, var(--leaf))",
  medium_premium: "color-mix(in oklab, var(--peel) 15%, var(--leaf))",
  high_premium: "var(--leaf)",
};

const fillOf = (key: string) => BUCKET_FILL[key] ?? "var(--muted-foreground)";

/**
 * The server's percentage, printed.
 *
 * NOT recomputed and not re-rounded into a different number: this is the same
 * ladder the list before it used — one decimal from 1% up, two down to a tenth,
 * three below that — so `high_premium` still reads 0.010% rather than being
 * flattened to «0%». Exact zero is the one value printed short, because
 * «0.000%» is four characters of false precision about something that cannot
 * happen, and the buckets that sit at zero are summarised in one line instead
 * of taking a row each. That row-per-impossibility is the thing the owner was
 * looking at when he said most of the block was dead weight.
 */
function percentText(percent: number): string {
  if (!(percent > 0)) return "0%";
  if (percent >= 1) return `${percent.toFixed(1)}%`;
  return `${percent.toFixed(percent >= 0.1 ? 2 : 3)}%`;
}

/**
 * The three numbers, in the order they matter to somebody about to spin.
 *
 * «اعرض 3 أرصدة واضحة» was read as «three identical boxes», and three identical
 * boxes say that bananas, tickets and prizes are the same kind of thing. They
 * are not: tickets are what this press spends, so they are the card; bananas
 * are the context the tickets came from and prizes are the result they lead to,
 * so those two are chips under it. The prize chip is the only one that changes
 * colour, and only when there is actually something waiting to be imported.
 */
function Wallet({ bananas, tickets, ready }: { bananas: number; tickets: number; ready: number }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2">
      <div className="col-span-2 flex items-center gap-3 rounded-2xl border border-banana/40 bg-banana/15 px-3.5 py-3">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-banana text-banana-ink"
        >
          <Ticket className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-bold text-muted-foreground">
            التذاكر — ما تُنفقه في الدورة
          </div>
          <div className="flex items-baseline gap-1.5">
            <span dir="ltr" className="text-[26px] font-black leading-none tabular-nums text-foreground">
              {money(tickets)}
            </span>
            <span className="text-[11px] font-bold text-muted-foreground">تذكرة</span>
          </div>
        </div>
      </div>

      <div className="flex min-h-11 items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2">
        <Banana className="h-4 w-4 shrink-0 text-peel" aria-hidden="true" />
        <span className="truncate text-[11px] font-bold text-muted-foreground">الموز</span>
        <span dir="ltr" className="ms-auto text-[13px] font-extrabold tabular-nums text-foreground">
          {money(bananas)}
        </span>
      </div>

      <div
        className={cn(
          "flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2",
          ready > 0 ? "border-leaf/45 bg-leaf/10" : "border-border/60 bg-card",
        )}
      >
        <Gift
          className={cn("h-4 w-4 shrink-0", ready > 0 ? "text-leaf" : "text-muted-foreground")}
          aria-hidden="true"
        />
        <span className="truncate text-[11px] font-bold text-muted-foreground">جاهزة للاستيراد</span>
        <span
          dir="ltr"
          className={cn(
            "ms-auto text-[13px] font-extrabold tabular-nums",
            ready > 0 ? "text-leaf" : "text-foreground",
          )}
        >
          {money(ready)}
        </span>
      </div>
    </div>
  );
}

/** The amounts a person actually means — the same three the ticket shop offers. */
const TICKET_PRESETS = [1, 5, 10] as const;

/**
 * How many tickets this press spends.
 *
 * Ten identical squares is not a choice, it is a wall, and «7» is nobody's
 * intention. A stepper for a nudge and three presets for the amounts anyone
 * means, which is the shape the ticket shop in سوق الموز already uses — the
 * member meets the same control in both places.
 */
function TicketPicker({
  value,
  max,
  owned,
  disabled,
  onChange,
}: {
  value: number;
  max: number;
  owned: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  const set = (next: number) => onChange(Math.min(max, Math.max(1, next)));

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs font-extrabold text-foreground">عدد التذاكر لهذه الدورة</span>
        <span dir="ltr" className="text-[11px] font-bold tabular-nums text-muted-foreground">
          {value} / {max}
        </span>
      </div>

      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => set(value - 1)}
          disabled={disabled || value <= 1}
          data-ui-sound="klick"
          aria-label="إنقاص"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted/40 text-foreground transition-transform active:scale-95 disabled:opacity-50"
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <div
          aria-live="polite"
          className="flex h-12 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-border bg-background px-2"
        >
          <span dir="ltr" className="text-[19px] font-black tabular-nums text-foreground">
            {value}
          </span>
          <span className="truncate text-[11px] font-bold text-muted-foreground">تذكرة</span>
        </div>
        <button
          type="button"
          onClick={() => set(value + 1)}
          disabled={disabled || value >= max}
          data-ui-sound="klick"
          aria-label="زيادة"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted/40 text-foreground transition-transform active:scale-95 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        {TICKET_PRESETS.filter((count) => count <= max).map((count) => {
          const active = count === value;
          return (
            <button
              key={count}
              type="button"
              onClick={() => set(count)}
              disabled={disabled}
              data-ui-sound="klick"
              aria-pressed={active}
              className={cn(
                "min-h-11 rounded-2xl border px-1 text-[13px] font-black tabular-nums transition-transform active:scale-95 disabled:opacity-50",
                active
                  ? "border-banana bg-banana/15 text-foreground"
                  : "border-border bg-muted/40 text-foreground hover:border-banana/60",
              )}
            >
              <span dir="ltr">{count}</span>
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
        رصيدك <span dir="ltr" className="font-bold tabular-nums">{money(owned)}</span> تذكرة — كلما
        زادت التذاكر قلّ احتمال الخسارة.
      </p>
    </div>
  );
}

/**
 * «أسفل الروليت اعرض للمستخدم الاحتمالات الحالية» — as one hundred, not as
 * seven sentences.
 *
 * The list this replaced printed every bucket on its own row whatever its
 * chance, so four rows of «0.000%» took up more of the block than the fact that
 * three quarters of spins win nothing. A stacked bar says the same numbers in
 * the shape they actually have: the neutral block IS the three quarters, and it
 * is read before anything is parsed. The legend underneath keeps the precision
 * — every real percentage and every game count — for the buckets that can
 * happen, and the ones that cannot collapse into a single line that says how
 * many and why, because «impossible» is one fact and not four rows.
 *
 * Nothing here computes a probability. Every number is the one the server sent
 * with this ticket count, printed; the widths are those same numbers used as
 * flex weights, so the bar cannot disagree with the legend beside it.
 */
function OddsPanel({
  tickets,
  rows,
  emptied,
}: {
  tickets: number;
  rows: readonly OddsRow[];
  emptied: readonly string[];
}) {
  const losePercent = rows.find((row) => row.key === "lose")?.percent ?? 0;
  const possible = rows.filter((row) => row.percent > 0);
  const missing = rows.filter((row) => row.key !== "lose" && !(row.percent > 0));
  const emptiedKeys = new Set(emptied);
  const allEmptied = missing.length > 0 && missing.every((row) => emptiedKeys.has(row.key));

  return (
    <section className="mt-4 rounded-2xl border border-border/60 bg-card p-3.5">
      <h2 className="text-sm font-extrabold text-foreground">
        فرصك بـ <span dir="ltr" className="tabular-nums">{tickets}</span> تذكرة
      </h2>

      {possible.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">لم تصل الاحتمالات بعد.</p>
      ) : (
        <>
          {/*
            The headline is the losing number and nothing else. It is the one
            figure a member needs before pressing, and on the old screen it was
            a row among seven.
          */}
          <div className="mt-2.5 flex items-end gap-2">
            <span
              dir="ltr"
              className={cn(
                "text-[30px] font-black leading-none tabular-nums",
                losePercent > 0 ? "text-rind" : "text-leaf",
              )}
            >
              {percentText(losePercent)}
            </span>
            <span className="pb-0.5 text-[11.5px] font-bold leading-tight text-muted-foreground">
              {losePercent > 0 ? "من الدورات لا تربح شيئاً" : "لا يمكن أن تخسر بهذا العدد"}
            </span>
          </div>

          <div
            role="img"
            aria-label={possible
              .map((row) => `${row.label} ${percentText(row.percent)}`)
              .join(" · ")}
            className="mt-2.5 flex h-4 w-full overflow-hidden rounded-full border border-border/60 bg-muted"
          >
            {possible.map((row) => (
              <span
                key={row.key}
                /*
                  The percentage IS the flex weight, against a zero basis, so the
                  segments divide the bar in exactly the proportion the server
                  sent. `min-width` gives a bucket at one part in ten thousand a
                  visible tick instead of a sub-pixel nothing, and it is honoured
                  by the flex algorithm rather than added to the total, so the
                  bar still ends where a hundred ends.
                */
                style={{
                  flexGrow: row.percent,
                  flexBasis: 0,
                  minWidth: 3,
                  background: fillOf(row.key),
                  boxShadow: "inset 1px 0 0 color-mix(in oklab, var(--card) 60%, transparent)",
                }}
                className="h-full"
              />
            ))}
          </div>

          <ul className="mt-3 space-y-1.5">
            {possible.map((row) => (
              <li key={row.key} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-[4px]"
                  style={{ background: fillOf(row.key) }}
                />
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-bold text-foreground">
                  {row.label}
                </span>
                {row.games > 0 ? (
                  <span className="shrink-0 text-[10px] font-bold text-muted-foreground">
                    <span dir="ltr" className="tabular-nums">
                      {money(row.games)}
                    </span>{" "}
                    لعبة
                  </span>
                ) : null}
                <span
                  dir="ltr"
                  className="w-[58px] shrink-0 text-right text-[12px] font-black tabular-nums text-foreground"
                >
                  {percentText(row.percent)}
                </span>
              </li>
            ))}
          </ul>

          {missing.length > 0 ? (
            <p className="mt-2.5 border-t border-border/60 pt-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
              {missing.length === 1 ? (
                "فئة واحدة غير متاحة"
              ) : missing.length === 2 ? (
                "فئتان غير متاحتين"
              ) : (
                <>
                  <span dir="ltr" className="font-bold tabular-nums">
                    {missing.length}
                  </span>{" "}
                  فئات غير متاحة
                </>
              )}
              {allEmptied
                ? " في هذه الدورة لعدم وجود ألعاب مؤهلة فيها، وحصتها موزّعة على الفئات أعلاه."
                : " في هذه الدورة."}
            </p>
          ) : null}
        </>
      )}

      <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
        هذه نِسب حقيقية من مئة، يحسبها الخادم لعدد التذاكر الذي اخترته. «حظ أوفر» يعني أن الدورة لا
        تربح شيئاً، والتذاكر تُستهلك.
      </p>
    </section>
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
        // A refusal is the one thing on this screen that gets its own sound.
        playSound("error", 0.5);
        toast.error(error instanceof Error ? error.message : "تعذّر تنفيذ الدورة");
      });
  }, [outcome, spin, tickets]);

  /*
    The verdict lands on the run's own channel, which is what stops the hum
    playing under it — a win chime over a still-running reel is two sounds
    where the member is expecting one. Nothing here waits on audio: `playSound`
    returns immediately whether or not anything is audible.
  */
  const onSettled = useCallback(() => {
    setShowResult(true);
    playSound(result?.won ? "bumper_end" : "nock", result?.won ? 0.6 : 0.45, false, ROULETTE_SOUND_CHANNEL);
  }, [result?.won]);

  const closeResult = useCallback(() => {
    setShowResult(false);
    setOutcome(null);
    setResult(null);
    refresh();
  }, [refresh]);

  const available = (state?.prizes ?? []).filter((prize) => prize.status === "available");
  const busy = spin.isPending || Boolean(outcome);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-4" dir="rtl">
      <header className="mb-4">
        <h1 className="text-xl font-extrabold text-foreground">روليت بنانتو</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          اختر عدد التذاكر، ثم دوّر. كلما زادت التذاكر تحسّنت فرصك.
        </p>
      </header>

      <Wallet
        bananas={state?.bananas ?? 0}
        tickets={state?.tickets ?? 0}
        ready={available.length}
      />

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
        <TicketPicker
          value={tickets}
          max={maxTickets}
          owned={state?.tickets ?? 0}
          disabled={busy}
          onChange={setTickets}
        />

        <button
          type="button"
          onClick={onSpin}
          disabled={busy || !affordable || strip.length === 0}
          data-ui-sound="turn_on"
          data-ui-volume="0.55"
          className="mt-3 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-banana px-4 text-[15px] font-black text-banana-ink shadow-sm transition-transform active:scale-[0.99] disabled:opacity-50"
        >
          {spin.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> جارٍ التنفيذ…
            </>
          ) : outcome ? (
            "جارٍ الدوران…"
          ) : affordable ? (
            <>
              ابدأ — <span dir="ltr" className="tabular-nums">{tickets}</span> تذكرة
            </>
          ) : (
            "لا تملك هذا العدد من التذاكر"
          )}
        </button>

        {!affordable ? (
          <Link
            to="/banana_market"
            data-ui-sound="klick"
            className="mt-2 flex min-h-11 items-center justify-center text-center text-xs font-bold text-primary underline"
          >
            اشترِ تذاكر من سوق الموز
          </Link>
        ) : null}
      </section>

      <OddsPanel tickets={tickets} rows={state?.odds ?? []} emptied={state?.emptied ?? []} />

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
        <Gift className="h-4 w-4 text-leaf" aria-hidden="true" /> ألعابك
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
                data-ui-sound="klick"
                onClick={() =>
                  void navigate({ to: "/chat", search: { initialOrderId: prize.orderId! } })
                }
                className="min-h-11 shrink-0 rounded-xl border border-border px-3 text-xs font-bold text-foreground"
              >
                فتح الطلب
              </button>
            ) : (
              <button
                type="button"
                disabled={importing || prize.status !== "available"}
                data-ui-sound="turn_on"
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
                    .catch((error: unknown) => {
                      playSound("error", 0.5);
                      toast.error(error instanceof Error ? error.message : "تعذّر الاستيراد");
                    });
                }}
                className="min-h-11 shrink-0 rounded-xl bg-foreground px-3 text-xs font-extrabold text-background disabled:opacity-50"
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
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-secondary text-center text-[8px] font-bold leading-tight text-foreground/70">
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
            {/* The verdict wears its own colour: leaf for a win, rind for a loss. */}
            <div className="mx-auto mb-2 h-1 w-12 rounded-full bg-leaf" aria-hidden="true" />
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
              data-ui-sound="turn_on"
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
                  .catch((error: unknown) => {
                    playSound("error", 0.5);
                    toast.error(error instanceof Error ? error.message : "تعذّر الاستيراد");
                  })
                  .finally(() => setBusy(false));
              }}
              className="mt-4 min-h-12 w-full rounded-2xl bg-foreground text-base font-extrabold text-background disabled:opacity-50"
            >
              {busy ? "جارٍ الإنشاء…" : "استيراد اللعبة"}
            </button>
            <button
              type="button"
              onClick={onClose}
              data-ui-sound="turn_off"
              className="mt-2 min-h-11 w-full rounded-2xl border border-border text-sm font-bold text-foreground"
            >
              لاحقًا
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto mb-2 h-1 w-12 rounded-full bg-rind" aria-hidden="true" />
            <div className="mb-1 text-2xl">🍀</div>
            <h2 className="text-lg font-extrabold text-foreground">حظ أوفر</h2>
            <p className="mt-1 text-sm text-muted-foreground">لم تربح هذه المرة.</p>
            <button
              type="button"
              onClick={onClose}
              data-ui-sound="turn_off"
              className="mt-4 min-h-12 w-full rounded-2xl bg-foreground text-base font-extrabold text-background"
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
      <div className="grid aspect-square w-full place-items-center rounded-xl bg-secondary p-2 text-center text-xs font-bold text-foreground/75">
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
