import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BadgeCheck,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  Minus,
  Plus,
  ShieldCheck,
  Ticket,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { tr, useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useContests } from "@/hooks/useContests";
import { pressId } from "@/hooks/useRoulette";
import type { ContestEntryMethod, ContestView } from "@/lib/contests";
import { isUnderMaintenance } from "@/lib/maintenance";
import { rememberAfterSignIn } from "@/lib/signInReturn";
import { cn } from "@/lib/utils";
import { playSound } from "@/utils/audio";

import { Countdown, MethodChips, PhaseBadge, PrizeImage } from "./ContestParts";

/**
 * One contest, whole: the prize, the story, the conditions with the post they
 * point at, every way in, the member's own tickets — and once it is drawn, the
 * winners and the proof that the system, not a person, picked them.
 */
export default function ContestSheet({
  contest,
  onClose,
}: {
  contest: ContestView | null;
  onClose: () => void;
}) {
  const { lang } = useI18n();
  return (
    <DialogPrimitive.Root open={Boolean(contest)} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-[1px]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          dir={lang === "en" ? "ltr" : "rtl"}
          className="fixed inset-x-0 bottom-0 z-[80] mx-auto flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] border border-border bg-background shadow-2xl outline-none sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-[28px]"
        >
          {contest ? <SheetBody contest={contest} onClose={onClose} /> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SheetBody({ contest, onClose }: { contest: ContestView; onClose: () => void }) {
  const mine = contest.mine;
  return (
    <>
      <div className="relative shrink-0 border-b border-border/60 bg-gradient-to-b from-banana/15 to-transparent px-4 pb-3 pt-4">
        <span className="absolute inset-x-0 top-2 mx-auto block h-1 w-10 rounded-full bg-foreground/15 sm:hidden" />
        <DialogPrimitive.Close
          className="absolute end-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-card/80 text-foreground shadow-sm"
          aria-label={tr("إغلاق")}
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
        <div className="flex items-center gap-3 pe-10 pt-2">
          <PrizeImage title={contest.prize.title} image={contest.prize.image} size={84} />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <PhaseBadge phase={contest.phase} />
              {mine?.won ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-banana px-2 py-0.5 text-[10.5px] font-black text-banana-ink">
                  <Trophy className="h-3 w-3" aria-hidden="true" /> {tr("فزت!")}
                </span>
              ) : null}
            </div>
            <DialogPrimitive.Title className="text-[17px] font-black leading-snug text-foreground">
              {contest.title}
            </DialogPrimitive.Title>
            <p className="mt-0.5 text-[12.5px] font-bold text-muted-foreground" dir="auto">
              🎁 {contest.prize.title}
              {contest.prize.note ? ` — ${contest.prize.note}` : ""}
            </p>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] font-bold text-muted-foreground">
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
                {contest.participants.toLocaleString("en-US")}
              </span>
              {tr("مشارك")}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
            <span dir="ltr" className="tabular-nums">
              {contest.winnersCount}
            </span>
            {contest.winnersCount === 1 ? tr("فائز") : tr("فائزين")}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6 pt-4">
        {contest.phase === "drawn" ? <Winners contest={contest} /> : null}

        {mine && mine.tickets > 0 ? (
          <div className="flex items-start gap-2 rounded-2xl border border-leaf/30 bg-leaf/10 p-3 text-[13px] font-bold text-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-leaf" aria-hidden="true" />
            <div className="min-w-0">
              <p>
                {tr("أنت مشارك بـ")}{" "}
                <span dir="ltr" className="tabular-nums">
                  {mine.tickets}
                </span>{" "}
                {mine.tickets === 1 ? tr("تذكرة") : tr("تذاكر")}
              </p>
              <p className="mt-1 flex flex-wrap gap-1" dir="ltr">
                {mine.entryNumbers.slice(0, 24).map((n) => (
                  <span
                    key={n}
                    className="rounded-md bg-card px-1.5 py-0.5 text-[11px] font-black tabular-nums"
                  >
                    #{n}
                  </span>
                ))}
              </p>
            </div>
          </div>
        ) : null}

        {contest.description ? (
          <p
            className="whitespace-pre-line text-[13.5px] leading-relaxed text-foreground"
            dir="auto"
          >
            {contest.description}
          </p>
        ) : null}

        {contest.conditions.length ? (
          <section className="rounded-2xl border border-border bg-card p-3">
            <h3 className="mb-2 text-[13px] font-black text-foreground">{tr("الشروط")}</h3>
            <ol className="space-y-2">
              {contest.conditions.map((condition, index) => (
                <li key={index} className="flex items-start gap-2 text-[13px] leading-relaxed">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-banana/25 text-[11px] font-black text-foreground">
                    {index + 1}
                  </span>
                  <span dir="auto">{condition}</span>
                </li>
              ))}
            </ol>
            {contest.instagramUrl ? (
              <a
                href={contest.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-[13px] font-black text-white"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                {tr("افتح المنشور على إنستغرام")}
              </a>
            ) : null}
          </section>
        ) : contest.instagramUrl ? (
          <a
            href={contest.instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-[13px] font-black text-white"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {tr("افتح المنشور على إنستغرام")}
          </a>
        ) : null}

        <Requirements contest={contest} />

        {contest.drawSource === "instagram" ? (
          <InstagramHowTo contest={contest} />
        ) : contest.phase === "open" ? (
          <EntryPanel contest={contest} onClose={onClose} />
        ) : contest.phase === "upcoming" ? (
          <Notice>{tr("المسابقة لم تبدأ بعد — عُد عند بدايتها للمشاركة.")}</Notice>
        ) : contest.phase === "ended" ? (
          <Notice>{tr("انتهى وقت الدخول، والسحب قريباً.")}</Notice>
        ) : null}

        {contest.phase === "drawn" && contest.proof ? <Proof contest={contest} /> : null}
      </div>
    </>
  );
}

function Notice({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "warn";
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-2xl border p-3 text-[12.5px] font-bold leading-relaxed",
        tone === "warn"
          ? "border-amber-500/30 bg-amber-500/10 text-foreground"
          : "border-border bg-muted/50 text-foreground",
      )}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Requirements({ contest }: { contest: ContestView }) {
  const { telegram, minCompletedOrders, minAccountAgeDays } = contest.requirements;
  const items = [
    telegram ? tr("حساب مربوط بتلغرام") : "",
    minCompletedOrders > 0 ? `${tr("طلبات مكتملة على الأقل:")} ${minCompletedOrders}` : "",
    minAccountAgeDays > 0 ? `${tr("عمر الحساب بالأيام على الأقل:")} ${minAccountAgeDays}` : "",
    contest.maxEntriesPerUser > 1
      ? `${tr("حتى")} ${contest.maxEntriesPerUser} ${tr("تذاكر لكل مشارك")}`
      : contest.drawSource === "site"
        ? tr("تذكرة واحدة لكل مشارك")
        : "",
    contest.maxParticipants > 0 ? `${tr("الحد الأقصى للمشاركين:")} ${contest.maxParticipants}` : "",
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <section>
      <h3 className="mb-1.5 text-[12px] font-black text-muted-foreground">
        {tr("من يحق له الدخول")}
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] font-bold"
          >
            <BadgeCheck className="h-3.5 w-3.5 text-leaf" aria-hidden="true" />
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}

function InstagramHowTo({ contest }: { contest: ContestView }) {
  return (
    <section className="rounded-2xl border border-[#DD2A7B]/25 bg-[#DD2A7B]/5 p-3 text-[13px] leading-relaxed">
      <h3 className="mb-1 text-[13px] font-black text-foreground">📸 {tr("طريقة الدخول")}</h3>
      <p className="text-foreground">
        {tr(
          "علّق على منشور إنستغرام حسب الشروط. يختار النظام الفائز من التعليقات المطابقة بسحب عادل — تعليق واحد لكل حساب.",
        )}
      </p>
      <p className="mt-1.5 text-muted-foreground">
        {tr(
          "إن فزت يصلك كود الجائزة في رسائل إنستغرام — أدخله في «لديك كود جائزة؟» لتصل اللعبة إلى ألعابك.",
        )}
      </p>
      {contest.phase === "ended" ? (
        <p className="mt-1.5 font-bold text-foreground">
          {tr("انتهى وقت التعليق، والسحب قريباً.")}
        </p>
      ) : null}
    </section>
  );
}

function EntryPanel({ contest, onClose }: { contest: ContestView; onClose: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const mine = contest.mine;

  if (!user) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4 text-center">
        <p className="mb-3 text-[13px] font-bold text-foreground">
          {tr("سجّل الدخول لتشارك في المسابقة.")}
        </p>
        <button
          type="button"
          onClick={() => {
            rememberAfterSignIn(`/banana_market?tab=events&contest=${contest.id}`);
            onClose();
            void navigate({ to: "/auth" });
          }}
          className="min-h-11 w-full rounded-xl bg-foreground text-[14px] font-black text-background"
        >
          {tr("تسجيل الدخول")}
        </button>
      </section>
    );
  }

  const blockers = mine?.blockers ?? [];
  if (blockers.length) {
    const onlyFull = mine && mine.tickets > 0 && mine.tickets >= contest.maxEntriesPerUser;
    return onlyFull ? null : (
      <Notice tone="warn">
        <ul className="space-y-1">
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      </Notice>
    );
  }

  return (
    <section className="space-y-2.5">
      <h3 className="text-[13px] font-black text-foreground">{tr("ادخل المسابقة")}</h3>
      <div className="flex flex-wrap gap-1.5">
        <MethodChips methods={contest.entryMethods} />
      </div>
      {contest.entryMethods.map((method) => (
        <MethodRow key={method} contest={contest} method={method} />
      ))}
    </section>
  );
}

function MethodRow({ contest, method }: { contest: ContestView; method: ContestEntryMethod }) {
  const { enter } = useContests();
  const { user } = useAuth();
  const [count, setCount] = useState(1);
  const [code, setCode] = useState("");
  const press = useRef<string | null>(null);
  const room = Math.max(0, contest.maxEntriesPerUser - (contest.mine?.tickets ?? 0));

  const run = async (payload: { count?: number; code?: string; requestId?: string }) => {
    try {
      const answer = await enter.mutateAsync({ contestId: contest.id, method, ...payload });
      press.current = null;
      playSound(answer.added ? "bumper_end" : "klick", 0.55);
      if (answer.added) toast.success(answer.message);
      else toast.info(answer.message);
      if (method === "ticket") setCode("");
    } catch (error) {
      playSound("error", 0.5);
      toast.error(error instanceof Error ? error.message : tr("تعذّر الدخول، حاول مرة أخرى"));
    }
  };

  const busy = enter.isPending && enter.variables?.method === method;
  const card = "rounded-2xl border border-border bg-card p-3";
  const primary =
    "flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[13.5px] font-black transition-transform active:scale-[0.98] disabled:opacity-50";

  if (method === "free") {
    if ((contest.mine?.byMethod.free ?? 0) > 0) {
      return (
        <div className={cn(card, "flex items-center gap-2 text-[13px] font-bold text-foreground")}>
          <CheckCircle2 className="h-4 w-4 text-leaf" aria-hidden="true" />
          {tr("دخلت مجاناً — تذكرتك المجانية محسوبة.")}
        </div>
      );
    }
    return (
      <div className={card}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run({})}
          className={cn(primary, "w-full bg-banana text-banana-ink")}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
          {tr("ادخل مجاناً")}
        </button>
      </div>
    );
  }

  if (method === "bananas") {
    const closed = isUnderMaintenance("bananas");
    const total = count * contest.bananaCost;
    const balance = Number(user?.bananaBalance ?? 0);
    return (
      <div className={card}>
        <div className="mb-2 flex items-center justify-between gap-2 text-[12.5px] font-bold">
          <span>
            🍌 {tr("كل تذكرة بـ")}{" "}
            <span dir="ltr" className="tabular-nums">
              {contest.bananaCost.toLocaleString("en-US")}
            </span>{" "}
            {tr("موزة")}
          </span>
          <span className="text-muted-foreground">
            {tr("رصيدك:")}{" "}
            <span dir="ltr" className="tabular-nums">
              {balance.toLocaleString("en-US")}
            </span>
          </span>
        </div>
        {closed ? (
          <p className="rounded-xl bg-amber-500/10 p-2.5 text-[12px] font-bold text-foreground">
            {tr("الموز تحت الصيانة — الدخول بالموز متوقف مؤقتاً.")}
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl border border-border" dir="ltr">
              <button
                type="button"
                aria-label={tr("أقل")}
                disabled={count <= 1}
                onClick={() => setCount((n) => Math.max(1, n - 1))}
                className="grid h-11 w-10 place-items-center disabled:opacity-40"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-8 text-center text-[15px] font-black tabular-nums">{count}</span>
              <button
                type="button"
                aria-label={tr("أكثر")}
                disabled={count >= room}
                onClick={() => setCount((n) => Math.min(room, n + 1))}
                className="grid h-11 w-10 place-items-center disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              disabled={busy || room <= 0 || total > balance}
              onClick={() => {
                press.current ??= pressId("cst");
                void run({ count, requestId: press.current });
              }}
              className={cn(primary, "flex-1 bg-foreground text-background")}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {total > balance ? tr("رصيد الموز لا يكفي") : tr("ادخل بـ")}{" "}
              {total <= balance ? (
                <span dir="ltr" className="tabular-nums">
                  {total.toLocaleString("en-US")} 🍌
                </span>
              ) : null}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (method === "ticket") {
    return (
      <div className={card}>
        <label
          className="mb-1.5 block text-[12.5px] font-bold text-foreground"
          htmlFor={`code-${contest.id}`}
        >
          🔑 {tr("لديك تذكرة من الإدارة؟ أدخل رقمها")}
        </label>
        <div className="flex gap-2">
          <input
            id={`code-${contest.id}`}
            value={code}
            onChange={(event) => setCode(formatTyped(event.target.value))}
            placeholder="XXXXX-XXXXX"
            dir="ltr"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-center font-mono text-[15px] font-black tracking-[0.12em] outline-none focus:ring-2 focus:ring-banana"
          />
          <button
            type="button"
            disabled={busy || code.replace(/-/g, "").length !== 10}
            onClick={() => void run({ code })}
            className={cn(primary, "bg-foreground text-background")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {tr("استخدم")}
          </button>
        </div>
      </div>
    );
  }

  // referral
  return (
    <div className={card}>
      <p className="mb-2 text-[12.5px] font-bold leading-relaxed text-foreground">
        🤝{" "}
        {contest.referralQualifier === "signup"
          ? tr("كل صديق يسجّل برابط إحالتك بعد بدء المسابقة = تذكرة.")
          : tr("كل صديق يشتري أول طلب برابط إحالتك بعد بدء المسابقة = تذكرة.")}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run({})}
          className={cn(primary, "flex-1 bg-foreground text-background")}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {tr("احسب تذاكر إحالاتي")}
        </button>
        <Link
          to="/refer"
          className={cn(primary, "border border-border bg-background text-foreground")}
        >
          {tr("رابطي")}
        </Link>
      </div>
    </div>
  );
}

/** «A7K2Q9XMPH» → «A7K2Q-9XMPH», as it is typed. */
function formatTyped(value: string): string {
  const bare = value
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, 10);
  return bare.length > 5 ? `${bare.slice(0, 5)}-${bare.slice(5)}` : bare;
}

function Winners({ contest }: { contest: ContestView }) {
  if (!contest.winners.length) {
    return <Notice>{tr("تم السحب ولم يُعلن فائز بعد.")}</Notice>;
  }
  return (
    <section className="rounded-2xl border border-banana/40 bg-banana/10 p-3">
      {contest.mine?.won ? (
        <p className="mb-2 rounded-xl bg-banana px-3 py-2 text-[13px] font-black text-banana-ink">
          🎉 {tr("مبروك! اللعبة في «جوائزي» أعلى الصفحة — اضغط «استيراد» لتصلك مجاناً.")}
        </p>
      ) : null}
      <h3 className="mb-2 flex items-center gap-1.5 text-[14px] font-black text-foreground">
        <Trophy className="h-4 w-4" aria-hidden="true" />
        {contest.winners.length === 1 ? tr("الفائز") : tr("الفائزون")}
      </h3>
      <ul className="space-y-1.5">
        {contest.winners.map((winner) => (
          <li
            key={`${winner.position}-${winner.name}`}
            className="flex items-center justify-between gap-2 rounded-xl bg-card px-3 py-2 text-[13px] font-bold"
          >
            <span className="min-w-0 truncate" dir="auto">
              {winner.position === 1
                ? "🥇"
                : winner.position === 2
                  ? "🥈"
                  : winner.position === 3
                    ? "🥉"
                    : "🏅"}{" "}
              {winner.name}
              {winner.status === "pending" ? (
                <span className="ms-1.5 text-[11px] text-muted-foreground">
                  ({tr("بانتظار التأكيد")})
                </span>
              ) : null}
            </span>
            {winner.entryNo !== null && winner.source === "site" ? (
              <span
                dir="ltr"
                className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] tabular-nums"
              >
                #{winner.entryNo}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Proof({ contest }: { contest: ContestView }) {
  const proof = contest.proof!;
  return (
    <details className="group rounded-2xl border border-border bg-card p-3 text-[12px]">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-black text-foreground">
        <ShieldCheck className="h-4 w-4 text-leaf" aria-hidden="true" />
        {tr("كيف نعرف أن السحب عادل؟")}
      </summary>
      <div className="mt-2 space-y-1.5 leading-relaxed text-muted-foreground">
        <p>
          {tr(
            "اختار النظام الفائز عشوائياً بنفسه، دون أن يختار أحد. البذرة العشوائية منشورة أدناه، ومنها والتذاكر المرقّمة يخرج الفائز نفسه في كل مرة — لا يمكن تغييره بعد السحب.",
          )}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1" dir="ltr">
          <dt className="font-bold">tickets</dt>
          <dd className="tabular-nums">{proof.poolSize}</dd>
          <dt className="font-bold">algorithm</dt>
          <dd className="break-all">{proof.algorithm}</dd>
          <dt className="font-bold">seed</dt>
          <dd className="break-all font-mono">{proof.seed}</dd>
          <dt className="font-bold">pool</dt>
          <dd className="break-all font-mono">{proof.poolDigest}</dd>
          <dt className="font-bold">drawn</dt>
          <dd>{new Date(proof.drawnAt).toISOString().replace("T", " ").slice(0, 16)} UTC</dd>
        </dl>
      </div>
    </details>
  );
}
