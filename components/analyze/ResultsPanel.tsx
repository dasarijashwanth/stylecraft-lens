"use client";

import { useState } from "react";
import { CompetitorCard } from "./CompetitorCard";
import { Sparkles, FileText, CheckCircle2, TrendingUp, AlertTriangle, Lightbulb, UserCheck, Shield, Award, Download } from "lucide-react";
import { downloadReportPDF } from "@/lib/export-pdf";
import { CitationsSection, UnverifiedBadge, type Claim } from "./CitedClaim";
import type { KeyFeaturesResult } from "@/lib/key-features-resolver";
import { Spinner } from "@/components/ui/Spinner";

interface ResultsPanelProps {
  analysis: {
    productName: string;
    totalSearches: number;
    identity?: {
      category?: string;
      subcategory?: string;
      whatItIs?: string;
      confidence?: "high" | "medium" | "low";
      evidence?: { claim: string; url: string; quote: string }[];
    };
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
        data_source?: string;
        market_size_current?: string;
        market_size_year?: string;
        market_size_forecast?: string;
        forecast_year?: string;
        cagr_percent?: string;
        cagr_period?: string;
      };
      key_trends: Array<{
        trend_name: string;
        description: string;
        source?: string;
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
      // Server-verified claims (lib/citations.ts) — every factual claim
      // this analysis makes that isn't already directly backed by the
      // Phase 1/2 Amazon data above. Absent/empty when nothing was cited.
      citations?: Claim[];
    };
  };
  onSaveAsReport: () => void;
  savingReport: boolean;
  onNewAnalysis: () => void;
}

