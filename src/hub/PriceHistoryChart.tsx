import { useEffect, useMemo, useRef, useState } from "react";
import type { PriceHistory } from "@/hub/types";
import {
  HISTORY_WINDOWS,
  computePriceVerdict,
  computeWindowStats,
  type HistoryWindow,
} from "@/hub/utils/priceIntelligence";
import { Segmented } from "@/hub/ui/Bits";
import { useI18n } from "@/hub/i18n";
import { formatAmount, formatDate, formatPercent } from "@/hub/utils/format";
import { cn } from "@/hub/utils/cn";
import { usePrefersReducedMotion } from "@/hub/hooks/useMediaQuery";

/**
 * Price history chart.
 *
 * Hand-rolled SVG rather than a charting library: the series is a step function
 * of at most a few hundred points, and a dependency-free chart keeps the hub's
 * bundle small enough to stay fast with thirty sections on the page.
 *
 * The line is drawn with `stroke-dasharray` so the reveal animation is a single
 * CSS transition on one property, not a per-frame JS redraw.
 */

const VIEW_W = 720;
const VIEW_H = 220;
const PAD = { top: 16, right: 8, bottom: 22, left: 8 };

interface Props {
  history?: PriceHistory;
  /** Starting window; the user can change it. */
  defaultWindow?: HistoryWindow;
  compact?: boolean;
}

