import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useReducedMotion } from "@/hooks/useReducedMotion";
import { tr } from "@/i18n";
import { cdnImage } from "@/lib/img";
import { cn } from "@/lib/utils";

/**
 * الروليت الأفقي — the case-opening strip that replaces the circular wheel.
 *
 * «ألغِ تصميم العجلة الدائرية الحالي. استبدله بـ Horizontal Case Opening
 *  Roulette… البطاقات تتحرك أفقياً تحت مؤشر ثابت في الوسط… كل بطاقة لعبة:
 *  صورة مربعة 1:1 ثم اسم اللعبة أسفلها.»
 *
 * ## The animation is not the draw
 *
 * «لا تجعل CSS/animation هي التي تحدد الفائز. الفائز معروف مسبقاً من استجابة
 *  السيرفر والAnimation فقط تعرضه. يجب أن تكون النتيجة النهائية بصرياً مطابقة
 *  100% لنتيجة السيرفر.»
 *
 * Nothing in this file picks anything. `outcome` is the server's answer — by
 * the time it arrives the ticket is spent and the prize is recorded — so the
 * run is planned *backwards from it*: the winning card is placed at a known
 * index, the landing translate is derived from that index, and the easing
 * merely walks the offset to a number that was final before the first frame.
 * The strip cannot stop anywhere else, because there is no other number.
 *
 * ## Why the geometry is measured, never assumed
 *
 * «لا تسمح لاختلاف عرض الشاشة أن يجعل المؤشر يقف على بطاقة أخرى. استخدم
 *  القياسات الفعلية للcontainer/card للوصول إلى offset النهائي بدقة.»
 *
 * A card is 84px on a 320px Android, 104px on a 390px iPhone and 116px on a
 * tablet; the gap between two of them is a Tailwind token that a redesign can
 * change without anybody remembering this file exists. Any of those as a
 * constant in the landing equation is a strip that stops half a card off on
 * exactly the devices nobody tested on — and half a card off is a *different
 * game* under the pointer, which is the one failure this component is not
 * allowed to have. So the container width, the card width and the card-to-card
 * step are all read out of the DOM with `getBoundingClientRect`, and re-read at
 * the instant a run starts rather than trusted from an earlier render.
 *
 * Widths are read as *differences* between two rectangles on purpose: the track
 * carries a translate, and a translate shifts both rectangles equally, so the
 * difference survives being measured mid-flight while an absolute left would
 * not.
 *
 * ## Why requestAnimationFrame and not a CSS transition
 *
 * A CSS transition commits to its end position the moment it starts. If
 * anything reflows mid-flight — a webfont landing, the mobile address bar
 * collapsing, an orientation change — the pixel it was sent to is no longer the
 * pixel the winner occupies, and the strip glides to a confident stop on the
 * neighbour. The easing here is ours, so the target can be recomputed from real
 * geometry and the last frame can be written exactly rather than approached.
 *
 * ## Why the track is a short sequence repeated, and not the pool
 *
 * «في وضع Idle: الروليت يتحرك ببطء وبشكل مستمر Loop وكأنه لا نهائي. لا يجب أن
 *  يبدو كقائمة قصيرة تنتهي… لا تحمل مئات الصور دفعة واحدة.»
 *
 * Both halves of that are the same trick: the idle track holds one screenful of
 * cards plus a margin, repeated just enough times to cover the viewport and one
 * wrap, and the offset is wrapped by the width of a single repetition. The seam
 * lands on identical pixels, so the loop has no visible beginning or end — and
 * a pool of four hundred games still mounts about twenty tiles and requests
 * about twenty pictures.
 */

export interface RouletteCard {
  id: string;
  title: string;
  image: string | null;
}

export interface RouletteStripProps {
  /** The sample the server sent for the ribbon. May be short; the strip repeats it. */
  cards: readonly RouletteCard[];
  /**
   * The server's answer, or null while idle. Setting this from null to a value
   * is what starts the run; the strip must land exactly on it.
   * A LOSS is `{ card: null }` — the strip still runs and stops, on a card that
   * is NOT presented as a prize (the caller shows the loss popup).
   */
  outcome: { runId: string; card: RouletteCard | null } | null;
  /** Called once when the run has finished and the popup should open. */
  onSettled?: () => void;
  className?: string;
}

