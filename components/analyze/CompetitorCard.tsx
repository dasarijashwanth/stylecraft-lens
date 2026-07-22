"use client";

import { useEffect, useState } from "react";
import { useAmazonProduct } from "@/hooks/useAmazonProduct";
import { ChevronDown, ChevronUp, ExternalLink, Star, RefreshCw, Newspaper, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import type { ReviewAnalysis, TierResult, ListingStats } from "@/lib/amazon-review-analysis";
import type { ProductNewsResult } from "@/lib/product-news";
import type { KeyFeaturesResult } from "@/lib/key-features-resolver";
import { CitationMarker, SourcesFootnoteList, useCitationNumbering } from "./CitationMarker";
import { enqueue } from "@/lib/fetch-queue";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { SectionSourceLine, SourceUnavailableCaption } from "./SectionSourceLine";
import { assertProvenance, domainOf } from "@/lib/provenance-format";

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
  manufacturer?:      string | null;
  model_number?:      string | null;
  description?:       string | null;
  images?:            string[];
  // Set by lib/analysisEngine.ts's applyPriceBandGate when this competitor
  // only made it in after the price band was widened (fewer than 5 in-band
  // candidates were found) — never set for a normal in-band match.
  out_of_band?:        boolean;
  out_of_band_reason?: string | null;
  // One sentence justifying why this is a real legacy/emerging competitor
  // at this price tier, per lib/analysisEngine.ts's Phase 1/2 prompts.
  inclusion_rationale?: string;
}

