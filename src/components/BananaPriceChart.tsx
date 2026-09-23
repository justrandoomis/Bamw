import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useReducedMotion } from "motion/react";

/**
 * The banana market price chart, split out so recharts (~300 KB) is fetched as
 * its own chunk instead of being part of the market route's initial payload.
 *
 * ## Why the line used to be flat
 *
 * The Y domain was `["dataMin - 0.02", "dataMax + 0.02"]` — a padding of two
 * fils, written when a banana was worth a quarter of a dinar. This shop's
 * banana is worth 0.0004 د.ع, so the padding was FIFTY TIMES the whole price
 * range: every point landed on the same pixel row in the middle of a tall
 * empty box, and a market that had moved all day drew a dead straight line.
 *
 * The padding is proportional now — eight percent of the values on screen —
 * so the series uses the height it is given whatever the price happens to be,
 * and a price that genuinely has not moved still draws flat rather than being
 * flattened by the axis.
 */
export default function BananaPriceChart({
  data,
  tooltip,
}: {
  data: unknown[];
  tooltip: React.ReactElement;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data as any[]} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="bananaPrice" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--banana)" stopOpacity={0.38} />
            <stop offset="100%" stopColor="var(--banana)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="time"
          tick={{ fontSize: 9, fill: "currentColor", opacity: 0.35 }}
          tickLine={false}
          axisLine={false}
          minTickGap={28}
          interval="preserveStartEnd"
          height={16}
        />
        {/*
          A relative breathing space, and a floor for the degenerate case: when
          every point is identical the proportional padding would be zero and
          recharts would be handed a domain of no height at all.
        */}
        <YAxis
          domain={[
            (min: number) => min - Math.max(Math.abs(min) * 0.08, 1e-9),
            (max: number) => max + Math.max(Math.abs(max) * 0.08, 1e-9),
          ]}
          hide
        />
        <Tooltip
          content={tooltip}
          cursor={{ stroke: "currentColor", strokeOpacity: 0.25, strokeDasharray: "4 4" }}
        />
        <Area
          type="monotone"
          dataKey="price"
          stroke="var(--banana)"
          strokeWidth={2.5}
          fillOpacity={1}
          fill="url(#bananaPrice)"
          isAnimationActive={!reduceMotion}
          activeDot={{ r: 5, fill: "var(--banana)", stroke: "var(--card)", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