/** «يتحرك ببطء» — about a card every four seconds, slow enough to read a title. */
const IDLE_DRIFT_PX_PER_SECOND = 28;
/** «animation سريعة… السرعة تنخفض تدريجياً» — long enough for the slow-down to read. */
const RUN_DURATION_MS = 4200;
/** «تمر عدة ألعاب» — the fewest cards a run may travel past before it may land. */
const MIN_RUN_CARDS = 24;
/** A ceiling on the plan, so a desktop-wide container cannot mount a hundred tiles. */
const MAX_RUN_CARDS = 120;
/** The reduced-motion settle: no travel, just long enough not to be a jump-cut. */
const REDUCED_SETTLE_MS = 260;
/**
 * Used only when a rectangle comes back empty — a strip inside a collapsed
 * parent, or rendered where there is no layout at all. They keep the arithmetic
 * finite; nothing lands on them while the element has a real width.
 */
const FALLBACK_CARD_PX = 88;
const FALLBACK_STEP_PX = 98;
/** Tiles rendered before the first measurement, so there is something to measure. */
const PROVISIONAL_VISIBLE = 5;
/** Cards held beyond the visible run, so neither edge of the strip is ever bare. */
const MARGIN_CARDS = 6;

type Phase = "idle" | "running" | "settled";

interface StripMetrics {
  /** The visible width of the strip — the pointer sits at half of it. */
  container: number;
  /** One card's own width. */
  card: number;
  /** Card centre to card centre: the width plus whatever gap the design uses. */
  step: number;
  /** The first card's offset inside the track, in case the track ever gains padding. */
  lead: number;
}

interface ActiveRun {
  runId: string;
  sequence: RouletteCard[];
  winnerIndex: number;
  /** False for «حظ أوفر»: the strip stops on a card that is not a prize. */
  prize: boolean;
}

interface RunPlan {
  sequence: RouletteCard[];
  winnerIndex: number;
  /** The one number the whole run exists to reach. */
  target: number;
}

interface FlightPlan {
  runId: string;
  from: number;
  to: number;
  startedAt: number | null;
}

const INITIAL_METRICS: StripMetrics = {
  container: 0,
  card: FALLBACK_CARD_PX,
  step: FALLBACK_STEP_PX,
  lead: 0,
};

/** Fast, then slow, and never past the target — `1 - (1 - t)^5` is monotonic. */
function easeOutQuint(progress: number): number {
  const t = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  return 1 - Math.pow(1 - t, 5);
}

function sameMetrics(a: StripMetrics, b: StripMetrics): boolean {
  return a.container === b.container && a.card === b.card && a.step === b.step && a.lead === b.lead;
}

/**
 * What the strip actually is, in pixels, right now.
 *
 * The step is taken from two neighbouring cards rather than from the card width
 * plus a guessed gap, because the gap is a class name and this file should not
 * have an opinion about which one.
 */
function measureStrip(viewport: HTMLElement | null, track: HTMLElement | null): StripMetrics {
  if (!viewport || !track) return INITIAL_METRICS;

  const viewportBox = viewport.getBoundingClientRect();
  const trackBox = track.getBoundingClientRect();
  const tiles = track.querySelectorAll<HTMLElement>("[data-roulette-card]");
  const first = tiles[0]?.getBoundingClientRect();
  const second = tiles[1]?.getBoundingClientRect();

  const card = first && first.width > 0 ? first.width : FALLBACK_CARD_PX;
  const measuredStep = first && second ? second.left - first.left : 0;

  return {
    container: viewportBox.width > 0 ? viewportBox.width : 0,
    card,
    step: measuredStep > 0 ? measuredStep : card > 0 ? card : FALLBACK_STEP_PX,
    lead: first ? first.left - trackBox.left : 0,
  };
}

/**
 * The card a losing run stops on.
 *
 * «حظ أوفر» still spins and still stops somewhere, and that somewhere is chosen
 * here rather than by the server, which correctly has nothing to say about a
 * prize it did not award. It is derived from `runId` instead of `Math.random`
 * so that a re-render — a parent re-rendering, a StrictMode double invoke, the
 * caller handing the same outcome object back — cannot change the card the
 * strip is already standing on.
 */
function landingCardFor(
  outcome: { runId: string; card: RouletteCard | null },
  pool: readonly RouletteCard[],
): RouletteCard | null {
  if (outcome.card) return outcome.card;
  if (pool.length === 0) return null;
  let hash = 0;
  for (let index = 0; index < outcome.runId.length; index += 1) {
    hash = (hash * 31 + outcome.runId.charCodeAt(index)) >>> 0;
  }
  return pool[hash % pool.length];
}

