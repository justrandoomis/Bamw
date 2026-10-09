import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Gift, KeyRound, Loader2, Trophy, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { tr, useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useContests } from "@/hooks/useContests";
import type { RoulettePrizeData } from "@/hooks/useRoulette";
import type { ContestView } from "@/lib/contests";
import { isUnderMaintenance, MAINTENANCE_COPY } from "@/lib/maintenance";
import { cn } from "@/lib/utils";
import { playSound } from "@/utils/audio";

import { Countdown, MethodChips, PhaseBadge, PrizeImage } from "./ContestParts";
import ContestSheet from "./ContestSheet";

/**
 * «الفعاليات والمسابقات» — the second tab of /banana_market.
 *
 * The roulette (under maintenance for now, and saying so in one line), the
 * games the member has won from anything, a place to type the code of a game
 * won on Instagram, and the contests — open ones first. A contest opens in a
 * sheet over the list, addressed by `?contest=` so it can be shared.
 */
export default function EventsTab({
  contestId,
  onOpen,
}: {
  contestId?: string | undefined;
  onOpen: (id: string | null) => void;
}) {
  const { lang } = useI18n();
  const { user } = useAuth();
  const { contests, prizes, isPending, error } = useContests();
  const selected = contestId ? (contests.find((c) => c.id === contestId) ?? null) : null;

  const live = contests.filter((c) => c.phase === "open" || c.phase === "upcoming");
  const past = contests.filter((c) => c.phase !== "open" && c.phase !== "upcoming");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-2" dir={lang === "en" ? "ltr" : "rtl"}>
      <header className="mb-3">
        <h1 className="text-[19px] font-black tracking-[-0.02em] text-foreground">
          {tr("الفعاليات والمسابقات")}
        </h1>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {tr("ادخل المسابقات واربح ألعاباً — كل لعبة تربحها تصل إلى ألعابك وتستوردها مجاناً.")}
        </p>
      </header>

      <RouletteCard />

      {user && prizes.length ? <MyPrizes prizes={prizes} /> : null}

      <section className="mt-5" aria-labelledby="contests-title">
        <h2
          id="contests-title"
          className="mb-2 flex items-center gap-1.5 text-[15px] font-black text-foreground"
        >
          <Trophy className="h-4 w-4 text-banana" aria-hidden="true" />
          {tr("المسابقات")}
        </h2>

        {isPending ? (
          <div className="flex justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />
          </div>
        ) : error ? (
          <p className="rounded-2xl border border-border bg-card p-4 text-center text-[13px] text-muted-foreground">
            {tr("تعذّر تحميل المسابقات، حاول مرة أخرى.")}
          </p>
        ) : !contests.length ? (
          <div className="rounded-3xl border border-dashed border-border bg-card/60 px-5 py-8 text-center">
            <p className="text-[28px]" aria-hidden="true">
              🏆
            </p>
            <p className="mt-1 text-[14px] font-black text-foreground">
              {tr("لا توجد مسابقات الآن")}
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {tr("تابعنا على إنستغرام وتلغرام ليصلك خبر المسابقة القادمة أولاً.")}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {live.map((contest) => (
              <ContestCard key={contest.id} contest={contest} onOpen={() => onOpen(contest.id)} />
            ))}
            {past.length ? (
              <>
                <h3 className="pt-3 text-[12px] font-black text-muted-foreground">
                  {tr("مسابقات انتهت")}
                </h3>
                {past.map((contest) => (
                  <ContestCard
                    key={contest.id}
                    contest={contest}
                    onOpen={() => onOpen(contest.id)}
                  />
                ))}
              </>
            ) : null}
          </div>
        )}
      </section>

      {user ? <ClaimCode /> : null}

      <ContestSheet contest={selected} onClose={() => onOpen(null)} />
    </div>
  );
}

