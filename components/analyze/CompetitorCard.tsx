"use client";

import { useState } from "react";
import { useAmazonProduct } from "@/hooks/useAmazonProduct";
import { ChevronDown, ChevronUp, ExternalLink, Star, Loader2, Quote } from "lucide-react";
import type { ReviewAnalysis } from "@/lib/amazon-review-analysis";

interface Competitor {
  name:               string;
  brand:              string;
  tier:               "legacy" | "emerging";
  asin:               string;
  price:              string;       // Initial fallback value
  rating:             string;
  review_count:       string;
  monthly_sales?:     string;
  bsr_rank?:          string;
  initials:           string;
  key_features:       { headline: string; source: string; attribution: string; detail: string }[];
  strengths:          string[];
  weaknesses:         string[];
  recent_news:        string[];
  top_feature_summary?: string;
  // Set server-side by enrichCompetitorsWithRainforest (lib/analysisEngine.ts)
  // — when true, price/rating/asin above are ALREADY live/fresh data, so
  // this card should trust them as-is rather than re-fetching.
  verified_by_rainforest?: boolean;
}

interface CompetitorCardProps {
  competitor: Competitor;
  tier?: "legacy" | "emerging";
}

type ReviewAnalysisState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; data: ReviewAnalysis & { retrievedAt: string } }
  | { status: "error"; message: string };

