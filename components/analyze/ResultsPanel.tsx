"use client";

import { CompetitorCard } from "./CompetitorCard";
import { Sparkles, FileText, CheckCircle2, TrendingUp, AlertTriangle, Lightbulb, UserCheck, Shield, Award } from "lucide-react";

interface ResultsPanelProps {
  analysis: {
    productName: string;
    totalSearches: number;
    phase1: {
      competitors: any[];
    };
    phase2: {
      competitors: any[];
    };
    phase3: {
      amazon_category: string;
      market_snapshot: {
        headline_stat_value: string;
        overview_paragraph: string;
      };
      key_trends: Array<{
        trend_name: string;
        description: string;
      }>;
      market_gaps: string[];
      top_threats: Array<{
        competitor_name: string;
        threat_description: string;
      }>;
      top_opportunities: Array<{
        action: string;
        description: string;
      }>;
      positioning_recommendation: string;
      strategic_recommendations: Array<{
        priority: "high" | "medium" | "low";
        category: "product" | "marketing" | "positioning" | "pricing" | "partnerships";
        headline: string;
        explanation: string;
      }>;
      quick_wins: string[];
    };
  };
  onSaveAsReport: () => void;
  savingReport: boolean;
  onNewAnalysis: () => void;
}

export function ResultsPanel({ analysis, onSaveAsReport, savingReport, onNewAnalysis }: ResultsPanelProps) {
  const { phase1, phase2, phase3 } = analysis;

  // Sorting strategic recommendations: High -> Medium -> Low
  const sortedRecommendations = [...(phase3.strategic_recommendations || [])].sort((a, b) => {
    const priorities = { high: 1, medium: 2, low: 3 };
    return priorities[a.priority] - priorities[b.priority];
  });

  return (
    <div className="results-panel space-y-8">
      {/* SUCCESS BANNER & TOP BAR */}
      <div className="results-topbar flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 bg-surface-2 border border-border rounded-xl">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
            <h1 className="text-sm font-bold text-text-primary">Analysis — {analysis.productName}</h1>
          </div>
          <div className="results-meta text-[11px] text-text-muted font-mono leading-none">
            <span>{phase3.amazon_category || "Market Analysis"}</span>
            <span className="mx-2">·</span>
            <span>10 products mapped</span>
            <span className="mx-2">·</span>
            <span>{analysis.totalSearches || 26} web searches performed</span>
          </div>
        </div>

        <div className="results-actions flex items-center gap-2 self-end md:self-auto">
          <button
            onClick={onNewAnalysis}
            className="px-4 py-2 border border-border bg-surface-3/40 hover:bg-surface-3 text-text-primary text-xs font-bold rounded-lg transition-colors"
          >
            New analysis
          </button>
          <button
            onClick={onSaveAsReport}
            disabled={savingReport}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow shadow-accent/20 disabled:opacity-50"
          >
            {savingReport ? (
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
            <span>View saved report</span>
          </button>
        </div>
      </div>

      {/* 1. MARKET ANALYSIS SECTION */}
      <section className="results-section bg-surface-2 border border-border rounded-xl p-6 md:p-8 space-y-6">
        <div className="flex items-center gap-2 pb-3 border-b border-border/60">
          <TrendingUp className="w-5 h-5 text-accent" />
          <h2 className="text-base font-bold text-text-primary tracking-tight">Market Analysis</h2>
        </div>

        {/* Market Snapshot */}
        <div className="subsection space-y-4">
          <h3 className="subsection-heading text-xs font-bold text-text-muted uppercase tracking-wider">Market Snapshot</h3>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-start">
            {/* Growth Stat Card */}
            <div className="growth-stat-card p-4 border border-border bg-surface-3/20 rounded-xl space-y-1.5 md:col-span-1">
              <span className="growth-label inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold bg-success-bg border border-success/20 text-success uppercase tracking-wider">
                growth
              </span>
              <p className="growth-value text-lg font-black text-text-primary leading-tight">
                {phase3.market_snapshot?.headline_stat_value || "$6.2B* global market (2026)"}
              </p>
            </div>

            {/* Overview Paragraph */}
            <p className="market-overview text-xs text-text-secondary leading-relaxed md:col-span-3">
              {phase3.market_snapshot?.overview_paragraph}
            </p>
          </div>

          {/* Key Trends */}
          <div className="trends-block space-y-3 pt-3 border-t border-border/40">
            <h4 className="block-label text-[10px] font-bold text-text-muted uppercase tracking-wider">Key Trends</h4>
            <ul className="trends-list grid grid-cols-1 gap-2.5 text-xs">
              {phase3.key_trends?.map((trend, i) => (
                <li key={i} className="trend-item flex items-start gap-2.5 leading-normal">
                  <span className="trend-bullet text-accent font-bold mt-0.5">•</span>
                  <p className="text-text-secondary">
                    <strong className="text-text-primary font-semibold">{trend.trend_name}:</strong>{" "}
                    {trend.description}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Market Gaps */}
        <div className="subsection space-y-3 pt-4 border-t border-border/40">
          <h3 className="subsection-heading text-xs font-bold text-text-muted uppercase tracking-wider">Market Gaps</h3>
          <ul className="gaps-list grid grid-cols-1 gap-2 text-xs">
            {phase3.market_gaps?.map((gap, i) => (
              <li key={i} className="gap-item flex items-start gap-2.5 leading-normal">
                <span className="gap-bullet text-text-muted font-bold mt-0.5">·</span>
                <span className="text-text-secondary">{gap}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Top Threats */}
        <div className="subsection space-y-3 pt-4 border-t border-border/40">
          <h3 className="subsection-heading text-xs font-bold text-text-muted uppercase tracking-wider flex items-center gap-1">
            <AlertTriangle className="w-4 h-4 text-danger" />
            <span>Top Threats</span>
          </h3>
          <ul className="threats-list grid grid-cols-1 gap-2 text-xs">
            {phase3.top_threats?.map((threat, i) => (
              <li key={i} className="threat-item flex items-start gap-2.5 leading-normal">
                <span className="threat-bullet text-danger font-bold mt-0.5">−</span>
                <p className="text-text-secondary">
                  <strong className="text-text-primary font-semibold">{threat.competitor_name}:</strong>{" "}
                  {threat.threat_description}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {/* Top Opportunities */}
        <div className="subsection space-y-3 pt-4 border-t border-border/40">
          <h3 className="subsection-heading text-xs font-bold text-text-muted uppercase tracking-wider flex items-center gap-1">
            <Lightbulb className="w-4 h-4 text-success" />
            <span>Top Opportunities</span>
          </h3>
          <ul className="opps-list grid grid-cols-1 gap-2 text-xs">
            {phase3.top_opportunities?.map((opp, i) => (
              <li key={i} className="opp-item flex items-start gap-2.5 leading-normal">
                <span className="opp-bullet text-success font-bold mt-0.5">+</span>
                <p className="text-text-secondary">
                  <strong className="text-text-primary font-semibold">{opp.action}:</strong>{" "}
                  {opp.description}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {/* Positioning Recommendation */}
        <div className="subsection positioning-card p-5 border border-accent/30 bg-accent-bg/5 rounded-xl space-y-2">
          <h3 className="subsection-heading text-xs font-bold text-accent-text uppercase tracking-wider flex items-center gap-1">
            <UserCheck className="w-4 h-4 text-accent" />
            <span>Positioning Recommendation</span>
          </h3>
          <p className="text-xs text-text-secondary leading-relaxed">{phase3.positioning_recommendation}</p>
        </div>
      </section>

      {/* 2. STRATEGIC RECOMMENDATIONS SECTION */}
      <section className="results-section bg-surface-2 border border-border rounded-xl p-6 md:p-8 space-y-6">
        <div className="flex items-center gap-2 pb-3 border-b border-border/60">
          <Shield className="w-5 h-5 text-accent" />
          <h2 className="text-base font-bold text-text-primary tracking-tight">Strategic Recommendations</h2>
        </div>

        {/* Priority Sorted Cards */}
        <div className="recommendations-list grid grid-cols-1 md:grid-cols-2 gap-4">
          {sortedRecommendations.map((rec, i) => (
            <div
              key={i}
              className={`rec-card p-4 border rounded-xl space-y-2.5 text-xs relative overflow-hidden transition-all hover:translate-y-[-2px] ${
                rec.priority === "high"
                  ? "border-danger/35 bg-danger-bg/5"
                  : rec.priority === "medium"
                  ? "border-warning/35 bg-warning-bg/5"
                  : "border-border bg-surface-3/20"
              }`}
            >
              <div className="rec-badges flex items-center gap-1.5">
                <span
                  className={`priority-badge px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                    rec.priority === "high"
                      ? "bg-danger/10 text-danger border border-danger/30"
                      : rec.priority === "medium"
                      ? "bg-warning/10 text-warning border border-warning/30"
                      : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                  }`}
                >
                  {rec.priority}
                </span>
                <span className="category-badge px-1.5 py-0.5 rounded bg-surface-3 text-[8px] text-text-muted font-bold uppercase border border-border-strong">
                  {rec.category}
                </span>
              </div>
              <p className="rec-headline font-bold text-text-primary text-xs leading-normal">{rec.headline}</p>
              <p className="rec-explanation text-[11px] text-text-secondary leading-relaxed">{rec.explanation}</p>
            </div>
          ))}
        </div>

        {/* Quick Wins */}
        <div className="quick-wins-block p-5 border border-border bg-surface-3/10 rounded-xl space-y-3">
          <h3 className="subsection-heading text-xs font-bold text-text-muted uppercase tracking-wider">Quick Wins</h3>
          <ul className="quick-wins-list grid grid-cols-1 gap-2.5 text-xs text-text-secondary leading-normal">
            {phase3.quick_wins?.map((win, i) => (
              <li key={i} className="quick-win-item flex items-start gap-2.5">
                <span className="bullet text-accent font-bold mt-0.5">⚡</span>
                <p>{win}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 3. LARGE BRAND COMPETITORS SECTION */}
      <section className="results-section bg-surface-2 border border-border rounded-xl p-6 md:p-8 space-y-6">
        <div className="flex items-center justify-between pb-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold text-text-primary tracking-tight">Large Brand Competitors</h2>
          </div>
          <span className="count-badge bg-indigo-950/60 border border-indigo-900/60 text-indigo-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
            5 Brands
          </span>
        </div>

        <div className="competitors-list grid grid-cols-1 md:grid-cols-2 gap-4">
          {phase1.competitors?.map((comp, i) => (
            <CompetitorCard key={i} competitor={comp} tier="legacy" />
          ))}
        </div>

        <div className="pt-4 border-t border-border/40">
          <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">Legacy Brand Specification Comparison</h3>
          <CompetitorTable competitors={phase1.competitors} tier="legacy" />
        </div>
      </section>

      {/* 4. INDIE & EMERGING COMPETITORS SECTION */}
      <section className="results-section bg-surface-2 border border-border rounded-xl p-6 md:p-8 space-y-6">
        <div className="flex items-center justify-between pb-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-bold text-text-primary tracking-tight">Indie & Emerging Competitors</h2>
          </div>
          <span className="count-badge bg-amber-950/60 border border-amber-900/60 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
            5 Brands
          </span>
        </div>

        <div className="competitors-list grid grid-cols-1 md:grid-cols-2 gap-4">
          {phase2.competitors?.map((comp, i) => (
            <CompetitorCard key={i} competitor={comp} tier="emerging" />
          ))}
        </div>

        <div className="pt-4 border-t border-border/40">
          <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">Emerging Brand Specification Comparison</h3>
          <CompetitorTable competitors={phase2.competitors} tier="emerging" />
        </div>
      </section>
    </div>
  );
}

/* HELPER COMPARISON TABLE COMPONENT */
interface CompetitorTableProps {
  competitors: any[];
  tier: "legacy" | "emerging";
}

function CompetitorTable({ competitors, tier }: CompetitorTableProps) {
  if (!competitors || competitors.length === 0) return null;

  return (
    <div className="overflow-x-auto border border-border rounded-lg bg-surface-1">
      <table className="w-full text-left border-collapse text-[10px] font-mono whitespace-nowrap">
        <thead>
          <tr className="border-b border-border/60 bg-surface-3/30 text-text-muted uppercase font-bold text-[9px]">
            <th className="p-2 border-r border-border/40">Spec</th>
            {competitors.map((comp, idx) => (
              <th key={idx} className="p-2 border-r border-border/40 min-w-[120px]">
                <div className="text-text-primary font-bold text-xs truncate max-w-[150px]">{comp.brand || comp.name}</div>
                <div className="text-[8px] text-text-muted mt-0.5">{tier === "legacy" ? "Legacy" : "Emerging"}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40 text-text-secondary">
          <tr>
            <td className="p-2 border-r border-border/40 bg-surface-3/10 font-bold text-text-muted">Amazon Price</td>
            {competitors.map((comp, idx) => (
              <td key={idx} className="p-2 border-r border-border/40">{comp.price || "—"}</td>
            ))}
          </tr>
          <tr>
            <td className="p-2 border-r border-border/40 bg-surface-3/10 font-bold text-text-muted">Star Rating</td>
            {competitors.map((comp, idx) => (
              <td key={idx} className="p-2 border-r border-border/40">{comp.rating ? `${comp.rating} ★` : "—"}</td>
            ))}
          </tr>
          <tr>
            <td className="p-2 border-r border-border/40 bg-surface-3/10 font-bold text-text-muted">Review Count</td>
            {competitors.map((comp, idx) => (
              <td key={idx} className="p-2 border-r border-border/40">{comp.review_count || "—"}</td>
            ))}
          </tr>
          <tr>
            <td className="p-2 border-r border-border/40 bg-surface-3/10 font-bold text-text-muted">Monthly Sales</td>
            {competitors.map((comp, idx) => (
              <td key={idx} className="p-2 border-r border-border/40">{comp.monthly_sales || "—"}</td>
            ))}
          </tr>
          <tr>
            <td className="p-2 border-r border-border/40 bg-surface-3/10 font-bold text-text-muted">Best Seller Rank</td>
            {competitors.map((comp, idx) => (
              <td key={idx} className="p-2 border-r border-border/40 max-w-[150px] truncate" title={comp.bsr_rank}>{comp.bsr_rank || "—"}</td>
            ))}
          </tr>
          <tr>
            <td className="p-2 border-r border-border/40 bg-surface-3/10 font-bold text-text-muted">Brand</td>
            {competitors.map((comp, idx) => (
              <td key={idx} className="p-2 border-r border-border/40">{comp.brand || "—"}</td>
            ))}
          </tr>
          <tr>
            <td className="p-2 border-r border-border/40 bg-surface-3/10 font-bold text-text-muted">ASIN</td>
            {competitors.map((comp, idx) => (
              <td key={idx} className="p-2 border-r border-border/40 select-all">{comp.asin || "—"}</td>
            ))}
          </tr>
          <tr className="bg-surface-3/5">
            <td className="p-2 border-r border-border/40 bg-surface-3/10 font-bold text-text-muted">Top Feature</td>
            {competitors.map((comp, idx) => (
              <td key={idx} className="p-2 border-r border-border/40 max-w-[180px] truncate" title={comp.top_feature_summary || comp.key_features?.[0]?.headline}>
                {comp.top_feature_summary || comp.key_features?.[0]?.headline || "—"}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
