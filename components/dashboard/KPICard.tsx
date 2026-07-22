"use client";

import Link from "next/link";
import { ResponsiveContainer, LineChart, Line } from "recharts";
import { ArrowUpRight, ArrowDownRight, type LucideIcon } from "lucide-react";
import { useCountUp } from "@/lib/motion";

interface KPICardProps {
  label: string;
  value: string | number;
  delta: string;
  isPositive: boolean;
  sparklineData: { value: number }[];
  accentColor?: string;
  icon?: LucideIcon;
  // Omit for a stat with no dedicated destination page (e.g. a derived
  // metric like "AI Strategic Insights") — the card still animates on
  // hover, it just isn't a link.
  href?: string;
  // Page-entrance stagger delay (ms) — set by the page laying these cards
  // out in a row, since the stagger amount is a page-layout concern, not
  // something this component should hardcode.
  entranceDelayMs?: number;
}

export default function KPICard({
  label,
  value,
  delta,
  isPositive,
  sparklineData,
  accentColor = "#6366F1",
  icon: Icon,
  href,
  entranceDelayMs,
}: KPICardProps) {
  // Counts up from the previous value whenever it changes (and on first
  // mount, as a load-in reveal) — never replays on an unrelated rerender.
  const numericValue = typeof value === "number" ? value : null;
  const { display } = useCountUp(numericValue ?? 0, 400, 600, true);

  const cardClassName =
    "stat-card group relative block bg-surface-2 border border-border rounded-xl p-5 border-l-[3px] border-l-accent shadow-md hover:border-border-strong transition-colors duration-200" +
    (href ? " cursor-pointer cursor-target" : "") +
    (entranceDelayMs !== undefined ? " stagger-entrance" : "");
  const entranceStyle = entranceDelayMs !== undefined ? { animationDelay: `${entranceDelayMs}ms` } : undefined;

  const content = (
    <>
      <div className="flex justify-between items-start">
        {/* Metric values */}
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{label}</p>
          <p
            key={numericValue !== null ? numericValue : undefined}
            className="stat-card-value stat-card-value-flash inline-block text-2xl font-bold text-text-primary tracking-tight"
          >
            {numericValue !== null ? display : value}
          </p>
          <div className="flex items-center gap-1.5 mt-2">
            <span
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                isPositive
                  ? "bg-success/10 text-success border border-success/20"
                  : "bg-danger/10 text-danger border border-danger/20"
              }`}
            >
              {isPositive ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
              {delta}
            </span>
            <span className="text-[10px] text-text-muted">this week</span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          {Icon && (
            <div className="stat-card-icon p-1.5 rounded-lg bg-surface-3 border border-border text-accent-text">
              <Icon className="w-4 h-4" />
            </div>
          )}
          {/* Mini Sparkline Chart */}
          <div className="w-[80px] h-[45px] overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData}>
                <Line type="monotone" dataKey="value" stroke={accentColor} strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Accent underline — expands 0 -> 100% width on hover */}
      <div className="stat-card-underline absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-b-xl" />
    </>
  );

  if (href) {
    return (
      <Link href={href} className={cardClassName} style={entranceStyle}>
        {content}
      </Link>
    );
  }

  return (
    <div className={cardClassName} style={entranceStyle}>
      {content}
    </div>
  );
}
