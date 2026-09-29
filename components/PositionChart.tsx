"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export type CheckPoint = { checkedAt: string; position: number | null; url?: string | null; error?: string | null };

export default function PositionChart({
  checks,
  maxCheckDepth = 100,
}: {
  checks: CheckPoint[];
  maxCheckDepth?: number;
}) {
  // Oldest first for a left-to-right timeline; missing positions render as gaps.
  const data = checks
    .slice()
    .reverse()
    .map((c) => ({
      date: new Date(c.checkedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      position: c.position,
    }));

  if (data.length < 2) {
    return <p className="text-xs text-muted py-4">Not enough history yet for a trend line.</p>;
  }

  return (
    <div className="h-44 w-full rounded-md bg-surface border border-line p-3">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#E1E6E1" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#5F6F66" }} stroke="#E1E6E1" />
          {/* Rank charts read best inverted — position 1 at the top */}
          <YAxis reversed tick={{ fontSize: 11, fill: "#5F6F66" }} stroke="#E1E6E1" allowDecimals={false} />
          <Tooltip
            formatter={(value) => (value == null ? `Outside top ${maxCheckDepth}` : `#${value}`)}
            contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: "#E1E6E1" }}
          />
          <Line
            type="monotone"
            dataKey="position"
            stroke="#0B6E4F"
            strokeWidth={2}
            dot={{ r: 3, fill: "#0B6E4F" }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
