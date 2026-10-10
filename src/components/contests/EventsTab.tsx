import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Gift, KeyRound, Loader2, Ticket, Trophy, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { tr, useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useContests } from "@/hooks/useContests";
import { useRoulette, type RoulettePrizeData } from "@/hooks/useRoulette";
import type { ContestView } from "@/lib/contests";
import { isUnderMaintenance, MAINTENANCE_COPY } from "@/lib/maintenance";
import { cn } from "@/lib/utils";
import { playSound } from "@/utils/audio";

import { Countdown, MethodChips, PhaseBadge, PrizeImage } from "./ContestParts";
import ContestSheet from "./ContestSheet";

const money = (n: number) => Number(n || 0).toLocaleString("en-US");

/**
 * «الفعاليات والمسابقات» — what `/banana` opens on.
 *
 *   «تطوير تجربه المستخدم وتسهيلها في قسم الفعاليات والمسابقات»
 *
 * One thing is loud: the contest a member can enter right now, ending
 * soonest, with its countdown and one button. Everything under it is quiet
 * and in the order a member reaches for it — the roulette and their tickets,
 * the games they have won, the other contests, a code from Instagram, and
 * how the bananas that pay for all of it are earned.
 *
 * A contest opens in a sheet over the list, addressed by `?contest=` so it
 * can be shared.
 */
export default function EventsTab({
  contestId,
  onOpen,
  onShowMarket,
}: {
  contestId?: string | undefined;
  onOpen: (id: string | null) => void;
  /** To the market half — where tickets are bought and bananas sold. */
  onShowMarket: () => void;
}) {
  const { lang } = useI18n();
  const { user } = useAuth();
  const { contests, prizes, isPending, error } = useContests();
  const roulette = useRoulette(1, { enabled: Boolean(user) });
  const selected = contestId ? (contests.find((c) => c.id === contestId) ?? null) : null;

  /*
    The featured contest: open, and ending soonest — the one where waiting
    costs a member something. One with no end date is ended by the admin, so
    it comes after every dated one.
  */
  const open = contests
    .filter((c) => c.phase === "open")
    .sort(
      (a, b) =>
        (a.endsAt ? Date.parse(a.endsAt) : Infinity) - (b.endsAt ? Date.parse(b.endsAt) : Infinity),
    );
  const featured = open[0] ?? null;
  const live = contests.filter(
    (c) => (c.phase === "open" || c.phase === "upcoming") && c.id !== featured?.id,
  );
  const past = contests.filter((c) => c.phase !== "open" && c.phase !== "upcoming");
  const bananasOpen = !isUnderMaintenance("bananas");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-8 pt-2" dir={lang === "en" ? "ltr" : "rtl"}>
      {/* The tab above already says where this is; the heading is for screen readers. */}
      <h1 className="sr-only">{tr("الفعاليات والمسابقات")}</h1>

      {user && roulette.state ? (
        <WalletStrip
          bananas={roulette.state.bananas}
          tickets={roulette.state.tickets}
          onShowMarket={onShowMarket}
        />
      ) : null}

      {isPending ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />
        </div>
      ) : featured ? (
        <FeaturedContest contest={featured} onOpen={() => onOpen(featured.id)} />
      ) : null}

      <RouletteCard
        signedIn={Boolean(user)}
        tickets={roulette.state?.tickets ?? 0}
        onShowMarket={onShowMarket}
      />

      {user && prizes.length ? <MyPrizes prizes={prizes} /> : null}

      {!isPending ? (
        <section className="mt-6" aria-labelledby="contests-title">
          <h2
            id="contests-title"
            className="mb-2 flex items-center gap-1.5 text-[15px] font-black text-foreground"
          >
            <Trophy className="h-4 w-4 text-banana" aria-hidden="true" />
            {featured ? tr("مسابقات أخرى") : tr("المسابقات")}
          </h2>

          {error ? (
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
              {!live.length && featured ? (
                <p className="rounded-2xl border border-dashed border-border px-4 py-3 text-center text-[12px] text-muted-foreground">
                  {tr("لا مسابقات أخرى مفتوحة الآن.")}
                </p>
              ) : null}
              {past.length ? <PastContests contests={past} onOpen={onOpen} /> : null}
            </div>
          )}
        </section>
      ) : null}

      {user ? <ClaimCode /> : null}

      {bananasOpen ? <EarnBananas onShowMarket={onShowMarket} /> : null}

      <ContestSheet contest={selected} onClose={() => onOpen(null)} />
    </div>
  );
}

