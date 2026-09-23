import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * The banana market price chart, split out so recharts (~300 KB) is fetched as
 * its own chunk instead of being part of the market route's initial payload.
 */
export default function BananaPriceChart({
  data,
  tooltip,
}: {
  data: unknown[];
  tooltip: React.ReactElement;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data as any[]} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="bananaPrice" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--banana)" stopOpacity={0.45} />
            <stop offset="95%" stopColor="var(--leaf)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="time"
          tick={{ fontSize: 9, fill: "currentColor", opacity: 0.35 }}
          tickLine={false}
          axisLine={false}
          minTickGap={28}
          interval="preserveStartEnd"
        />
        <YAxis domain={["dataMin - 0.02", "dataMax + 0.02"]} hide />
        <Tooltip
          content={tooltip}
          cursor={{ stroke: "currentColor", strokeOpacity: 0.25, strokeDasharray: "4 4" }}
        />
        <Area
          type="monotone"
          dataKey="price"
          stroke="var(--banana)"
          strokeWidth={3}
          fillOpacity={1}
          fill="url(#bananaPrice)"
          activeDot={{ r: 6, fill: "var(--banana)", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