export default function PriceHistoryChart({ history, defaultWindow = "6m", compact }: Props) {
  const { t, intlLocale } = useI18n();
  const reduceMotion = usePrefersReducedMotion();
  const [window_, setWindow] = useState<HistoryWindow>(defaultWindow);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);
  const [drawn, setDrawn] = useState(reduceMotion);

  const stats = useMemo(() => computeWindowStats(history, window_), [history, window_]);
  const verdict = useMemo(
    () => (stats ? computePriceVerdict(stats, history?.allTimeLow) : null),
    [stats, history?.allTimeLow],
  );

  const geometry = useMemo(() => {
    if (!stats || stats.points.length < 2) return null;

    const prices = stats.points.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    // Pad the range so a flat series does not collapse onto one line.
    const span = max - min || max * 0.15 || 1;
    const lo = min - span * 0.18;
    const hi = max + span * 0.18;

    const innerW = VIEW_W - PAD.left - PAD.right;
    const innerH = VIEW_H - PAD.top - PAD.bottom;

    const x = (index: number) => PAD.left + (index / Math.max(1, stats.points.length - 1)) * innerW;
    const y = (price: number) => PAD.top + innerH - ((price - lo) / (hi - lo)) * innerH;

    // Step path: a price holds until an observation changes it.
    const firstPoint = stats.points[0];
    let line = `M ${x(0)} ${y(firstPoint ? firstPoint.price : 0)}`;
    for (let i = 1; i < stats.points.length; i += 1) {
      const prev = stats.points[i - 1];
      const cur = stats.points[i];
      if (!prev || !cur) continue;
      line += ` L ${x(i)} ${y(prev.price)} L ${x(i)} ${y(cur.price)}`;
    }
    const area = `${line} L ${x(stats.points.length - 1)} ${PAD.top + innerH} L ${x(0)} ${PAD.top + innerH} Z`;

    return {
      x,
      y,
      line,
      area,
      averageY: y(stats.average),
      lowIndex: stats.points.findIndex((p) => p.price === stats.low.price),
    };
  }, [stats]);

  // Kick the draw animation once the chart is on screen.
  useEffect(() => {
    if (reduceMotion) {
      setDrawn(true);
      return;
    }
    setDrawn(false);
    const node = pathRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          requestAnimationFrame(() => setDrawn(true));
          observer.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [geometry, reduceMotion]);

  if (!history || !stats || !geometry) {
    return (
      <p className="rounded-2xl bg-white/[0.03] p-6 text-center text-sm muted">
        {t("history.notEnoughData")}
      </p>
    );
  }

  const money = (amount: number) => formatAmount(amount, stats.currency, intlLocale);
  const hovered = hoverIndex != null ? stats.points[hoverIndex] : null;
  const windowLabel = t(`history.window${windowKey(window_)}` as never);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <Figure label={t("history.current")} value={money(stats.current)} strong />
          <Figure label={t("history.lowest")} value={money(stats.low.price)} tone="good" />
          <Figure label={t("history.average")} value={money(stats.average)} />
          {!compact && <Figure label={t("history.highest")} value={money(stats.high.price)} />}
        </div>
        <Segmented<HistoryWindow>
          size="sm"
          value={window_}
          onChange={setWindow}
          ariaLabel={t("history.title")}
          options={HISTORY_WINDOWS.map((w) => ({
            id: w.id,
            label: t(`history.window${windowKey(w.id)}` as never),
          }))}
        />
      </div>

      <div className="relative overflow-hidden rounded-2xl bg-black/25 p-1">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-[190px] w-full sm:h-[220px]"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${t("history.title")} — ${windowLabel}`}
          onMouseLeave={() => setHoverIndex(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - rect.left) / rect.width;
            const index = Math.round(ratio * (stats.points.length - 1));
            setHoverIndex(Math.max(0, Math.min(stats.points.length - 1, index)));
          }}
        >
          <defs>
            <linearGradient id="phc-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(52 211 153)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="rgb(52 211 153)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Average reference */}
          <line
            x1={PAD.left}
            x2={VIEW_W - PAD.right}
            y1={geometry.averageY}
            y2={geometry.averageY}
            stroke="rgb(255 255 255 / 0.18)"
            strokeWidth="1"
            strokeDasharray="4 5"
          />

          <path
            d={geometry.area}
            fill="url(#phc-area)"
            opacity={drawn ? 1 : 0}
            className="transition-opacity duration-700 delay-300"
          />

          <path
            ref={pathRef}
            d={geometry.line}
            fill="none"
            stroke="rgb(52 211 153)"
            strokeWidth="2"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{
              strokeDasharray: 4000,
              strokeDashoffset: drawn ? 0 : 4000,
              transition: reduceMotion
                ? undefined
                : "stroke-dashoffset 1.4s cubic-bezier(0.16,1,0.3,1)",
            }}
          />

          {/* Lowest-price marker */}
          {geometry.lowIndex >= 0 && (
            <circle
              cx={geometry.x(geometry.lowIndex)}
              cy={geometry.y(stats.low.price)}
              r="4"
              fill="rgb(52 211 153)"
              stroke="rgb(11 13 19)"
              strokeWidth="2"
              opacity={drawn ? 1 : 0}
              className="transition-opacity duration-500 delay-1000"
            />
          )}

          {hoverIndex != null && (
            <g>
              <line
                x1={geometry.x(hoverIndex)}
                x2={geometry.x(hoverIndex)}
                y1={PAD.top}
                y2={VIEW_H - PAD.bottom}
                stroke="rgb(255 255 255 / 0.25)"
                strokeWidth="1"
              />
              <circle
                cx={geometry.x(hoverIndex)}
                cy={geometry.y(stats.points[hoverIndex]?.price ?? 0)}
                r="4"
                fill="#fff"
              />
            </g>
          )}
        </svg>

        {hovered && (
          <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
            <span className="rounded-lg border border-white/10 bg-ink-850/95 px-2.5 py-1 text-[11px] font-bold backdrop-blur">
              <span className="num">{money(hovered.price)}</span>
              <span className="ms-2 font-normal muted">{formatDate(hovered.date, intlLocale)}</span>
            </span>
          </div>
        )}

        {/*
          The plot is drawn left-to-right regardless of page direction (the
          convention for time series), so the axis labels must be pinned LTR
          too — otherwise RTL flips them and the oldest date lands under the
          newest data point.
        */}
        <div dir="ltr" className="flex justify-between px-3 pb-1 text-[10px] muted">
          <span dir="auto">{formatDate(stats.points[0]?.date ?? "", intlLocale)}</span>
          <span dir="auto">
            {formatDate(stats.points[stats.points.length - 1]?.date ?? "", intlLocale)}
          </span>
        </div>
      </div>

      {/* Derived judgement — computed from the series above, never estimated. */}
      {verdict && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-3 text-sm",
            verdict.id === "great" && "bg-good/10",
            verdict.id === "good" && "bg-good/[0.07]",
            verdict.id === "average" && "bg-white/[0.04]",
            verdict.id === "wait" && "bg-warn/[0.08]",
          )}
        >
          <span
            className={cn(
              "font-extrabold",
              verdict.id === "great" || verdict.id === "good" ? "text-good" : "",
              verdict.id === "wait" && "text-warn",
            )}
          >
            {t(`history.verdict${capitalise(verdict.id)}` as never)}
          </span>
          <span className="text-xs muted">
            {verdict.isAllTimeLow
              ? t("history.atAllTimeLow")
              : t(verdict.deltaFromAverage < 0 ? "history.belowAverage" : "history.aboveAverage", {
                  percent: formatPercent(Math.abs(verdict.deltaFromAverage), intlLocale),
                  window: windowLabel,
                })}
          </span>
          {history.allTimeLow && (
            <span className="ms-auto text-xs muted">
              {t("history.allTimeLow")}:{" "}
              <b className="num text-good">{money(history.allTimeLow.price)}</b>
              <span className="ms-1">({formatDate(history.allTimeLow.date, intlLocale)})</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "good";
}) {
  return (
    <span className="flex flex-col">
      <span className="text-[10px] font-bold uppercase tracking-wider muted">{label}</span>
      <span
        className={cn(
          "num font-extrabold tabular-nums",
          strong ? "text-xl" : "text-sm",
          tone === "good" && "text-good",
        )}
      >
        {value}
      </span>
    </span>
  );
}

const windowKey = (w: HistoryWindow) =>
  ({ "7d": "7d", "30d": "30d", "3m": "3m", "6m": "6m", "1y": "1y", all: "All" })[w];
const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
