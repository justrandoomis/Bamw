import { CalendarClock, Gift, Hourglass, Trophy } from "lucide-react";

import { tr, useI18n } from "@/i18n";
import { useNow } from "@/hooks/useContests";
import {
  ENTRY_METHOD_LABELS,
  PHASE_LABELS,
  timeLeft,
  type ContestEntryMethod,
  type ContestPhase,
} from "@/lib/contests";
import { cdnImage } from "@/lib/img";
import { cn } from "@/lib/utils";

/**
 * The small pieces every contest surface shares: the prize's picture, the
 * phase, the countdown and the ways in. Kept here so the card, the sheet and
 * the admin preview cannot each draw a different version of the same fact.
 */

/** The game's square art, or its name on a plain tile — never a stand-in picture. */
export function PrizeImage({
  title,
  image,
  size = 76,
  className,
}: {
  title: string;
  image: string;
  size?: number;
  className?: string;
}) {
  if (!image) {
    return (
      <div
        className={cn(
          "grid shrink-0 place-items-center rounded-2xl bg-secondary p-1.5 text-center text-[10px] font-black leading-tight text-foreground/70",
          className,
        )}
        style={{ width: size, height: size }}
      >
        <span className="line-clamp-3" dir="auto">
          {title || <Gift className="h-6 w-6" aria-hidden="true" />}
        </span>
      </div>
    );
  }
  return (
    <img
      src={cdnImage(image, { width: size * 2 })}
      alt={title}
      loading="lazy"
      className={cn("shrink-0 rounded-2xl bg-secondary object-cover", className)}
      style={{ width: size, height: size }}
    />
  );
}

const PHASE_STYLE: Record<ContestPhase, string> = {
  open: "bg-leaf/15 text-leaf",
  upcoming: "bg-banana/20 text-foreground",
  ended: "bg-muted text-muted-foreground",
  drawn: "bg-primary/10 text-primary",
  cancelled: "bg-rind/10 text-rind",
  draft: "bg-muted text-muted-foreground",
};

export function PhaseBadge({ phase }: { phase: ContestPhase }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-black",
        PHASE_STYLE[phase],
      )}
    >
      {phase === "open" ? (
        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-leaf opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-leaf" />
        </span>
      ) : phase === "drawn" ? (
        <Trophy className="h-3 w-3" aria-hidden="true" />
      ) : null}
      {tr(PHASE_LABELS[phase])}
    </span>
  );
}

/** Day, hour, minute and second, as short as each language writes them. */
const UNITS: Record<string, { d: string; h: string; m: string; s: string }> = {
  ar: { d: "ي", h: "س", m: "د", s: "ث" },
  en: { d: "d", h: "h", m: "m", s: "s" },
  ku: { d: "ڕۆژ", h: "ک", m: "خ", s: "چ" },
  tr: { d: "g", h: "sa", m: "dk", s: "sn" },
};

/**
 * «ينتهي بعد 2ي 4س 10د» while open, «يبدأ بعد …» before it starts. Ticks
 * every second in the sheet and every half minute on a card.
 */
export function Countdown({
  phase,
  startsAt,
  endsAt,
  live = false,
  className,
}: {
  phase: ContestPhase;
  startsAt: string;
  endsAt: string;
  live?: boolean;
  className?: string;
}) {
  const { lang } = useI18n();
  const now = useNow(live ? 1000 : 30_000);
  const target = phase === "upcoming" ? startsAt : phase === "open" ? endsAt : "";
  const left = timeLeft(target, now);
  if (!left) {
    if (phase === "open" && !endsAt) {
      return (
        <span className={cn("inline-flex items-center gap-1", className)}>
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          {tr("تنتهي بإعلان من الإدارة")}
        </span>
      );
    }
    return null;
  }
  const unit = UNITS[lang] ?? UNITS.ar;
  const parts = [
    left.days ? { value: left.days, unit: unit.d } : null,
    left.days || left.hours ? { value: left.hours, unit: unit.h } : null,
    { value: left.minutes, unit: unit.m },
    live && !left.days ? { value: left.seconds, unit: unit.s } : null,
  ].filter((part): part is { value: number; unit: string } => part !== null);
  /*
    Each part is a number and its unit kept together, laid out in the page's
    own direction: in Arabic the days sit rightmost and read first, and a
    digit never ends up on the wrong side of its letter.
  */
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <Hourglass className="h-3.5 w-3.5" aria-hidden="true" />
      {phase === "upcoming" ? tr("تبدأ بعد") : tr("تنتهي بعد")}
      <span className="inline-flex items-baseline gap-1 font-black">
        {parts.map((part) => (
          <span key={part.unit} className="inline-flex items-baseline gap-px">
            <span dir="ltr" className="tabular-nums">
              {part.value}
            </span>
            <span className="text-[0.85em]">{part.unit}</span>
          </span>
        ))}
      </span>
    </span>
  );
}

const METHOD_ICON: Record<ContestEntryMethod, string> = {
  free: "🎟️",
  bananas: "🍌",
  ticket: "🔑",
  referral: "🤝",
};

export function MethodChips({
  methods,
  instagram = false,
}: {
  methods: readonly ContestEntryMethod[];
  instagram?: boolean;
}) {
  if (instagram) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#E1306C]/10 px-2 py-0.5 text-[10.5px] font-black text-[#C13584]">
        📸 {tr("من تعليقات إنستغرام")}
      </span>
    );
  }
  return (
    <>
      {methods.map((method) => (
        <span
          key={method}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-black text-foreground/80"
        >
          <span aria-hidden="true">{METHOD_ICON[method]}</span>
          {tr(ENTRY_METHOD_LABELS[method])}
        </span>
      ))}
    </>
  );
}