/**
 * Where the winner goes, and where the track has to end up for it to be there.
 *
 * The run's lead cards repeat the same sample the idle loop is showing, so that
 * starting the run from the idle offset continues the picture the member is
 * already looking at instead of cutting to a new one.
 */
function planRun(
  winner: RouletteCard,
  sample: readonly RouletteCard[],
  metrics: StripMetrics,
  from: number,
): RunPlan {
  const step = metrics.step > 0 ? metrics.step : FALLBACK_STEP_PX;
  const pointer = metrics.container / 2;
  /*
    `from` is the idle offset, already negative and possibly a full sequence
    into the track. Subtracting it is what keeps the run travelling leftwards by
    at least MIN_RUN_CARDS no matter how long the strip has been drifting — a
    run that had to travel backwards would be a rewind, not a spin.
  */
  const reach = pointer - metrics.lead - metrics.card / 2 - from + step * MIN_RUN_CARDS;
  const winnerIndex = Math.max(MIN_RUN_CARDS, Math.min(MAX_RUN_CARDS, Math.ceil(reach / step)));
  // Enough cards past the winner to fill the half-screen to its right at rest.
  const trail = Math.ceil(pointer / step) + 2;

  const sequence: RouletteCard[] = [];
  for (let index = 0; index <= winnerIndex + trail; index += 1) {
    sequence.push(index === winnerIndex ? winner : sample[index % sample.length]);
  }

  return {
    sequence,
    winnerIndex,
    // Card centre = lead + index*step + card/2. Put that centre on the pointer.
    target: pointer - (metrics.lead + winnerIndex * step + metrics.card / 2),
  };
}