function RouletteCard() {
  const closed = isUnderMaintenance("roulette");
  if (closed) {
    return (
      <div
        role="status"
        data-maintenance="roulette"
        className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-[22px]">
          🎰
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-black text-foreground">
            {tr(MAINTENANCE_COPY.roulette.title)}
          </p>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            {tr("ستعود قريباً — ألعابك التي ربحتها سابقاً تجدها هنا وتستوردها كالمعتاد.")}
          </p>
        </div>
      </div>
    );
  }
  return (
    <Link
      to="/wheel"
      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 transition-colors hover:bg-muted/50"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-banana/20 text-[22px]">
        🎰
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-black text-foreground">{tr("الروليت")}</p>
        <p className="text-[11.5px] text-muted-foreground">{tr("دوّر واربح لعبة من المتجر")}</p>
      </div>
      <ChevronLeft
        className="h-4 w-4 text-muted-foreground rtl:rotate-0 ltr:rotate-180"
        aria-hidden="true"
      />
    </Link>
  );
}

function ContestCard({ contest, onOpen }: { contest: ContestView; onOpen: () => void }) {
  const held = contest.mine?.tickets ?? 0;
  const ended = contest.phase !== "open" && contest.phase !== "upcoming";
  return (
    <button
      type="button"
      onClick={() => {
        playSound("klick", 0.4);
        onOpen();
      }}
      data-contest-card={contest.id}
      className={cn(
        "flex w-full items-center gap-3 rounded-3xl border border-border bg-card p-3 text-start shadow-soft transition-transform active:scale-[0.99]",
        ended && "opacity-80",
      )}
    >
      <PrizeImage title={contest.prize.title} image={contest.prize.image} size={72} />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
          <PhaseBadge phase={contest.phase} />
          {contest.mine?.won ? (
            <span className="rounded-full bg-banana px-2 py-0.5 text-[10.5px] font-black text-banana-ink">
              🏆 {tr("فزت!")}
            </span>
          ) : held ? (
            <span className="rounded-full bg-leaf/15 px-2 py-0.5 text-[10.5px] font-black text-leaf">
              🎟️ {tr("مشارك")} ×{held}
            </span>
          ) : null}
        </div>
        <h3 className="truncate text-[14.5px] font-black text-foreground">{contest.title}</h3>
        <p className="truncate text-[12px] font-bold text-muted-foreground" dir="auto">
          🎁 {contest.prize.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold text-muted-foreground">
          <Countdown phase={contest.phase} startsAt={contest.startsAt} endsAt={contest.endsAt} />
          {contest.participants !== null ? (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              <span dir="ltr" className="tabular-nums">
                {contest.participants}
              </span>
            </span>
          ) : null}
          {!ended ? (
            <MethodChips
              methods={contest.entryMethods}
              instagram={contest.drawSource === "instagram"}
            />
          ) : null}
        </div>
      </div>
      <ChevronLeft
        className="h-4 w-4 shrink-0 text-muted-foreground ltr:rotate-180"
        aria-hidden="true"
      />
    </button>
  );
}

/** «جوائزي»: every game won — on the roulette or in a contest — and its import. */
function MyPrizes({ prizes }: { prizes: RoulettePrizeData[] }) {
  const navigate = useNavigate();
  const { importPrize } = useContests();
  const visible = prizes.filter((prize) => prize.status !== "expired");
  if (!visible.length) return null;
  return (
    <section
      className="mt-4 rounded-3xl border border-border bg-card p-3"
      aria-labelledby="my-prizes"
    >
      <h2
        id="my-prizes"
        className="mb-2 flex items-center gap-1.5 text-[14px] font-black text-foreground"
      >
        <Gift className="h-4 w-4 text-leaf" aria-hidden="true" />
        {tr("جوائزي — ألعابك")}
      </h2>
      <ul className="space-y-2">
        {visible.map((prize) => (
          <li
            key={prize.id}
            className="flex items-center gap-3 rounded-2xl border border-border/60 bg-background p-2"
          >
            <PrizeImage
              title={prize.productTitle}
              image={prize.productImage ?? ""}
              size={48}
              className="rounded-xl"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-black text-foreground" dir="auto">
                {prize.productTitle}
              </p>
              <p className="text-[10.5px] font-bold text-muted-foreground">
                {prize.source === "contest" ? `🏆 ${tr("من مسابقة")}` : `🎰 ${tr("من الروليت")}`}
                <span className="mx-1">·</span>
                <span dir="ltr" className="tabular-nums">
                  {new Date(prize.wonAt).toLocaleDateString("en-GB")}
                </span>
              </p>
            </div>
            {prize.status === "claimed" && prize.orderId ? (
              <button
                type="button"
                onClick={() =>
                  void navigate({ to: "/chat", search: { initialOrderId: prize.orderId! } })
                }
                className="min-h-10 shrink-0 rounded-xl border border-border px-3 text-[12px] font-black text-foreground"
              >
                {tr("فتح الطلب")}
              </button>
            ) : (
              <button
                type="button"
                disabled={importPrize.isPending || prize.status !== "available"}
                onClick={() => {
                  importPrize
                    .mutateAsync(prize.id)
                    .then((answer) => {
                      playSound("bumper_end", 0.6);
                      toast.success(answer.message || tr("تم إنشاء طلب الهدية ✅"));
                      if (answer.orderId) {
                        void navigate({ to: "/chat", search: { initialOrderId: answer.orderId } });
                      }
                    })
                    .catch((err: unknown) => {
                      playSound("error", 0.5);
                      toast.error(err instanceof Error ? err.message : tr("تعذّر الاستيراد"));
                    });
                }}
                className="min-h-10 shrink-0 rounded-xl bg-foreground px-3 text-[12px] font-black text-background disabled:opacity-50"
              >
                {importPrize.isPending && importPrize.variables === prize.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  tr("استيراد")
                )}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10.5px] text-muted-foreground">
        {tr("الاستيراد ينشئ طلب هدية بسعر صفر ويفتح محادثته مباشرة — بلا سلة وبلا دفع.")}
      </p>
    </section>
  );
}

/** For a winner drawn from Instagram: the code the admin sent them, typed here. */
function ClaimCode() {
  const { claim } = useContests();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const bare = code.replace(/[^0-9A-Za-z]/g, "");
  return (
    <section className="mt-5 rounded-2xl border border-dashed border-border p-3">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 text-[13px] font-black text-foreground"
        >
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          {tr("لديك كود جائزة؟")}
        </button>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            claim
              .mutateAsync(code)
              .then((answer) => {
                playSound("bumper_end", 0.6);
                toast.success(answer.message);
                setCode("");
                setOpen(false);
              })
              .catch((err: unknown) => {
                playSound("error", 0.5);
                toast.error(err instanceof Error ? err.message : tr("تعذّر استلام الجائزة"));
              });
          }}
        >
          <label
            htmlFor="claim-code"
            className="mb-1.5 block text-[12.5px] font-bold text-foreground"
          >
            {tr("أدخل كود الجائزة الذي وصلك من الإدارة — تصل اللعبة إلى ألعابك.")}
          </label>
          <div className="flex gap-2">
            <input
              id="claim-code"
              value={code}
              onChange={(event) => {
                const raw = event.target.value
                  .toUpperCase()
                  .replace(/[^0-9A-Z]/g, "")
                  .slice(0, 10);
                setCode(raw.length > 5 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw);
              }}
              placeholder="XXXXX-XXXXX"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-center font-mono text-[15px] font-black tracking-[0.12em] outline-none focus:ring-2 focus:ring-banana"
            />
            <button
              type="submit"
              disabled={claim.isPending || bare.length !== 10}
              className="min-h-11 shrink-0 rounded-xl bg-foreground px-4 text-[13px] font-black text-background disabled:opacity-50"
            >
              {claim.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : tr("استلم")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
