"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Star, RefreshCw, Newspaper, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import type { ReviewAnalysis } from "@/lib/amazon-review-analysis";
import type { ProductNewsResult } from "@/lib/product-news";
import type { KeyFeaturesResult } from "@/lib/key-features-resolver";
import type { AmazonData } from "@/hooks/useAmazonProduct";
import { CitationMarker, SourcesFootnoteList, useCitationNumbering } from "./CitationMarker";

interface Competitor {
  name:               string;
  brand:              string;
  tier:               "legacy" | "emerging";
  asin:               string;
  price:              string;
  rating:             string;
  review_count:       string;
  monthly_sales?:     string;
  bsr_rank?:          string;
  initials:           string;
  verified_by_rainforest?: boolean;
}

export type SectionStatus = "pending" | "running" | "done" | "failed";

export interface SectionState<T> {
  status: SectionStatus;
  error?: string | null;
  data?: T | null;
}

const EMPTY_SECTION: SectionState<any> = { status: "done", data: null };

interface CompetitorCardProps {
  competitor: Competitor;
  tier?: "legacy" | "emerging";
  // Optional so the saved-report detail view (app/(app)/dashboard/reports/
  // [id]/page.tsx) — which has no live job to poll, just a historical
  // snapshot — can still render this component; sections default to an
  // empty "done" state (shows "no data" text) rather than an infinite
  // loading skeleton when omitted.
  live?: SectionState<AmazonData>;
  features?: SectionState<KeyFeaturesResult>;
  reviews?: SectionState<ReviewAnalysis>;
  news?: SectionState<ProductNewsResult>;
  onRetry?: (taskType: "fetch_product_data" | "fetch_reviews" | "fetch_news" | "fetch_key_features") => void;
}

function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-1">
          <div className="h-3 bg-surface-3 rounded w-1/3" />
          <div className="h-2.5 bg-surface-3/60 rounded w-full" />
        </div>
      ))}
    </div>
  );
}

function RefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title="Refresh — re-pulls live data, bypassing cache"
      className="p-1 rounded hover:bg-surface-3 text-text-muted hover:text-text-primary transition-colors"
    >
      <RefreshCw className="w-3 h-3" />
    </button>
  );
}

function TimeoutChip({ message, onRetry }: { message?: string | null; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <span className="text-danger">{message || "Unavailable — retry"}</span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-warning/10 border border-warning/25 text-warning hover:bg-warning/20 transition-colors shrink-0"
      >
        <AlertTriangle className="w-2.5 h-2.5" /> Retry
      </button>
    </div>
  );
}

