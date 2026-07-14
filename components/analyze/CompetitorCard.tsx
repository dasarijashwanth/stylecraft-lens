"use client";

import { useEffect, useState } from "react";
import { useAmazonProduct } from "@/hooks/useAmazonProduct";
import { ChevronDown, ChevronUp, ExternalLink, Star, RefreshCw, Newspaper, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import type { ReviewAnalysis } from "@/lib/amazon-review-analysis";
import type { ProductNewsResult } from "@/lib/product-news";
import type { KeyFeaturesResult } from "@/lib/key-features-resolver";
import { CitationMarker, SourcesFootnoteList, useCitationNumbering } from "./CitationMarker";
import { enqueue } from "@/lib/fetch-queue";

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
  key_features:       { headline: string; source: string; attribution: string; detail: string }[];
  strengths:          string[];
  weaknesses:         string[];
  recent_news:        string[];
  top_feature_summary?: string;
  verified_by_rainforest?: boolean;
}

interface CompetitorCardProps {
  competitor: Competitor;
  tier?: "legacy" | "emerging";
  // Lets the comparison table (a sibling, not a parent, of this card) reuse
  // the same resolved Key Features instead of re-running the resolver —
  // fired once per successful/refreshed fetch.
  onFeaturesResolved?: (result: KeyFeaturesResult) => void;
}

type FeaturesState =
  | { status: "loading" }
  | { status: "loaded"; data: KeyFeaturesResult & { retrievedAt: string } }
  | { status: "error"; message: string };

type ReviewAnalysisState =
  | { status: "loading" }
  | { status: "loaded"; data: ReviewAnalysis & { retrievedAt: string } }
  | { status: "error"; message: string };

type NewsState =
  | { status: "loading" }
  | { status: "loaded"; data: ProductNewsResult & { retrievedAt: string } }
  | { status: "error"; message: string };

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

function RefreshButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      title="Refresh — re-pulls live data, bypassing cache"
      className="p-1 rounded hover:bg-surface-3 text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
    >
      <RefreshCw className={`w-3 h-3 ${disabled ? "animate-spin" : ""}`} />
    </button>
  );
}

function TimeoutChip({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-warning/10 border border-warning/25 text-warning hover:bg-warning/20 transition-colors"
    >
      <AlertTriangle className="w-2.5 h-2.5" /> Some sources timed out — Retry
    </button>
  );
}