/** The member's bananas and tickets, and the one place both are topped up. */
function WalletStrip({
  bananas,
  tickets,
  onShowMarket,
}: {
  bananas: number;
  tickets: number;
  onShowMarket: () => void;
}) {
  return (
    <div className="mb-3 flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2">
      <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] font-bold text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true">🍌</span>
          <span dir="ltr" className="font-black tabular-nums text-foreground">
            {money(bananas)}
          </span>
          {tr("موزة")}
        </span>
        <span className="inline-flex items-center gap-1">
          <Ticket className="h-3.5 w-3.5" aria-hidden="true" />
          <span dir="ltr" className="font-black tabular-nums text-foreground">
            {money(tickets)}
          </span>
          {tr("تذكرة")}
        </span>
      </p>
      <button
        type="button"
        onClick={() => {
          playSound("klick", 0.4);
          onShowMarket();
        }}
        className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-xl px-2.5 text-[12px] font-black text-foreground transition-colors hover:bg-muted"
      >
        {tr("سوق الموز")}
        <ChevronLeft className="h-3.5 w-3.5 ltr:rotate-180" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * The contest to enter now — the page's one loud element. The prize is the
 * picture, the countdown ticks, and the button says what the member's next
 * step is in this contest, not in contests in general.
 */
function FeaturedContest({ contest, onOpen }: { contest: ContestView; onOpen: () => void }) {
  const held = contest.mine?.tickets ?? 0;
  const label = contest.mine?.won
    ? tr("فزت! افتح التفاصيل")
    : held
      ? tr("أنت مشارك — زد فرصتك")
      : tr("ادخل المسابقة");
  return (
    <section
      aria-labelledby="featured-contest"
      data-featured-contest={contest.id}
      className="relative overflow-hidden rounded-[28px] border border-banana/40 bg-card shadow-soft"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-banana/25 to-transparent"
      />
      <div className="relative flex gap-3.5 p-4">
        <PrizeImage
          title={contest.prize.title}
          image={contest.prize.image}
          size={112}
          className="rounded-[22px] shadow-sm ring-1 ring-black/5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <PhaseBadge phase={contest.phase} />
            {held ? (
              <span className="rounded-full bg-leaf/15 px-2 py-0.5 text-[10.5px] font-black text-leaf">
                🎟️ {tr("مشارك")} ×{held}
              </span>
            ) : null}
          </div>
          <h2
            id="featured-contest"
            className="mt-1.5 line-clamp-2 text-[17px] font-black leading-snug tracking-[-0.01em] text-foreground"
          >
            {contest.title}
          </h2>
          <p className="mt-0.5 truncate text-[12.5px] font-bold text-muted-foreground" dir="auto">
            🎁 {contest.prize.title}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] font-bold text-muted-foreground">
            <Countdown
              phase={contest.phase}
              startsAt={contest.startsAt}
              endsAt={contest.endsAt}
              live
              className="text-foreground"
            />
            {contest.participants !== null ? (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                <span dir="ltr" className="tabular-nums">
                  {contest.participants}
                </span>
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="relative flex flex-wrap items-center gap-1.5 px-4 pb-1">
        <MethodChips
          methods={contest.entryMethods}
          instagram={contest.drawSource === "instagram"}
        />
      </div>
      <div className="relative p-3 pt-2.5">
        <button
          type="button"
          onClick={() => {
            playSound("klick", 0.45);
            onOpen();
          }}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-banana px-4 text-[15px] font-black text-banana-ink shadow-sm transition-transform active:scale-[0.99]"
        >
          {label}
        </button>
      </div>
    </section>
  );
}

function RouletteCard({
  signedIn,
  tickets,
  onShowMarket,
}: {
  signedIn: boolean;
  tickets: number;
  onShowMarket: () => void;
}) {
  const closed = isUnderMaintenance("roulette");
  if (closed) {
    return (
      <div
        role="status"
        data-maintenance="roulette"
        className="mt-3 flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3"
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
    <section
      aria-labelledby="roulette-card"
      data-roulette-card
      className="mt-3 rounded-3xl border border-border bg-card p-3"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-banana/20 text-[24px]">
          🎰
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="roulette-card" className="text-[14px] font-black text-foreground">
            {tr("الروليت")}
          </h2>
          <p className="text-[11.5px] text-muted-foreground">
            {signedIn
              ? tickets
                ? tr("لديك تذاكر — دوّر واربح لعبة من المتجر.")
                : tr("اشترِ تذاكر بالموز، ثم دوّر واربح لعبة من المتجر.")
              : tr("دوّر بتذاكرك واربح لعبة من المتجر.")}
          </p>
        </div>
        {signedIn ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[12px] font-black text-foreground">
            <Ticket className="h-3.5 w-3.5" aria-hidden="true" />
            <span dir="ltr" className="tabular-nums">
              {tickets}
            </span>
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <Link
          to="/wheel"
          data-ui-sound="klick"
          className={cn(
            "flex min-h-11 items-center justify-center rounded-2xl text-[13px] font-black transition-transform active:scale-[0.99]",
            /* With no tickets to spend, buying them is the step that matters. */
            signedIn && !tickets
              ? "border border-border text-foreground"
              : "col-span-2 bg-foreground text-background",
          )}
        >
          {tr("دوّر الآن")}
        </Link>
        {signedIn && !tickets ? (
          <button
            type="button"
            onClick={() => {
              playSound("klick", 0.4);
              onShowMarket();
            }}
            className="flex min-h-11 items-center justify-center rounded-2xl bg-foreground text-[13px] font-black text-background transition-transform active:scale-[0.99]"
          >
            {tr("اشترِ تذاكر")}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Contests that ended: the three latest, and the rest on request. */
function PastContests({
  contests,
  onOpen,
}: {
  contests: ContestView[];
  onOpen: (id: string | null) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? contests : contests.slice(0, 3);
  return (
    <>
      <h3 className="pt-3 text-[12px] font-black text-muted-foreground">{tr("مسابقات انتهت")}</h3>
      {shown.map((contest) => (
        <ContestCard key={contest.id} contest={contest} onOpen={() => onOpen(contest.id)} />
      ))}
      {contests.length > 3 && !all ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="flex min-h-10 w-full items-center justify-center rounded-2xl text-[12.5px] font-black text-foreground hover:bg-muted"
        >
          {tr("عرض كل المسابقات المنتهية")}{" "}
          <span dir="ltr" className="ms-1 tabular-nums text-muted-foreground">
            ({contests.length})
          </span>
        </button>
      ) : null}
    </>
  );
}

/** «ارجاع ربح الموز» — where the bananas come from, in one sentence. */
function EarnBananas({ onShowMarket }: { onShowMarket: () => void }) {
  return (
    <section
      aria-labelledby="earn-bananas"
      className="mt-6 flex items-start gap-3 rounded-3xl bg-banana/10 p-4"
    >
      <span className="text-[24px]" aria-hidden="true">
        🍌
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="earn-bananas" className="text-[13.5px] font-black text-foreground">
          {tr("كيف تربح الموز؟")}
        </h2>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
          {tr(
            "كل طلب مدفوع من المتجر يضيف موزاً إلى رصيدك تلقائياً. استخدمه لتذاكر الروليت ودخول المسابقات، أو بِعه للمتجر بسعر السوق.",
          )}
        </p>
        <button
          type="button"
          onClick={() => {
            playSound("klick", 0.4);
            onShowMarket();
          }}
          className="mt-2 inline-flex min-h-10 items-center gap-1 rounded-xl text-[12.5px] font-black text-foreground underline-offset-4 hover:underline"
        >
          {tr("افتح سوق الموز")}
          <ChevronLeft className="h-3.5 w-3.5 ltr:rotate-180" aria-hidden="true" />
        </button>
      </div>
    </section>
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