// Every section renders purely from props now — CompetitorCard no longer
// fetches anything itself. ResultsPanel (the parent) drives a single
// GET /api/analysis/:jobId/status poll for the whole page and fetches each
// section's resolved content once it shows "done"; this component just
// reflects whatever state it's handed and bubbles retry clicks back up.
// Concurrency/timeouts/circuit-breaking all now live server-side in the
// Inngest phase4 task workers (lib/inngest/functions/phase4-workers.ts),
// not in a client-side fetch queue.
export function CompetitorCard({
  competitor: c,
  tier,
  live = EMPTY_SECTION,
  features = EMPTY_SECTION,
  reviews = EMPTY_SECTION,
  news = EMPTY_SECTION,
  onRetry = () => {},
}: CompetitorCardProps) {
  const [featuresOpen, setFeaturesOpen] = useState(true);
  const [strengthsOpen, setStrengthsOpen] = useState(true);
  const [weaknessesOpen, setWeaknessesOpen] = useState(true);
  const [newsOpen, setNewsOpen] = useState(true);

  const isValidAsin = /^[A-Z0-9]{10}$/i.test(c.asin ?? "");
  const amazonUrl = isValidAsin ? `https://www.amazon.com/dp/${c.asin.toUpperCase()}` : null;

  const liveData = live.data;
  const liveLoading = live.status === "running" || live.status === "pending";
  const displayPrice   = liveData?.price        ?? c.price        ?? "—";
  const displayRating  = liveData?.rating_str   ?? c.rating       ?? "—";
  const displayReviews = liveData?.reviews_str  ?? c.review_count ?? "—";
  const displayBSR     = liveData?.bsr          ?? c.bsr_rank     ?? null;
  const displaySales   = liveData?.monthly_str  ?? c.monthly_sales ?? null;

  const featuresCitations = useCitationNumbering();
  const strengthsCitations = useCitationNumbering();
  const weaknessesCitations = useCitationNumbering();
  const newsCitations = useCitationNumbering();

  function sourceFor(numbering: ReturnType<typeof useCitationNumbering>, url: string | null | undefined, title: string, quote: string, retrievedAt: string) {
    const safeUrl = url || (amazonUrl ?? "#");
    return { number: numbering.numberFor(safeUrl), url: safeUrl, title, publisher: title, quote, retrievedAt };
  }

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
                (tier ?? c.tier) === "legacy"
                  ? "bg-indigo-950/60 border border-indigo-900/60 text-indigo-400"
                  : "bg-amber-950/60 border border-amber-900/60 text-amber-400"
              }`}>
                {(tier ?? c.tier) === "legacy" ? "Legacy" : "Emerging"}
              </span>
              <span className="text-[10px] text-text-muted">by {c.brand}</span>
            </div>
          </div>
        </div>

        {amazonUrl ? (
          <a href={amazonUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] font-semibold text-accent hover:underline shrink-0" title={`View ${c.name} on Amazon`}>
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
          <p className={`font-bold text-text-primary text-xs mt-0.5 ${liveLoading ? "animate-pulse" : ""}`}>{liveLoading ? "$—.——" : displayPrice}</p>
        </div>
        <div className="font-sans">
          <p className="text-[9px] text-text-muted uppercase font-bold">Rating</p>
          {liveLoading ? (
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
          <p className={`font-bold text-text-primary text-xs mt-0.5 ${liveLoading ? "animate-pulse" : ""}`}>{liveLoading ? "—,———" : displayReviews}</p>
        </div>
      </div>

      {!liveLoading && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {displaySales && <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-emerald-950/40 border border-emerald-900/40 text-emerald-400">{displaySales}</span>}
          {displayBSR && <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-blue-950/40 border border-blue-900/40 text-blue-400">{displayBSR}</span>}
          {liveData && (
            <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-indigo-950/40 border border-indigo-900/40 text-indigo-400 flex items-center gap-1" title={`Last updated: ${new Date(liveData.last_updated).toLocaleTimeString()}`}>
              <span className="w-1 h-1 rounded-full bg-indigo-400 animate-ping" /> Live
            </span>
          )}
          {live.status === "failed" && <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-danger-bg border border-danger/20 text-danger" title={live.error || undefined}>Stale Data</span>}
          {c.verified_by_rainforest === false && (
            <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-warning/10 border border-warning/25 text-warning" title="Could not confirm a live Amazon listing for this competitor — use the search link above to look it up directly.">
              Unverified — see search link
            </span>
          )}
        </div>
      )}

      {c.asin && <div className="text-[10px] text-text-muted font-mono leading-none">ASIN: {c.asin}</div>}

      {/* ==================== SECTION 1: KEY FEATURES ==================== */}
      <div className="border-t border-border/40 pt-3">
        <div className="w-full flex items-center justify-between text-text-muted">
          <button type="button" onClick={() => setFeaturesOpen(!featuresOpen)} className="flex-1 flex items-center justify-between hover:text-text-primary transition-colors font-semibold text-left">
            <span>Key Features {features.data ? `(${features.data.features.length})` : ""}</span>
            {featuresOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {features.status === "done" && <RefreshButton onClick={() => onRetry("fetch_key_features")} />}
        </div>

        {featuresOpen && (
          <div className="mt-3 space-y-3 animate-slide-down">
            {(features.status === "pending" || features.status === "running") && <SkeletonRows count={4} />}
            {features.status === "failed" && <TimeoutChip message={features.error} onRetry={() => onRetry("fetch_key_features")} />}
            {features.status === "done" && features.data && features.data.features.length === 0 && (
              <p className="italic text-text-muted">
                No feature data found across {features.data.tiersTried.join(", ") || "any source"} (searched {new Date(features.data.searchedAt).toLocaleDateString()}).
              </p>
            )}
            {features.status === "done" && features.data && (
              <div className="grid grid-cols-1 gap-2.5">
                {features.data.features.slice(0, 6).map((f, idx) => (
                  <div key={idx} className="pl-2.5 border-l border-accent/40 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-text-primary">{f.headline}</span>
                      <CitationMarker source={sourceFor(featuresCitations, f.sourceUrl, f.sourceTitle, f.quote, f.retrievedAt)} />
                      <span className="px-1 py-0.2 rounded bg-surface-3 text-[8px] text-text-muted uppercase font-bold">{f.source}</span>
                    </div>
                    <p className="text-[11px] text-text-secondary leading-normal">{f.detail}</p>
                  </div>
                ))}
              </div>
            )}
            {features.status === "done" && features.data && features.data.features.length > 0 && (
              <SourcesFootnoteList sources={features.data.features.map(f => sourceFor(featuresCitations, f.sourceUrl, f.sourceTitle, f.quote, f.retrievedAt))} />
            )}
          </div>
        )}
      </div>

      {/* ==================== SECTION 2: STRENGTHS ==================== */}
      <div className="border-t border-border/40 pt-3">
        <div className="w-full flex items-center justify-between text-text-muted">
          <button type="button" onClick={() => setStrengthsOpen(!strengthsOpen)} className="flex-1 flex items-center justify-between hover:text-text-primary transition-colors font-semibold text-left">
            <span>Strengths</span>
            {strengthsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {reviews.status === "done" && <RefreshButton onClick={() => onRetry("fetch_reviews")} />}
        </div>

        {strengthsOpen && (
          <div className="mt-3 space-y-2 animate-slide-down">
            {(reviews.status === "pending" || reviews.status === "running") && <SkeletonRows count={2} />}
            {reviews.status === "failed" && <TimeoutChip message={reviews.error} onRetry={() => onRetry("fetch_reviews")} />}
            {reviews.status === "done" && reviews.data?.insufficientData && (
              <p className="italic text-text-muted">
                No review data found on Amazon, retailers, or the web (searched {reviews.data.sourcesSummary.tiersTried.join(", ")}).
              </p>
            )}
            {reviews.status === "done" && reviews.data?.aiUnavailable && (
              <TimeoutChip message="Fetched real reviews, but no AI provider is available right now to analyze them." onRetry={() => onRetry("fetch_reviews")} />
            )}
            {reviews.status === "done" && reviews.data && !reviews.data.insufficientData && !reviews.data.aiUnavailable && (
              <>
                {reviews.data.strengths.length === 0 && <p className="italic text-text-muted">None with verified support.</p>}
                {reviews.data.strengths.map((s, idx) => (
                  <div key={idx} className="space-y-1">
                    <p className="text-success font-semibold flex items-center flex-wrap">
                      {s.theme}
                      <CitationMarker source={sourceFor(strengthsCitations, s.sourceUrl, s.sourceType === "customer_reviews" ? "Amazon customer reviews" : s.evidence[0]?.quote?.slice(0, 40) || "Source", s.evidence[0]?.quote || "", new Date().toISOString())} />
                    </p>
                    {s.evidence.slice(0, 2).map((e, i) => (
                      <p key={i} className="pl-2 text-[10px] text-text-muted italic">&ldquo;{e.quote}&rdquo;{e.date && ` — ${e.date}`}</p>
                    ))}
                  </div>
                ))}
                <p className="text-[9px] text-text-muted pt-1">
                  Based on {reviews.data.sourcesSummary.amazonReviews} Amazon reviews
                  {reviews.data.sourcesSummary.expertReviews > 0 && ` + ${reviews.data.sourcesSummary.expertReviews} expert reviews`}
                  {reviews.data.sourcesSummary.forumDiscussions > 0 && ` + ${reviews.data.sourcesSummary.forumDiscussions} forum discussions`}
                </p>
                <SourcesFootnoteList sources={strengthsCitations.allSources().map((url, i) => ({ number: i + 1, url, title: domainLabel(url), publisher: domainLabel(url), quote: "", retrievedAt: new Date().toISOString() }))} />
              </>
            )}
          </div>
        )}
      </div>

      {/* ==================== SECTION 3: WEAKNESSES & RECENT BUYER SENTIMENT ==================== */}
      <div className="border-t border-border/40 pt-3">
        <div className="w-full flex items-center justify-between text-text-muted">
          <button type="button" onClick={() => setWeaknessesOpen(!weaknessesOpen)} className="flex-1 flex items-center justify-between hover:text-text-primary transition-colors font-semibold text-left">
            <span>Weaknesses & Recent Buyer Sentiment</span>
            {weaknessesOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {reviews.status === "done" && <RefreshButton onClick={() => onRetry("fetch_reviews")} />}
        </div>

        {weaknessesOpen && (
          <div className="mt-3 space-y-3 animate-slide-down">
            {(reviews.status === "pending" || reviews.status === "running") && <SkeletonRows count={2} />}
            {reviews.status === "failed" && <TimeoutChip message={reviews.error} onRetry={() => onRetry("fetch_reviews")} />}
            {reviews.status === "done" && reviews.data?.insufficientData && (
              <p className="italic text-text-muted">
                No review data found on Amazon, retailers, or the web (searched {reviews.data.sourcesSummary.tiersTried.join(", ")}).
              </p>
            )}
            {reviews.status === "done" && reviews.data?.aiUnavailable && (
              <TimeoutChip message="Fetched real reviews, but no AI provider is available right now to analyze them." onRetry={() => onRetry("fetch_reviews")} />
            )}
            {reviews.status === "done" && reviews.data && !reviews.data.insufficientData && !reviews.data.aiUnavailable && (
              <>
                <div className="space-y-1.5">
                  <p className="font-bold text-danger text-[10px] uppercase tracking-wider">Weaknesses</p>
                  {reviews.data.weaknesses.length === 0 && <p className="italic text-text-muted">None with verified support.</p>}
                  {reviews.data.weaknesses.map((w, idx) => (
                    <div key={idx} className="space-y-1">
                      <p className="text-text-secondary font-semibold flex items-center flex-wrap">
                        {w.theme}
                        <CitationMarker source={sourceFor(weaknessesCitations, w.sourceUrl, w.sourceType === "customer_reviews" ? "Amazon customer reviews" : w.evidence[0]?.quote?.slice(0, 40) || "Source", w.evidence[0]?.quote || "", new Date().toISOString())} />
                      </p>
                      {w.evidence.slice(0, 2).map((e, i) => (
                        <p key={i} className="pl-2 text-[10px] text-text-muted italic">&ldquo;{e.quote}&rdquo;{e.date && ` — ${e.date}`}</p>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5 pt-2 border-t border-border/30">
                  <p className="font-bold text-accent text-[10px] uppercase tracking-wider">Recent Buyer Sentiment (last 90 days)</p>
                  {!reviews.data.recentSentiment && <p className="italic text-text-muted">No reviews from the last 90 days.</p>}
                  {reviews.data.recentSentiment && (
                    <>
                      <div className="flex items-center gap-2 flex-wrap">
                        {reviews.data.recentSentiment.trend === "improving" && <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-success/10 border border-success/25 text-success"><TrendingUp className="w-3 h-3" /> Improving</span>}
                        {reviews.data.recentSentiment.trend === "declining" && <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-danger/10 border border-danger/25 text-danger"><TrendingDown className="w-3 h-3" /> Declining</span>}
                        {reviews.data.recentSentiment.trend === "stable" && <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-surface-3 border border-border text-text-muted"><Minus className="w-3 h-3" /> Stable</span>}
                        {reviews.data.recentSentiment.trend === "unknown" && <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-surface-3 border border-border text-text-muted"><Minus className="w-3 h-3" /> Trend unclear</span>}
                        <span className="text-[10px] text-text-muted">
                          {reviews.data.recentSentiment.reviewCount} reviews
                          {reviews.data.recentSentiment.avgRating != null && ` · avg ${reviews.data.recentSentiment.avgRating.toFixed(1)}★`}
                          {reviews.data.recentSentiment.priorAvgRating != null && ` (was ${reviews.data.recentSentiment.priorAvgRating.toFixed(1)}★)`}
                        </span>
                      </div>
                      {reviews.data.recentSentiment.dominantThemes.map((t, idx) => (
                        <div key={idx} className="space-y-1">
                          <p className="text-text-secondary font-semibold">{t.theme}</p>
                          {t.evidence.slice(0, 2).map((e, i) => (
                            <p key={i} className="pl-2 text-[10px] text-text-muted italic">&ldquo;{e.quote}&rdquo;{e.date && ` — ${e.date}`}</p>
                          ))}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ==================== SECTION 4: NEWS UPDATES ==================== */}
      <div className="border-t border-border/40 pt-3">
        <div className="w-full flex items-center justify-between text-text-muted">
          <button type="button" onClick={() => setNewsOpen(!newsOpen)} className="flex-1 flex items-center justify-between hover:text-text-primary transition-colors font-semibold text-left">
            <span className="flex items-center gap-1.5"><Newspaper className="w-3.5 h-3.5" /> News Updates</span>
            {newsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {news.status === "done" && <RefreshButton onClick={() => onRetry("fetch_news")} />}
        </div>

        {newsOpen && (
          <div className="mt-3 space-y-2.5 animate-slide-down">
            {(news.status === "pending" || news.status === "running") && <SkeletonRows count={2} />}
            {news.status === "failed" && <TimeoutChip message={news.error} onRetry={() => onRetry("fetch_news")} />}
            {news.status === "done" && news.data?.aiUnavailable && (
              <TimeoutChip message="No AI provider is available right now to search for news." onRetry={() => onRetry("fetch_news")} />
            )}
            {news.status === "done" && news.data && !news.data.aiUnavailable && (
              <>
                {news.data.items.length === 0 && (
                  <p className="italic text-text-muted">No product-specific news found (searched {new Date(news.data.searchedAt).toLocaleDateString()}).</p>
                )}
                {news.data.items.map((item, idx) => (
                  <div key={idx} className="p-2 rounded-lg border border-border/60 space-y-0.5">
                    <p className="font-semibold text-text-primary flex items-center flex-wrap">
                      {item.title}
                      <CitationMarker source={sourceFor(newsCitations, item.url, item.publisher || item.title, item.summary, new Date().toISOString())} />
                    </p>
                    <p className="text-[11px] text-text-secondary leading-normal">{item.summary}</p>
                    <p className="text-[9px] text-text-muted">{item.publisher}{item.date && ` · ${item.date}`}</p>
                  </div>
                ))}
                {news.data.items.length > 0 && (
                  <SourcesFootnoteList sources={news.data.items.map(item => sourceFor(newsCitations, item.url, item.publisher || item.title, item.summary, new Date().toISOString()))} />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function domainLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