interface CompetitorCardProps {
  competitor: Competitor;
  tier?: "legacy" | "emerging";
  // Lets the comparison table (a sibling, not a parent, of this card) reuse
  // the same resolved Key Features instead of re-running the resolver —
  // fired once per successful/refreshed fetch.
  onFeaturesResolved?: (result: KeyFeaturesResult) => void;
  // Best-effort — threaded into each section fetch so its persisted
  // provenance row (lib/db/section-provenance.ts) carries a real
  // analysis_id when one exists. Never required for a provenance write.
  analysisId?: string | null;
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

function TimeoutChip({ onRetry, label }: { onRetry: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-warning/10 border border-warning/25 text-warning hover:bg-warning/20 transition-colors"
    >
      <AlertTriangle className="w-2.5 h-2.5" /> {label || "Some sources timed out — Retry"}
    </button>
  );
}

// Turns one tier's outcome into a short, honest phrase — "returned 0" and
// "request failed" must read differently, since they mean very different
// things (the product genuinely has no reviews vs. the source was
// unreachable this time).
function describeTier(t: TierResult): string {
  if (!t.attempted) return "not attempted (no ASIN)";
  if (t.outcome === "success") return t.itemCount != null ? `found ${t.itemCount}` : "found supporting content";
  if (t.outcome === "empty") return "returned 0";
  return `request failed${t.errorMessage ? ` (${t.errorMessage})` : ""}`;
}

// Renders whichever notice applies for the Strengths/Weaknesses sections —
// shared so the two sections can't drift out of sync. Order matters: an AI
// outage is reported before a sources outage, which is reported before a
// genuine "nothing found anywhere" — these are three different situations
// and must never collapse into the same generic message.
function ReviewSourcesNotice({ data, onRetry }: { data: ReviewAnalysis; onRetry: () => void }) {
  if (data.aiUnavailable) {
    return (
      <div className="flex items-center justify-between gap-2 py-2">
        <span className="text-warning">Fetched real reviews, but no AI provider is available right now to analyze them.</span>
        <TimeoutChip onRetry={onRetry} />
      </div>
    );
  }
  if (data.sourcesUnavailable) {
    const errored = (data.sourcesSummary.tiers ?? []).filter(t => t.attempted && t.outcome === "error");
    return (
      <div className="flex items-center justify-between gap-2 py-2">
        <span className="text-warning">
          Live review sources unavailable right now{errored.length ? ` (${errored.map(t => t.tier).join(", ")})` : ""} — this is a temporary source outage, not a lack of reviews.
        </span>
        <TimeoutChip onRetry={onRetry} label="Retry" />
      </div>
    );
  }
  if (data.insufficientData) {
    const tiers = data.sourcesSummary.tiers;
    if (tiers && tiers.length) {
      return (
        <div className="italic text-text-muted space-y-0.5">
          <p>No review data found across any source:</p>
          <ul className="pl-3 list-disc space-y-0.5 not-italic">
            {tiers.map((t, i) => <li key={i}>{t.tier}: {describeTier(t)}</li>)}
          </ul>
        </div>
      );
    }
    // Backward-compat fallback for older cached payloads without `tiers`.
    return (
      <p className="italic text-text-muted">
        No review data found on Amazon, retailers, or the web (searched {data.sourcesSummary.tiersTried.join(", ")}).
      </p>
    );
  }
  return null;
}

function reviewSourceLabel(sourceType: string): string | null {
  if (sourceType === "customer_reviews") return "Amazon customer reviews";
  if (sourceType === "amazon_listing") return "Amazon product listing";
  return null;
}

// Visible, inline (not hover-only) label naming a review theme's source
// type — distinct from reviewSourceLabel above, which only feeds the
// citation marker's tooltip title.
function reviewThemeSourceLabel(theme: { sourceType: string; sourceUrl?: string | null }): string {
  if (theme.sourceType === "customer_reviews") return "customer reviews (Amazon)";
  if (theme.sourceType === "amazon_listing") return "Amazon listing";
  if (theme.sourceType === "expert_review") return `expert review${theme.sourceUrl ? ` (${domainOf(theme.sourceUrl)})` : ""}`;
  if (theme.sourceType === "forum") return `forum${theme.sourceUrl ? ` (${domainOf(theme.sourceUrl)})` : ""}`;
  return theme.sourceType;
}

function ListingStatsCaption({ stats }: { stats: ListingStats }) {
  if (stats.rating == null && stats.reviewsTotal == null) return null;
  return (
    <p className="text-[10px] text-text-muted">
      Based on the Amazon listing{stats.rating != null ? `: ${stats.rating.toFixed(1)}★` : ""}{stats.reviewsTotal != null ? ` across ${stats.reviewsTotal.toLocaleString()} ratings` : ""}.
    </p>
  );
}

// Must safely exceed every section route's own maxDuration (all three are
// 60s, Vercel Hobby's actual ceiling — see those routes' exports) or this
// client-side abort fires before the server-side work even has a chance
// to finish. Confirmed live: with the old 20s value, real successful
// responses (verified real data, not errors) were arriving at 33-45s and
// getting thrown away as "timed out" by this timer alone.
const SECTION_TIMEOUT_MS = 63_000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SECTION_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// A hard Vercel function kill (the route ran past its own maxDuration)
// returns a plain-text/HTML platform error page, not this route's own
// JSON — confirmed live: that crashed res.json() with a raw parse error
// ("Unexpected token 'A', "An error o"... is not valid JSON") shown
// directly to the user instead of a clean message. Read the body as text
// first and parse it ourselves so a non-JSON response degrades to a
// normal, honest "unavailable — retry" instead of a stack-trace-looking
// string.
async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: res.ok ? "Unexpected response — retry" : `Live data unavailable (server error) — retry` };
  }
}

