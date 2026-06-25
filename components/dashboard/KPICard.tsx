"use client";

import { ResponsiveContainer, LineChart, Line } from "recharts";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

interface KPICardProps {
  label: string;
  value: string | number;
  delta: string;
  isPositive: boolean;
  sparklineData: { value: number }[];
  accentColor?: string;
}

export default function KPICard({
  label,
  value,
  delta,
  isPositive,
  sparklineData,
  accentColor = "#6366F1"
}: KPICardProps) {
  return (
    <div className="relative overflow-hidden bg-surface-2 border border-border rounded-xl p-5 border-l-[3px] border-l-accent shadow-md hover:border-border-strong transition-all duration-200">
      <div className="flex justify-between items-start">
        {/* Metric values */}
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold text-text-primary tracking-tight">{value}</p>
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

        {/* Mini Sparkline Chart */}
        <div className="w-[80px] h-[45px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparklineData}>
              <Line
                type="monotone"
                dataKey="value"
                stroke={accentColor}
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