export function RouletteStrip({
  cards,
  outcome,
  onSettled,
  className,
}: RouletteStripProps): React.JSX.Element {
  const reduceMotion = useReducedMotion();

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const [metrics, setMetrics] = useState<StripMetrics>(INITIAL_METRICS);
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [landing, setLanding] = useState(false);
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  const offsetRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const flightRef = useRef<FlightPlan | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The run we have already begun. «نفس runId» arriving again is the same answer. */
  const startedRunRef = useRef<string | null>(null);
  /** The run we have already announced, so `onSettled` cannot fire twice. */
  const settledRunRef = useRef<string | null>(null);

  /*
    Everything the run needs to read but must not be *triggered* by. The run
    effect fires on one thing only — a new answer from the server — and a pool
    that changed identity or a parent that passed a fresh `onSettled` arrow is
    not a new answer. Kept in refs rather than in the dependency list so that
    the list can stay honest.
  */
  const cardsRef = useRef<readonly RouletteCard[]>(cards);
  const sampleRef = useRef<readonly RouletteCard[]>(cards);
  const sequenceWidthRef = useRef(0);
  const reduceMotionRef = useRef(reduceMotion);
  const onSettledRef = useRef<(() => void) | undefined>(onSettled);

  /**
   * The idle window: one screenful of cards plus a margin, and never the pool.
   *
   * It is a fixed slice rather than one that advances as the loop wraps. A
   * rotating window would change which game is on a tile at the exact moment
   * the seam passes the viewport, which is the one moment in the loop where a
   * swap is visible.
   */
  const sample = useMemo(() => {
    if (cards.length === 0) return [] as RouletteCard[];
    const visible =
      metrics.container > 0 ? Math.ceil(metrics.container / metrics.step) : PROVISIONAL_VISIBLE;
    return cards.slice(0, Math.min(cards.length, visible + MARGIN_CARDS));
  }, [cards, metrics.container, metrics.step]);

  const idleSequence = useMemo(() => {
    if (sample.length === 0) return [] as RouletteCard[];
    const sequenceWidth = sample.length * metrics.step;
    // Cover the viewport plus one whole repetition, which is what the wrap eats.
    const repeats = Math.max(2, Math.ceil(metrics.container / Math.max(sequenceWidth, 1)) + 1);
    const out: RouletteCard[] = [];
    for (let repeat = 0; repeat < repeats; repeat += 1) out.push(...sample);
    return out;
  }, [sample, metrics.container, metrics.step]);

  useEffect(() => {
    cardsRef.current = cards;
    sampleRef.current = sample;
    sequenceWidthRef.current = sample.length * metrics.step;
    reduceMotionRef.current = reduceMotion;
    onSettledRef.current = onSettled;
  });

  const applyOffset = useCallback(() => {
    const track = trackRef.current;
    if (track) {
      track.style.transform = `translate3d(${offsetRef.current.toFixed(2)}px, 0, 0)`;
    }
  }, []);

  /*
    React never writes `transform` here — it is not in the style prop — but a
    re-render that replaces the track's children is exactly when a stale frame
    would show, so the offset is re-asserted after every commit.
  */
  useEffect(applyOffset);

  const finish = useCallback((runId: string) => {
    if (settledRunRef.current === runId) return;
    settledRunRef.current = runId;
    setPhase("settled");
    onSettledRef.current?.();
  }, []);

  const frame = useCallback(
    (timestamp: number) => {
      const flight = flightRef.current;

      if (flight) {
        if (flight.startedAt === null) flight.startedAt = timestamp;
        const progress = (timestamp - flight.startedAt) / RUN_DURATION_MS;
        if (progress >= 1) {
          // The last frame is written, not approached: this is the server's answer.
          offsetRef.current = flight.to;
          applyOffset();
          flightRef.current = null;
          frameRef.current = null;
          finish(flight.runId);
          return;
        }
        offsetRef.current = flight.from + (flight.to - flight.from) * easeOutQuint(progress);
      } else {
        if (lastFrameRef.current === null) lastFrameRef.current = timestamp;
        // Clamped, so a backgrounded tab does not resume with one enormous jump.
        const delta = Math.min(64, Math.max(0, timestamp - lastFrameRef.current));
        lastFrameRef.current = timestamp;
        offsetRef.current -= (IDLE_DRIFT_PX_PER_SECOND * delta) / 1000;
        const width = sequenceWidthRef.current;
        // The seam: one repetition back is the same picture, to the pixel.
        if (width > 0 && offsetRef.current <= -width) offsetRef.current += width;
      }

      applyOffset();
      frameRef.current = requestAnimationFrame(frame);
    },
    [applyOffset, finish],
  );

  const startFrames = useCallback(() => {
    if (frameRef.current !== null) return;
    lastFrameRef.current = null;
    frameRef.current = requestAnimationFrame(frame);
  }, [frame]);

  const stopFrames = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    lastFrameRef.current = null;
  }, []);

  /*
    One owner for the loop. A run drives its own frames; the idle drift runs
    whenever there is no run and the reader has not asked for stillness —
    «prefers-reduced-motion» means a strip that does not move on its own, which
    a perpetual leftward crawl very much is.
  */
  useEffect(() => {
    if (phase === "running" || (phase === "idle" && !reduceMotion)) {
      startFrames();
      return stopFrames;
    }
    return undefined;
  }, [phase, reduceMotion, startFrames, stopFrames]);

  /** Re-read the strip whenever it can have changed shape. */
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    const sync = () => {
      const next = measureStrip(viewportRef.current, trackRef.current);
      setMetrics((current) => (sameMetrics(current, next) ? current : next));
    };
    sync();

    // jsdom, and a couple of older Safaris, have no ResizeObserver.
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", sync);
      return () => window.removeEventListener("resize", sync);
    }
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [idleSequence.length, run]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  /**
   * The server answered. Everything about the landing is decided here, once.
   */
  useEffect(() => {
    if (!outcome) {
      if (startedRunRef.current === null) return;
      /*
        Both ids, not just the one that gates the start. A caller that hands
        back an id it has used before is starting a new run as far as the strip
        is concerned, and a run that cannot announce itself is a popup that
        never opens.
      */
      startedRunRef.current = null;
      settledRunRef.current = null;
      flightRef.current = null;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      setRun(null);
      setLanding(false);
      setPhase("idle");
      /*
        Back into the first repetition before the idle track replaces the run's
        sequence, or the drift would resume from thousands of pixels into a
        track that is now only two screens wide and show empty space.
      */
      const width = sequenceWidthRef.current;
      if (width > 0) offsetRef.current = -(((-offsetRef.current % width) + width) % width);
      applyOffset();
      return;
    }

    // «لا تبدأ دورة ثانية» — the same run id is the same answer, not a new one.
    if (outcome.runId === startedRunRef.current) return;
    startedRunRef.current = outcome.runId;

    const winner = landingCardFor(outcome, cardsRef.current);
    if (!winner) {
      // Nothing to stop on, but the caller's popup must not be left waiting.
      finish(outcome.runId);
      return;
    }

    // Measured now, at the moment the run starts — not read from an old render.
    const measured = measureStrip(viewportRef.current, trackRef.current);
    const from = offsetRef.current;
    const sampleNow = sampleRef.current.length > 0 ? sampleRef.current : [winner];
    const plan = planRun(winner, sampleNow, measured, from);

    setRun({
      runId: outcome.runId,
      sequence: plan.sequence,
      winnerIndex: plan.winnerIndex,
      prize: outcome.card !== null,
    });

    if (reduceMotionRef.current) {
      /*
        Same final position, none of the travel: the strip is already standing
        on the winner and only settles its opacity. The popup still opens,
        because a reader who asked for less motion asked for less motion, not
        for a game that never finishes.
      */
      offsetRef.current = plan.target;
      applyOffset();
      setLanding(true);
      const runId = outcome.runId;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setLanding(false);
        finish(runId);
      }, REDUCED_SETTLE_MS);
      return;
    }

    flightRef.current = { runId: outcome.runId, from, to: plan.target, startedAt: null };
    setPhase("running");
  }, [outcome, applyOffset, finish]);

  const sequence = run ? run.sequence : idleSequence;
  /** The prize is announced only once the strip has stopped on it. */
  const prizeIndex = run && run.prize && phase === "settled" ? run.winnerIndex : -1;

  return (
    <div className={cn("w-full max-w-full", className)}>
      <div
        ref={viewportRef}
        data-roulette-viewport=""
        /*
          The geometry is written in translate-x, where positive is right in
          every direction the page can be in. Laying the track out RTL would
          mirror the card order underneath that arithmetic and put the pointer
          on the wrong neighbour, so the strip itself is a left-to-right ribbon
          inside an RTL page — the same way a row of pictures is.
        */
        dir="ltr"
        aria-label={tr("شريط الجوائز")}
        role="img"
        className="relative w-full max-w-full overflow-hidden rounded-2xl border border-border bg-card py-3"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-card to-transparent sm:w-12"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-card to-transparent sm:w-12"
        />

        {/* المؤشر الثابت في الوسط. Decorative: the answer is the card, not the arrow. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 z-20">
          <span className="absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 border-x-[7px] border-t-[9px] border-x-transparent border-t-amber-500" />
          <span className="absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2 rounded-full bg-amber-500/60" />
          <span className="absolute bottom-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[7px] border-b-[9px] border-x-transparent border-b-amber-500" />
        </div>

        <div
          ref={trackRef}
          data-roulette-track=""
          className={cn(
            "flex w-max gap-2.5 will-change-transform motion-reduce:transition-opacity motion-reduce:duration-200",
            landing ? "opacity-60" : "opacity-100",
          )}
        >
          {sequence.map((card, index) => {
            const hasPicture = card.image !== null && !broken[card.id];
            const isPrize = index === prizeIndex;
            return (
              <div
                key={`${index}-${card.id}`}
                data-roulette-card=""
                data-card-id={card.id}
                data-card-index={index}
                className="w-[84px] shrink-0 sm:w-[104px] md:w-[116px]"
              >
                <div
                  className={cn(
                    "aspect-square w-full overflow-hidden rounded-xl border bg-muted/40",
                    isPrize ? "border-amber-500 ring-2 ring-amber-500/40" : "border-border",
                  )}
                >
                  {hasPicture ? (
                    <img
                      src={cdnImage(card.image, { width: 240 })}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      onError={() => setBroken((current) => ({ ...current, [card.id]: true }))}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    /*
                      «لا تعرض صورة لعبة أخرى» — a game with no artwork gets its
                      own name on a plain tile and nothing else. Borrowing a
                      neighbour's picture would be the strip telling the member
                      they are looking at a game they are not.
                    */
                    <span className="flex h-full w-full items-center justify-center px-1.5 text-center">
                      <span className="line-clamp-3 text-[10.5px] font-bold leading-tight text-muted-foreground">
                        {card.title}
                      </span>
                    </span>
                  )}
                </div>
                {/*
                  «اسم اللعبة أسفلها». The tile already carries the name when it
                  had no picture to show, so the slot is held open rather than
                  printing it twice — the cards stay the same height either way.
                */}
                <p className="mt-1.5 h-[14px] truncate text-center text-[10.5px] font-bold leading-[14px] text-foreground">
                  {hasPicture ? card.title : ""}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default RouletteStrip;