export function CompetitorCard({ competitor: c, onFeaturesResolved, analysisId }: CompetitorCardProps) {
  // All 4 sections load automatically on mount — collapsing is purely a
  // visual/reading-convenience toggle, never a fetch trigger.
  const [featuresOpen, setFeaturesOpen] = useState(true);
  const [strengthsOpen, setStrengthsOpen] = useState(true);
  const [weaknessesOpen, setWeaknessesOpen] = useState(true);
  const [newsOpen, setNewsOpen] = useState(true);
  const [featuresSourceOpen, setFeaturesSourceOpen] = useState(false);
  const [strengthsSourceOpen, setStrengthsSourceOpen] = useState(false);
  const [weaknessesSourceOpen, setWeaknessesSourceOpen] = useState(false);
  const [newsSourceOpen, setNewsSourceOpen] = useState(false);

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
      if (analysisId) params.set("analysisId", analysisId);
      const res = await enqueue(() => fetchWithTimeout(`/api/product-data/key-features/${asinPathSegment}?${params.toString()}`));
      const data = await safeJson(res);
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
      if (analysisId) params.set("analysisId", analysisId);
      const res = await enqueue(() => fetchWithTimeout(`/api/amazon/reviews-analysis/${asinPathSegment}?${params.toString()}`));
      const data = await safeJson(res);
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
      if (analysisId) params.set("analysisId", analysisId);
      const res = await enqueue(() => fetchWithTimeout(`/api/amazon/product-news/${asinPathSegment}?${params.toString()}`));
      const data = await safeJson(res);
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
  const displayManufacturer = live?.manufacturer ?? c.manufacturer ?? null;
  const displayModelNumber  = live?.model_number ?? c.model_number ?? null;

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
            {c.inclusion_rationale && (
              <p className="text-[10px] text-text-muted italic mt-1 max-w-xs leading-snug">{c.inclusion_rationale}</p>
            )}
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
          {c.out_of_band && (
            <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-warning/10 border border-warning/25 text-warning" title={c.out_of_band_reason || undefined}>
              Outside Price Band
            </span>
          )}
        </div>
      )}

      {/* Widened-band disclosure — visible, not hover-only, since this is
          competitive-intel messaging the user should always see, not stumble
          into (see lib/analysisEngine.ts's applyPriceBandGate). */}
      {c.out_of_band && c.out_of_band_reason && (
        <p className="text-[10px] text-warning leading-snug">{c.out_of_band_reason}</p>
      )}

      {isValidAsin && <div className="text-[10px] text-text-muted font-mono leading-none">ASIN: {c.asin}</div>}

      {/* Manufacturer / Model — fill-or-hide, never a placeholder dash */}
      {(displayManufacturer || displayModelNumber) && (
        <div className="flex flex-wrap gap-x-3 text-[10px] text-text-muted">
          {displayManufacturer && <span>Manufacturer: <span className="text-text-secondary">{displayManufacturer}</span></span>}
          {displayModelNumber && <span>Model: <span className="text-text-secondary">{displayModelNumber}</span></span>}
        </div>
      )}

      {/* Rating distribution — from the listing, when present */}
      {live?.rating_breakdown && (
        <div className="space-y-0.5 pt-0.5">
          {([["five_star", 5], ["four_star", 4], ["three_star", 3], ["two_star", 2], ["one_star", 1]] as const).map(([key, stars]) => {
            const pct = live.rating_breakdown?.[key];
            if (pct == null) return null;
            return (
              <div key={key} className="flex items-center gap-1.5 text-[9px] text-text-muted">
                <span className="w-6 shrink-0">{stars}★</span>
                <div className="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                  <div className="h-full bg-warning" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-8 text-right">{pct}%</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ==================== SECTION 1: KEY FEATURES ==================== */}
      <div className="border-t border-border/40 pt-3">
        <div className="w-full flex items-center justify-between text-text-muted">
          <button type="button" onClick={() => setFeaturesOpen(!featuresOpen)} className="flex-1 flex items-center justify-between hover:text-text-primary transition-colors font-semibold text-left">
            <span>Key Features {featuresState.status === "loaded" ? `(${featuresState.data.features.length})` : ""}</span>
            {featuresOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {featuresState.status === "loaded" && <RefreshButton onClick={() => loadFeatures(true)} />}
        </div>

        {featuresState.status === "loaded" && (
          assertProvenance(featuresState.data.provenance, "key_features", c.name) ? (
            <SectionSourceLine
              flavor="key_features"
              provenance={featuresState.data.provenance!}
              resolvedAt={featuresState.data.retrievedAt}
              asin={isValidAsin ? c.asin : null}
              open={featuresSourceOpen}
              onToggle={() => setFeaturesSourceOpen(o => !o)}
            />
          ) : <SourceUnavailableCaption />
        )}

        {featuresOpen && (
          <div className="mt-3 space-y-2.5 animate-slide-down">
            {featuresState.status === "loading" && <SkeletonRows count={4} />}
            {featuresState.status === "error" && (
              <div className="flex items-center justify-between gap-2 p-2 bg-danger-bg border border-danger/20 rounded-lg">
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
                      <a
                        href={f.sourceUrl || amazonUrl || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-1 py-0.2 rounded bg-surface-3 text-[8px] text-text-muted uppercase font-bold hover:text-accent"
                      >
                        [{f.source === "Amazon" ? "Amazon" : f.source === "Brand site" ? "Brand site" : (domainOf(f.sourceUrl) || f.source)}]
                      </a>
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

        {reviewAnalysis.status === "loaded" && (
          assertProvenance(reviewAnalysis.data.provenance, "reviews", c.name) ? (
            <SectionSourceLine
              flavor="reviews"
              provenance={reviewAnalysis.data.provenance!}
              resolvedAt={reviewAnalysis.data.retrievedAt}
              asin={isValidAsin ? c.asin : null}
              open={strengthsSourceOpen}
              onToggle={() => setStrengthsSourceOpen(o => !o)}
            />
          ) : <SourceUnavailableCaption />
        )}

        {strengthsOpen && (
          <div className="mt-3 space-y-2.5 animate-slide-down">
            {reviewAnalysis.status === "loading" && <SkeletonRows count={2} />}
            {reviewAnalysis.status === "error" && (
              <div className="flex items-center justify-between gap-2 p-2 bg-danger-bg border border-danger/20 rounded-lg">
                <span className="text-danger">{reviewAnalysis.message}</span>
                <TimeoutChip onRetry={() => loadReviewAnalysis()} />
              </div>
            )}
            {reviewAnalysis.status === "loaded" && reviewAnalysis.data.listingStats && (
              <ListingStatsCaption stats={reviewAnalysis.data.listingStats} />
            )}
            {reviewAnalysis.status === "loaded" && (reviewAnalysis.data.aiUnavailable || reviewAnalysis.data.sourcesUnavailable || reviewAnalysis.data.insufficientData) && (
              <ReviewSourcesNotice data={reviewAnalysis.data} onRetry={() => loadReviewAnalysis()} />
            )}
            {reviewAnalysis.status === "loaded" && !reviewAnalysis.data.insufficientData && !reviewAnalysis.data.sourcesUnavailable && !reviewAnalysis.data.aiUnavailable && (
              <>
                {reviewAnalysis.data.strengths.length === 0 && <p className="italic text-text-muted">None with verified support.</p>}
                {reviewAnalysis.data.strengths.map((s, idx) => (
                  <div key={idx} className="space-y-1">
                    <p className="text-success font-semibold flex items-center flex-wrap gap-1">
                      {s.theme}
                      <CitationMarker source={sourceFor(strengthsCitations, s.sourceUrl, reviewSourceLabel(s.sourceType) || s.evidence[0]?.quote?.slice(0, 40) || "Source", s.evidence[0]?.quote || "", reviewAnalysis.data.retrievedAt)} />
                      <span className="text-[9px] font-normal text-text-muted">[{reviewThemeSourceLabel(s)}]</span>
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
                <SourcesFootnoteList sources={strengthsCitations.allSources().map((url, i) => ({ number: i + 1, url, title: domainLabel(url), publisher: domainLabel(url), quote: "", retrievedAt: reviewAnalysis.data.retrievedAt }))} />
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

        {reviewAnalysis.status === "loaded" && (
          assertProvenance(reviewAnalysis.data.provenance, "reviews", c.name) ? (
            <SectionSourceLine
              flavor="reviews"
              provenance={reviewAnalysis.data.provenance!}
              resolvedAt={reviewAnalysis.data.retrievedAt}
              asin={isValidAsin ? c.asin : null}
              open={weaknessesSourceOpen}
              onToggle={() => setWeaknessesSourceOpen(o => !o)}
            />
          ) : <SourceUnavailableCaption />
        )}

        {weaknessesOpen && (
          <div className="mt-3 space-y-2.5 animate-slide-down">
            {reviewAnalysis.status === "loading" && <SkeletonRows count={2} />}
            {reviewAnalysis.status === "error" && (
              <div className="flex items-center justify-between gap-2 p-2 bg-danger-bg border border-danger/20 rounded-lg">
                <span className="text-danger">{reviewAnalysis.message}</span>
                <TimeoutChip onRetry={() => loadReviewAnalysis()} />
              </div>
            )}
            {reviewAnalysis.status === "loaded" && reviewAnalysis.data.listingStats && (
              <ListingStatsCaption stats={reviewAnalysis.data.listingStats} />
            )}
            {reviewAnalysis.status === "loaded" && (reviewAnalysis.data.aiUnavailable || reviewAnalysis.data.sourcesUnavailable || reviewAnalysis.data.insufficientData) && (
              <ReviewSourcesNotice data={reviewAnalysis.data} onRetry={() => loadReviewAnalysis()} />
            )}
            {reviewAnalysis.status === "loaded" && !reviewAnalysis.data.insufficientData && !reviewAnalysis.data.sourcesUnavailable && !reviewAnalysis.data.aiUnavailable && (
              <>
                <div className="space-y-1.5">
                  <p className="font-bold text-danger text-[10px] uppercase tracking-wider">Weaknesses</p>
                  {reviewAnalysis.data.weaknesses.length === 0 && <p className="italic text-text-muted">None with verified support.</p>}
                  {reviewAnalysis.data.weaknesses.map((w, idx) => (
                    <div key={idx} className="space-y-1">
                      <p className="text-text-secondary font-semibold flex items-center flex-wrap gap-1">
                        {w.theme}
                        <CitationMarker source={sourceFor(weaknessesCitations, w.sourceUrl, reviewSourceLabel(w.sourceType) || w.evidence[0]?.quote?.slice(0, 40) || "Source", w.evidence[0]?.quote || "", reviewAnalysis.data.retrievedAt)} />
                        <span className="text-[9px] font-normal text-text-muted">[{reviewThemeSourceLabel(w)}]</span>
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
                          <p className="text-text-secondary font-semibold flex items-center flex-wrap gap-1">
                            {t.theme}
                            <span className="text-[9px] font-normal text-text-muted">[{reviewThemeSourceLabel(t)}]</span>
                          </p>
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

        {newsState.status === "loaded" && (
          assertProvenance(newsState.data.provenance, "news", c.name) ? (
            <SectionSourceLine
              flavor="news"
              provenance={newsState.data.provenance!}
              resolvedAt={newsState.data.retrievedAt}
              open={newsSourceOpen}
              onToggle={() => setNewsSourceOpen(o => !o)}
            />
          ) : <SourceUnavailableCaption />
        )}

        {newsOpen && (
          <div className="mt-3 space-y-2.5 animate-slide-down">
            {newsState.status === "loading" && <SkeletonRows count={2} />}
            {newsState.status === "error" && (
              <div className="flex items-center justify-between gap-2 p-2 bg-danger-bg border border-danger/20 rounded-lg">
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
                      <CitationMarker source={sourceFor(newsCitations, item.url, item.publisher || item.title, item.summary, newsState.data.searchedAt)} />
                    </p>
                    <p className="text-[11px] text-text-secondary leading-normal">{item.summary}</p>
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-text-muted hover:text-accent inline-flex items-center gap-1">
                      {item.publisher}{item.date && ` · ${item.date}`} <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                ))}
                {newsState.data.items.length > 0 && (
                  <SourcesFootnoteList sources={newsState.data.items.map(item => sourceFor(newsCitations, item.url, item.publisher || item.title, item.summary, newsState.data.searchedAt))} />
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