export function ResultsPanel({ analysis, onSaveAsReport, savingReport, onNewAnalysis }: ResultsPanelProps) {
  const { phase1, phase2, phase3, identity } = analysis;
  const [exporting, setExporting] = useState(false);
  // Populated as each CompetitorCard's own Key Features fetch resolves, so
  // the comparison table's Top Feature row can reuse real cited data
  // instead of re-running the resolver a second time.
  const [phase1Features, setPhase1Features] = useState<Record<number, KeyFeaturesResult>>({});
  const [phase2Features, setPhase2Features] = useState<Record<number, KeyFeaturesResult>>({});

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const reportData = {
        title: `Competitive Intelligence Report — ${analysis.productName}`,
        created_at: new Date().toISOString(),
        competitive_analysis: {
          product_name: analysis.productName,
          large_brand_competitors: phase1.competitors,
          indie_emerging_competitors: phase2.competitors,
          market_snapshot: phase3.market_snapshot,
          key_trends: phase3.key_trends,
          market_gaps: phase3.market_gaps,
          top_threats: phase3.top_threats,
          top_opportunities: phase3.top_opportunities,
          positioning_recommendation: phase3.positioning_recommendation,
          strategic_recommendations: phase3.strategic_recommendations,
          quick_wins: phase3.quick_wins,
          citations: phase3.citations || [],
        },
        pricing_analysis: {
          competitors_pricing: [
            ...phase1.competitors.map((c: any) => ({ name: c.name, price: c.price, tier: "large" })),
            ...phase2.competitors.map((c: any) => ({ name: c.name, price: c.price, tier: "emerging" })),
          ],
          price_positioning: phase3.market_snapshot.headline_stat_value || "",
          notes: "",
        },
        go_to_market: {
          recommendations: phase3.strategic_recommendations,
          quick_wins: phase3.quick_wins,
          positioning: phase3.positioning_recommendation,
          notes: "",
        },
        content_form: {
          product_name: analysis.productName,
          key_messages: phase3.top_opportunities.map((o: any) => o.action || o.detail || o.description || ""),
          target_audience: "",
          notes: "",
        }
      };
      await downloadReportPDF(reportData);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setExporting(false);
    }
  };

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
            <span>{(phase1.competitors?.length ?? 0) + (phase2.competitors?.length ?? 0)} products mapped</span>
            <span className="mx-2">·</span>
            <span>{analysis.totalSearches ?? 0} web searches performed</span>
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
            onClick={handleExportPDF}
            disabled={exporting}
            className="flex items-center gap-1.5 px-4 py-2 border border-border bg-surface-3/45 hover:bg-surface-3 text-text-primary text-xs font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export to PDF</span>
          </button>
          <button
            onClick={onSaveAsReport}
            disabled={savingReport}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow shadow-accent/20 disabled:opacity-50"
          >
            {savingReport ? (
              <Spinner size="sm" className="text-white" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
            <span>View saved report</span>
          </button>
        </div>
      </div>

      {/* IDENTIFIED PRODUCT — shown so a wrong identification is caught
          immediately, not buried inside the market analysis text. */}
      {identity && (identity.category || identity.whatItIs) && (
        <div className="p-4 bg-surface-2 border border-border rounded-xl space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Identified Product</span>
            {identity.confidence && (
              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                identity.confidence === "high" ? "bg-success/10 border-success/30 text-success" :
                identity.confidence === "medium" ? "bg-warning/10 border-warning/25 text-warning" :
                "bg-danger/10 border-danger/30 text-danger"
              }`}>{identity.confidence} confidence</span>
            )}
          </div>
          <div className="text-xs text-text-primary font-semibold">
            {identity.category}{identity.subcategory && identity.subcategory !== identity.category ? ` / ${identity.subcategory}` : ""}
          </div>
          {identity.whatItIs && <p className="text-[11px] text-text-secondary leading-relaxed">{identity.whatItIs}</p>}
          {Array.isArray(identity.evidence) && identity.evidence.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-0.5">
              {identity.evidence.slice(0, 4).map((e, i) => (
                e.url ? (
                  <a key={i} href={e.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-accent hover:underline" title={e.claim}>
                    evidence {i + 1}
                  </a>
                ) : null
              ))}
            </div>
          )}
        </div>
      )}

      {/* 1. MARKET ANALYSIS SECTION */}
      <section className="results-section bg-surface-2 border border-border rounded-xl p-6 md:p-8 space-y-6">
        <div className="flex items-center gap-2 pb-3 border-b border-border/60">
          <TrendingUp className="w-5 h-5 text-accent" />
          <h2 className="text-base font-bold text-text-primary tracking-tight">Market Analysis</h2>
        </div>

        {/* Market Snapshot */}
        <div className="subsection space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="subsection-heading text-xs font-bold text-text-muted uppercase tracking-wider">Market Snapshot</h3>
            
            {/* Verified Data Badges */}
            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="px-2 py-0.5 rounded-full bg-surface-1 border border-border text-text-primary font-medium">
                ✓ {phase3.market_snapshot?.data_source || "Verified Industry Analytics"}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 font-medium">
                🔍 Google Custom Search
              </span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-medium">
                ● Live Amazon (Rainforest API)
              </span>
            </div>
          </div>

          {/* Market Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 bg-surface-1 border border-border rounded-lg">
              <span className="text-[9px] uppercase tracking-wider font-mono text-text-muted block mb-1">Market Size ({phase3.market_snapshot?.market_size_year || "Current"})</span>
              <span className="text-lg font-black text-text-primary">{phase3.market_snapshot?.market_size_current || "N/A"}</span>
            </div>
            <div className="p-3 bg-surface-1 border border-border rounded-lg">
              <span className="text-[9px] uppercase tracking-wider font-mono text-text-muted block mb-1">Forecast ({phase3.market_snapshot?.forecast_year || "Forecast"})</span>
              <span className="text-lg font-black text-text-primary">{phase3.market_snapshot?.market_size_forecast || "N/A"}</span>
            </div>
            <div className="p-3 bg-surface-1 border border-border rounded-lg">
              <span className="text-[9px] uppercase tracking-wider font-mono text-text-muted block mb-1">CAGR ({phase3.market_snapshot?.cagr_period || "Growth Period"})</span>
              <span className="text-lg font-black text-accent">{phase3.market_snapshot?.cagr_percent || "N/A"}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-start pt-2">
            {/* Growth Stat Card */}
            <div className="growth-stat-card p-4 border border-border bg-surface-3/20 rounded-xl space-y-1.5 md:col-span-1">
              {(phase3.market_snapshot as any)?.headline_stat_label === "unavailable" ? (
                <UnverifiedBadge title="No verifiable public market-size figure was found for this category — showing this honestly instead of an invented number." />
              ) : (
                <span className="growth-label inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold bg-success-bg border border-success/20 text-success uppercase tracking-wider">
                  growth
                </span>
              )}
              <p className="growth-value text-sm font-black text-text-primary leading-tight">
                {phase3.market_snapshot?.headline_stat_value || "Market Growth Analysis"}
              </p>
              {phase3.market_snapshot?.data_source && (
                <p className="text-[9px] text-text-muted italic">Source: {phase3.market_snapshot.data_source}</p>
              )}
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
                  <div className="text-text-secondary space-y-0.5">
                    <p>
                      <strong className="text-text-primary font-semibold">{trend.trend_name}:</strong>{" "}
                      {trend.description}
                    </p>
                    {trend.source && (
                      <span className="text-[10px] text-text-muted font-mono inline-block">[Source: {trend.source}]</span>
                    )}
                  </div>
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

        <CitationsSection claims={phase3.citations || []} />
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
                      : "bg-surface-3 text-text-muted border border-border-strong"
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
            {phase1.competitors?.length ?? 0} Brands
          </span>
        </div>

        <div className="competitors-list grid grid-cols-1 md:grid-cols-2 gap-4">
          {phase1.competitors && phase1.competitors.length > 0 ? (
            phase1.competitors.map((comp, i) => (
              <CompetitorCard key={i} competitor={comp} tier="legacy" onFeaturesResolved={(r) => setPhase1Features(prev => ({ ...prev, [i]: r }))} />
            ))
          ) : (
            <p className="col-span-full italic text-text-muted text-xs py-4 text-center">No large-brand competitors were identified for this product.</p>
          )}
        </div>

        <div className="pt-4 border-t border-border/40">
          <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">Legacy Brand Specification Comparison</h3>
          <CompetitorTable competitors={phase1.competitors} tier="legacy" resolvedFeatures={phase1Features} />
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
            {phase2.competitors?.length ?? 0} Brands
          </span>
        </div>

        <div className="competitors-list grid grid-cols-1 md:grid-cols-2 gap-4">
          {phase2.competitors && phase2.competitors.length > 0 ? (
            phase2.competitors.map((comp, i) => (
              <CompetitorCard key={i} competitor={comp} tier="emerging" onFeaturesResolved={(r) => setPhase2Features(prev => ({ ...prev, [i]: r }))} />
            ))
          ) : (
            <p className="col-span-full italic text-text-muted text-xs py-4 text-center">No indie & emerging competitors were identified for this product.</p>
          )}
        </div>

        <div className="pt-4 border-t border-border/40">
          <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">Emerging Brand Specification Comparison</h3>
          <CompetitorTable competitors={phase2.competitors} tier="emerging" resolvedFeatures={phase2Features} />
        </div>
      </section>
    </div>
  );
}

/* HELPER COMPARISON TABLE COMPONENT — data-driven rows: a row that no
   competitor has data for is skipped entirely; a row where only some
   competitors have data renders real values plus a muted "Not available
   for {name}" — never a bare dash/N/A (delivered documents must never
   show empty cells). */
interface CompetitorTableProps {
  competitors: any[];
  tier: "legacy" | "emerging";
  resolvedFeatures?: Record<number, KeyFeaturesResult>;
}

interface TableRowDef {
  label: string;
  getValue: (comp: any, idx: number) => string | null;
  getSourceUrl?: (comp: any, idx: number) => string | null;
}

function CompetitorTable({ competitors, tier, resolvedFeatures }: CompetitorTableProps) {
  if (!competitors || competitors.length === 0) return null;

  const rows: TableRowDef[] = [
    { label: "Amazon Price", getValue: (c) => c.price || null },
    { label: "Star Rating", getValue: (c) => (c.rating ? `${c.rating} ★` : null) },
    { label: "Review Count", getValue: (c) => c.review_count || null },
    { label: "Monthly Sales", getValue: (c) => c.monthly_sales || null },
    { label: "Best Seller Rank", getValue: (c) => c.bsr_rank || null },
    { label: "Brand", getValue: (c) => c.brand || null },
    { label: "ASIN", getValue: (c) => c.asin || null },
    {
      label: "Top Feature",
      getValue: (c, idx) => {
        const resolved = resolvedFeatures?.[idx]?.features?.[0];
        return c.top_feature_summary || c.key_features?.[0]?.headline || resolved?.headline || null;
      },
      getSourceUrl: (c, idx) => resolvedFeatures?.[idx]?.features?.[0]?.sourceUrl ?? null,
    },
  ];

  // Rows where every competitor is null get skipped entirely — a bare
  // header with only "Not available" cells is just as empty as a dash.
  const visibleRows = rows.filter(row => competitors.some((c, idx) => row.getValue(c, idx)));

  if (visibleRows.length === 0) return null;

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
          {visibleRows.map((row, rowIdx) => (
            <tr key={row.label} className={rowIdx % 2 === 1 ? "bg-surface-3/5" : undefined}>
              <td className="p-2 border-r border-border/40 bg-surface-3/10 font-bold text-text-muted">{row.label}</td>
              {competitors.map((comp, idx) => {
                const value = row.getValue(comp, idx);
                const sourceUrl = row.getSourceUrl?.(comp, idx);
                return (
                  <td key={idx} className="p-2 border-r border-border/40 max-w-[180px] truncate" title={value ?? `Not available for ${comp.brand || comp.name}`}>
                    {value ? (
                      <span className="inline-flex items-center gap-1">
                        {value}
                        {sourceUrl && (
                          <a href={sourceUrl} target="_blank" rel="noopener noreferrer" title="View source" className="text-accent hover:underline">
                            <ExternalLinkIcon />
                          </a>
                        )}
                      </span>
                    ) : (
                      <span className="italic text-text-muted normal-case font-sans">Not available for {comp.brand || comp.name}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