export function CompetitorCard({ competitor: c }: CompetitorCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [reviewAnalysis, setReviewAnalysis] = useState<ReviewAnalysisState>({ status: "idle" });

  // Fetch real-time data from Rainforest API using hook — skipped when the
  // server already ran this exact verification (enrichCompetitorsWithRainforest):
  // re-fetching all 10 cards' ASINs again client-side, all at once on page
  // render, is redundant load that risks a transient rate-limit/network
  // failure making already-fresh, already-verified data look "stale" for
  // no reason. Only competitors the server never got to verify (Rainforest
  // unconfigured) fall back to this client-side attempt.
  const { data: live, loading, error } = useAmazonProduct(c.verified_by_rainforest === undefined ? c.asin : null);

  const isValidAsinForReviews = /^[A-Z0-9]{10}$/i.test(c.asin ?? "");

  async function loadReviewAnalysis() {
    if (!isValidAsinForReviews || reviewAnalysis.status === "loading") return;
    setReviewAnalysis({ status: "loading" });
    try {
      const res = await fetch(`/api/amazon/reviews-analysis/${c.asin.toUpperCase()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Live Amazon data unavailable — retry");
      setReviewAnalysis({ status: "loaded", data });
    } catch (err: any) {
      setReviewAnalysis({ status: "error", message: err.message || "Live Amazon data unavailable — retry" });
    }
  }

  function handleToggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && reviewAnalysis.status === "idle") {
      loadReviewAnalysis();
    }
  }

  const isValidAsin = /^[A-Z0-9]{10}$/i.test(c.asin ?? "");
  const amazonUrl   = isValidAsin
    ? `https://www.amazon.com/dp/${c.asin.toUpperCase()}`
    : null;

  // Use live data if available, fall back to Gemini's values
  const displayPrice   = live?.price        ?? c.price        ?? "—";
  const displayRating  = live?.rating_str   ?? c.rating       ?? "—";
  const displayReviews = live?.reviews_str  ?? c.review_count ?? "—";
  const displayBSR     = live?.bsr          ?? c.bsr_rank     ?? null;
  const displaySales   = live?.monthly_str  ?? c.monthly_sales ?? null;

  return (
    <div className="competitor-card bg-surface-2 border border-border rounded-xl p-5 space-y-4 shadow-sm hover:border-border-strong transition-all duration-200 text-xs">
      
      {/* Header */}
      <div className="comp-card-header flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="comp-avatar w-8 h-8 rounded-lg bg-surface-3 border border-border-strong flex items-center justify-center font-bold text-xs text-accent">
            {c.initials || c.name.substring(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="comp-name font-bold text-text-primary text-sm leading-tight">{c.name}</div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                c.tier === "legacy" 
                  ? "bg-indigo-950/60 border border-indigo-900/60 text-indigo-400" 
                  : "bg-amber-950/60 border border-amber-900/60 text-amber-400"
              }`}>
                {c.tier === "legacy" ? "Legacy" : "Emerging"}
              </span>
              <span className="text-[10px] text-text-muted">by {c.brand}</span>
            </div>
          </div>
        </div>

        {amazonUrl ? (
          <a
            href={amazonUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] font-semibold text-accent hover:underline shrink-0"
            title={`View ${c.name} on Amazon`}
          >
            <span>View on Amazon</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          <span className="text-[10px] text-text-muted italic shrink-0">ASIN unavailable</span>
        )}
      </div>

      {/* Live price / rating / reviews */}
      <div className="grid grid-cols-3 gap-2 py-2 border-y border-border/40 text-center font-mono">
        <div className="text-left font-sans">
          <p className="text-[9px] text-text-muted uppercase font-bold">Price</p>
          <p className={`font-bold text-text-primary text-xs mt-0.5 ${loading ? "animate-pulse" : ""}`}>
            {loading ? "$—.——" : displayPrice}
          </p>
        </div>
        <div className="font-sans">
          <p className="text-[9px] text-text-muted uppercase font-bold">Rating</p>
          {loading ? (
            <p className="font-bold text-text-muted text-xs mt-0.5 animate-pulse">—.—</p>
          ) : (
            <p className="font-bold text-text-primary text-xs mt-0.5 flex items-center justify-center gap-0.5">
              <Star className="w-3 h-3 text-warning fill-warning" />
              <span>{displayRating}</span>
            </p>
          )}
        </div>
        <div className="text-right font-sans">
          <p className="text-[9px] text-text-muted uppercase font-bold">Reviews</p>
          <p className={`font-bold text-text-primary text-xs mt-0.5 ${loading ? "animate-pulse" : ""}`}>
            {loading ? "—,———" : displayReviews}
          </p>
        </div>
      </div>

      {/* Live badge row */}
      {!loading && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {displaySales && (
            <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-emerald-950/40 border border-emerald-900/40 text-emerald-400">
              {displaySales}
            </span>
          )}
          {displayBSR && (
            <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-blue-950/40 border border-blue-900/40 text-blue-400">
              {displayBSR}
            </span>
          )}
          {live && (
            <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-indigo-950/40 border border-indigo-900/40 text-indigo-400 flex items-center gap-1" title={`Last updated: ${new Date(live.last_updated).toLocaleTimeString()}`}>
              <span className="w-1 h-1 rounded-full bg-indigo-400 animate-ping" />
              Live
            </span>
          )}
          {error && (
            <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-danger-bg border border-danger/20 text-danger" title={error}>
              Stale Data
            </span>
          )}
          {c.verified_by_rainforest === false && (
            <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-warning/10 border border-warning/25 text-warning" title="Could not confirm a live Amazon listing for this competitor — use the search link above to look it up directly.">
              Unverified — see search link
            </span>
          )}
        </div>
      )}

      {/* ASIN */}
      {c.asin && <div className="text-[10px] text-text-muted font-mono leading-none">ASIN: {c.asin}</div>}

      {/* Key features */}
      <div className="space-y-2">
        <span className="font-bold text-text-primary text-[10px] uppercase tracking-wider block">Key features</span>
        <div className="grid grid-cols-1 gap-2.5">
          {c.key_features?.slice(0, 4).map((f, idx) => (
            <div key={idx} className="pl-2.5 border-l border-accent/40 space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-bold text-text-primary">{f.headline}</span>
                <span className="px-1 py-0.2 rounded bg-surface-3 text-[8px] text-text-muted uppercase font-bold">
                  {f.source}
                </span>
              </div>
              <p className="text-[11px] text-text-secondary leading-normal">
                <span className="italic text-text-muted text-[10px] font-semibold block">{f.attribution}</span>
                {f.detail}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Expandable: Strengths / Weaknesses / recent themes — sourced live
          from this ASIN's actual Amazon reviews, fetched on first expand. */}
      <div className="border-t border-border/40 pt-3">
        <button
          type="button"
          onClick={handleToggleExpand}
          disabled={!isValidAsinForReviews}
          className="w-full flex items-center justify-between text-text-muted hover:text-text-primary transition-colors font-semibold disabled:opacity-50"
        >
          <span>Strengths, weaknesses & recent buyer sentiment</span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {expanded && (
          <div className="space-y-3.5 mt-3.5 animate-slide-down">
            {reviewAnalysis.status === "loading" && (
              <div className="flex items-center gap-2 text-text-muted py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Fetching and analyzing real Amazon reviews…</span>
              </div>
            )}

            {reviewAnalysis.status === "error" && (
              <div className="flex items-center justify-between gap-2 py-2">
                <span className="text-danger">{reviewAnalysis.message}</span>
                <button
                  type="button"
                  onClick={loadReviewAnalysis}
                  className="px-2 py-1 border border-border rounded text-[10px] font-bold text-text-secondary hover:border-border-strong transition-colors shrink-0"
                >
                  Retry
                </button>
              </div>
            )}

            {reviewAnalysis.status === "loaded" && reviewAnalysis.data.insufficientData && (
              <p className="italic text-text-muted">Insufficient review data for this product.</p>
            )}

            {reviewAnalysis.status === "loaded" && reviewAnalysis.data.aiUnavailable && (
              <div className="flex items-center justify-between gap-2 py-2">
                <span className="text-warning">
                  Fetched {reviewAnalysis.data.reviewCountAnalyzed} real reviews, but no AI provider is available right now to analyze them.
                </span>
                <button
                  type="button"
                  onClick={loadReviewAnalysis}
                  className="px-2 py-1 border border-border rounded text-[10px] font-bold text-text-secondary hover:border-border-strong transition-colors shrink-0"
                >
                  Retry
                </button>
              </div>
            )}

            {reviewAnalysis.status === "loaded" && !reviewAnalysis.data.insufficientData && !reviewAnalysis.data.aiUnavailable && (
              <>
                {/* Strengths */}
                <div className="space-y-1.5">
                  <p className="font-bold text-success text-[10px] uppercase tracking-wider">Strengths</p>
                  {reviewAnalysis.data.strengths.length === 0 && (
                    <p className="italic text-text-muted">None with verified review support</p>
                  )}
                  {reviewAnalysis.data.strengths.map((s, idx) => (
                    <div key={idx} className="space-y-1">
                      <p className="text-text-secondary font-semibold">{s.theme}</p>
                      {s.evidence.map((e, i) => (
                        <div key={i} className="flex gap-1.5 pl-2 text-[10px] text-text-muted italic">
                          <Quote className="w-3 h-3 shrink-0 mt-0.5" />
                          <span>&ldquo;{e.quote}&rdquo;{e.date && ` — ${e.date}`}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                {/* Weaknesses */}
                <div className="space-y-1.5">
                  <p className="font-bold text-danger text-[10px] uppercase tracking-wider">Weaknesses</p>
                  {reviewAnalysis.data.weaknesses.length === 0 && (
                    <p className="italic text-text-muted">None with verified review support</p>
                  )}
                  {reviewAnalysis.data.weaknesses.map((w, idx) => (
                    <div key={idx} className="space-y-1">
                      <p className="text-text-secondary font-semibold">{w.theme}</p>
                      {w.evidence.map((e, i) => (
                        <div key={i} className="flex gap-1.5 pl-2 text-[10px] text-text-muted italic">
                          <Quote className="w-3 h-3 shrink-0 mt-0.5" />
                          <span>&ldquo;{e.quote}&rdquo;{e.date && ` — ${e.date}`}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                {/* Recent themes */}
                {reviewAnalysis.data.recentThemes.length > 0 && (
                  <div className="space-y-1">
                    <p className="font-bold text-accent text-[10px] uppercase tracking-wider">Recent Buyer Themes</p>
                    <ul className="list-disc pl-4 space-y-1 text-text-secondary">
                      {reviewAnalysis.data.recentThemes.map((n, idx) => (
                        <li key={idx}>{n}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-[9px] text-text-muted pt-1 border-t border-border/30">
                  Based on {reviewAnalysis.data.reviewCountAnalyzed} Amazon reviews
                  {reviewAnalysis.data.dateRange?.earliest && ` from ${reviewAnalysis.data.dateRange.earliest} to ${reviewAnalysis.data.dateRange.latest}`}
                  , retrieved {new Date(reviewAnalysis.data.retrievedAt).toLocaleString()}
                  {(reviewAnalysis.data as any).cached === false ? "" : " (cached)"}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