// Must safely exceed every section route's own maxDuration (key-features:
// 55s, reviews-analysis/product-news: 45s — see those routes' exports) or
// this client-side abort fires before the server-side work even has a
// chance to finish. Confirmed live: with the old 20s value, real
// successful responses (verified real data, not errors) were arriving at
// 33-45s and getting thrown away as "timed out" by this timer alone.
const SECTION_TIMEOUT_MS = 58_000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SECTION_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function CompetitorCard({ competitor: c, onFeaturesResolved }: CompetitorCardProps) {
  // All 4 sections load automatically on mount — collapsing is purely a
  // visual/reading-convenience toggle, never a fetch trigger.
  const [featuresOpen, setFeaturesOpen] = useState(true);
  const [strengthsOpen, setStrengthsOpen] = useState(true);
  const [weaknessesOpen, setWeaknessesOpen] = useState(true);
  const [newsOpen, setNewsOpen] = useState(true);

  const [featuresState, setFeaturesState] = useState<FeaturesState>({ status: "loading" });
  const [reviewAnalysis, setReviewAnalysis] = useState<ReviewAnalysisState>({ status: "loading" });
  const [newsState, setNewsState] = useState<NewsState>({ status: "loading" });

  const { data: live, loading, error } = useAmazonProduct(c.verified_by_rainforest === undefined ? c.asin : null);

  const isValidAsin = /^[A-Z0-9]{10}$/i.test(c.asin ?? "");
  const asinPathSegment = isValidAsin ? c.asin.toUpperCase() : "NONE";
  const amazonUrl = isValidAsin ? `https://www.amazon.com/dp/${c.asin.toUpperCase()}` : null;

  async function loadFeatures(refresh = false) {
    setFeaturesState({ status: "loading" });
    try {
      const params = new URLSearchParams({ productName: c.name });
      if (refresh) params.set("refresh", "true");
      const res = await enqueue(() => fetchWithTimeout(`/api/product-data/key-features/${asinPathSegment}?${params.toString()}`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Live feature data unavailable — retry");
      setFeaturesState({ status: "loaded", data });
      onFeaturesResolved?.(data);
    } catch (err: any) {
      setFeaturesState({ status: "error", message: err.name === "AbortError" ? "Timed out fetching feature data." : (err.message || "Live feature data unavailable — retry") });
    }
  }

  async function loadReviewAnalysis(refresh = false) {
    setReviewAnalysis({ status: "loading" });
    try {
      const params = new URLSearchParams({ productName: c.name });
      if (refresh) params.set("refresh", "true");
      const res = await enqueue(() => fetchWithTimeout(`/api/amazon/reviews-analysis/${asinPathSegment}?${params.toString()}`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Live Amazon data unavailable — retry");
      setReviewAnalysis({ status: "loaded", data });
    } catch (err: any) {
      setReviewAnalysis({ status: "error", message: err.name === "AbortError" ? "Timed out fetching review data." : (err.message || "Live Amazon data unavailable — retry") });
    }
  }

  async function loadNews(refresh = false) {
    setNewsState({ status: "loading" });
    try {
      const params = new URLSearchParams({ productName: c.name, brand: c.brand || "" });
      if (refresh) params.set("refresh", "true");
      const res = await enqueue(() => fetchWithTimeout(`/api/amazon/product-news/${asinPathSegment}?${params.toString()}`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Live news search unavailable — retry");
      setNewsState({ status: "loaded", data });
    } catch (err: any) {
      setNewsState({ status: "error", message: err.name === "AbortError" ? "Timed out searching for news." : (err.message || "Live news search unavailable — retry") });
    }
  }

  // Fire all three the moment this card mounts — no click required.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadFeatures(); loadReviewAnalysis(); loadNews(); }, [c.asin, c.name]);

  const displayPrice   = live?.price        ?? c.price        ?? "—";
  const displayRating  = live?.rating_str   ?? c.rating       ?? "—";
  const displayReviews = live?.reviews_str  ?? c.review_count ?? "—";
  const displayBSR     = live?.bsr          ?? c.bsr_rank     ?? null;
  const displaySales   = live?.monthly_str  ?? c.monthly_sales ?? null;

  // Per-section citation numbering — same URL cited twice in one section
  // keeps one number (components/analyze/CitationMarker.tsx).
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
          <p className={`font-bold text-text-primary text-xs mt-0.5 ${loading ? "animate-pulse" : ""}`}>{loading ? "$—.——" : displayPrice}</p>
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
          <p className={`font-bold text-text-primary text-xs mt-0.5 ${loading ? "animate-pulse" : ""}`}>{loading ? "—,———" : displayReviews}</p>
        </div>
      </div>

      {!loading && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {displaySales && <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-emerald-950/40 border border-emerald-900/40 text-emerald-400">{displaySales}</span>}
          {displayBSR && <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-blue-950/40 border border-blue-900/40 text-blue-400">{displayBSR}</span>}
          {live && (
            <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-indigo-950/40 border border-indigo-900/40 text-indigo-400 flex items-center gap-1" title={`Last updated: ${new Date(live.last_updated).toLocaleTimeString()}`}>
              <span className="w-1 h-1 rounded-full bg-indigo-400 animate-ping" /> Live
            </span>
          )}
          {error && <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-danger-bg border border-danger/20 text-danger" title={error}>Stale Data</span>}
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
            <span>Key Features {featuresState.status === "loaded" ? `(${featuresState.data.features.length})` : ""}</span>
            {featuresOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {featuresState.status === "loaded" && <RefreshButton onClick={() => loadFeatures(true)} />}
        </div>

        {featuresOpen && (
          <div className="mt-3 space-y-3 animate-slide-down">
            {featuresState.status === "loading" && <SkeletonRows count={4} />}
            {featuresState.status === "error" && (
              <div className="flex items-center justify-between gap-2 py-2">
                <span className="text-danger">{featuresState.message}</span>
                <TimeoutChip onRetry={() => loadFeatures()} />
              </div>
            )}
            {featuresState.status === "loaded" && featuresState.data.features.length === 0 && (
              <p className="italic text-text-muted">
                No feature data found across {featuresState.data.tiersTried.join(", ") || "any source"} (searched {new Date(featuresState.data.searchedAt).toLocaleDateString()}).
              </p>
            )}
            {featuresState.status === "loaded" && (
              <div className="grid grid-cols-1 gap-2.5">
                {featuresState.data.features.slice(0, 6).map((f, idx) => (
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
            {featuresState.status === "loaded" && featuresState.data.features.length > 0 && (
              <SourcesFootnoteList sources={featuresState.data.features.map(f => sourceFor(featuresCitations, f.sourceUrl, f.sourceTitle, f.quote, f.retrievedAt))} />
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
          {reviewAnalysis.status === "loaded" && <RefreshButton onClick={() => loadReviewAnalysis(true)} />}
        </div>

        {strengthsOpen && (
          <div className="mt-3 space-y-2 animate-slide-down">
            {reviewAnalysis.status === "loading" && <SkeletonRows count={2} />}
            {reviewAnalysis.status === "error" && (
              <div className="flex items-center justify-between gap-2 py-2">
                <span className="text-danger">{reviewAnalysis.message}</span>
                <TimeoutChip onRetry={() => loadReviewAnalysis()} />
              </div>
            )}
            {reviewAnalysis.status === "loaded" && reviewAnalysis.data.insufficientData && (
              <p className="italic text-text-muted">
                No review data found on Amazon, retailers, or the web (searched {reviewAnalysis.data.sourcesSummary.tiersTried.join(", ")}).
              </p>
            )}
            {reviewAnalysis.status === "loaded" && reviewAnalysis.data.aiUnavailable && (
              <div className="flex items-center justify-between gap-2 py-2">
                <span className="text-warning">Fetched real reviews, but no AI provider is available right now to analyze them.</span>
                <TimeoutChip onRetry={() => loadReviewAnalysis()} />
              </div>
            )}
            {reviewAnalysis.status === "loaded" && !reviewAnalysis.data.insufficientData && !reviewAnalysis.data.aiUnavailable && (
              <>
                {reviewAnalysis.data.strengths.length === 0 && <p className="italic text-text-muted">None with verified support.</p>}
                {reviewAnalysis.data.strengths.map((s, idx) => (
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
                  Based on {reviewAnalysis.data.sourcesSummary.amazonReviews} Amazon reviews
                  {reviewAnalysis.data.sourcesSummary.expertReviews > 0 && ` + ${reviewAnalysis.data.sourcesSummary.expertReviews} expert reviews`}
                  {reviewAnalysis.data.sourcesSummary.forumDiscussions > 0 && ` + ${reviewAnalysis.data.sourcesSummary.forumDiscussions} forum discussions`}
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
          {reviewAnalysis.status === "loaded" && <RefreshButton onClick={() => loadReviewAnalysis(true)} />}
        </div>

        {weaknessesOpen && (
          <div className="mt-3 space-y-3 animate-slide-down">
            {reviewAnalysis.status === "loading" && <SkeletonRows count={2} />}
            {reviewAnalysis.status === "error" && (
              <div className="flex items-center justify-between gap-2 py-2">
                <span className="text-danger">{reviewAnalysis.message}</span>
                <TimeoutChip onRetry={() => loadReviewAnalysis()} />
              </div>
            )}
            {reviewAnalysis.status === "loaded" && reviewAnalysis.data.insufficientData && (
              <p className="italic text-text-muted">
                No review data found on Amazon, retailers, or the web (searched {reviewAnalysis.data.sourcesSummary.tiersTried.join(", ")}).
              </p>
            )}
            {reviewAnalysis.status === "loaded" && reviewAnalysis.data.aiUnavailable && (
              <div className="flex items-center justify-between gap-2 py-2">
                <span className="text-warning">Fetched real reviews, but no AI provider is available right now to analyze them.</span>
                <TimeoutChip onRetry={() => loadReviewAnalysis()} />
              </div>
            )}
            {reviewAnalysis.status === "loaded" && !reviewAnalysis.data.insufficientData && !reviewAnalysis.data.aiUnavailable && (
              <>
                <div className="space-y-1.5">
                  <p className="font-bold text-danger text-[10px] uppercase tracking-wider">Weaknesses</p>
                  {reviewAnalysis.data.weaknesses.length === 0 && <p className="italic text-text-muted">None with verified support.</p>}
                  {reviewAnalysis.data.weaknesses.map((w, idx) => (
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
                  {!reviewAnalysis.data.recentSentiment && <p className="italic text-text-muted">No reviews from the last 90 days.</p>}
                  {reviewAnalysis.data.recentSentiment && (
                    <>
                      <div className="flex items-center gap-2 flex-wrap">
                        {reviewAnalysis.data.recentSentiment.trend === "improving" && <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-success/10 border border-success/25 text-success"><TrendingUp className="w-3 h-3" /> Improving</span>}
                        {reviewAnalysis.data.recentSentiment.trend === "declining" && <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-danger/10 border border-danger/25 text-danger"><TrendingDown className="w-3 h-3" /> Declining</span>}
                        {reviewAnalysis.data.recentSentiment.trend === "stable" && <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-surface-3 border border-border text-text-muted"><Minus className="w-3 h-3" /> Stable</span>}
                        {reviewAnalysis.data.recentSentiment.trend === "unknown" && <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-surface-3 border border-border text-text-muted"><Minus className="w-3 h-3" /> Trend unclear</span>}
                        <span className="text-[10px] text-text-muted">
                          {reviewAnalysis.data.recentSentiment.reviewCount} reviews
                          {reviewAnalysis.data.recentSentiment.avgRating != null && ` · avg ${reviewAnalysis.data.recentSentiment.avgRating.toFixed(1)}★`}
                          {reviewAnalysis.data.recentSentiment.priorAvgRating != null && ` (was ${reviewAnalysis.data.recentSentiment.priorAvgRating.toFixed(1)}★)`}
                        </span>
                      </div>
                      {reviewAnalysis.data.recentSentiment.dominantThemes.map((t, idx) => (
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
                <p className="text-[9px] text-text-muted pt-1 border-t border-border/30">
                  Data retrieved {new Date(reviewAnalysis.data.retrievedAt).toLocaleString()}
                </p>
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
          {newsState.status === "loaded" && <RefreshButton onClick={() => loadNews(true)} />}
        </div>

        {newsOpen && (
          <div className="mt-3 space-y-2.5 animate-slide-down">
            {newsState.status === "loading" && <SkeletonRows count={2} />}
            {newsState.status === "error" && (
              <div className="flex items-center justify-between gap-2 py-2">
                <span className="text-danger">{newsState.message}</span>
                <TimeoutChip onRetry={() => loadNews()} />
              </div>
            )}
            {newsState.status === "loaded" && newsState.data.aiUnavailable && (
              <div className="flex items-center justify-between gap-2 py-2">
                <span className="text-warning">No AI provider is available right now to search for news.</span>
                <TimeoutChip onRetry={() => loadNews()} />
              </div>
            )}
            {newsState.status === "loaded" && !newsState.data.aiUnavailable && (
              <>
                {newsState.data.items.length === 0 && (
                  <p className="italic text-text-muted">No product-specific news found (searched {new Date(newsState.data.searchedAt).toLocaleDateString()}).</p>
                )}
                {newsState.data.items.map((item, idx) => (
                  <div key={idx} className="p-2 rounded-lg border border-border/60 space-y-0.5">
                    <p className="font-semibold text-text-primary flex items-center flex-wrap">
                      {item.title}
                      <CitationMarker source={sourceFor(newsCitations, item.url, item.publisher || item.title, item.summary, new Date().toISOString())} />
                    </p>
                    <p className="text-[11px] text-text-secondary leading-normal">{item.summary}</p>
                    <p className="text-[9px] text-text-muted">{item.publisher}{item.date && ` · ${item.date}`}</p>
                  </div>
                ))}
                {newsState.data.items.length > 0 && (
                  <SourcesFootnoteList sources={newsState.data.items.map(item => sourceFor(newsCitations, item.url, item.publisher || item.title, item.summary, new Date().toISOString()))} />
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
