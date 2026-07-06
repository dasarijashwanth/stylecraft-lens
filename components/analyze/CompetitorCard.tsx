"use client";

import { useState } from "react";
import { useAmazonProduct } from "@/hooks/useAmazonProduct";
import { ChevronDown, ChevronUp, ExternalLink, Star } from "lucide-react";

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
}

interface CompetitorCardProps {
  competitor: Competitor;
  tier?: "legacy" | "emerging";
}

export function CompetitorCard({ competitor: c }: CompetitorCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Fetch real-time data from Rainforest API using hook
  const { data: live, loading, error } = useAmazonProduct(c.asin);

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

      {/* Expandable: Strengths / Weaknesses / News */}
      <div className="border-t border-border/40 pt-3">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between text-text-muted hover:text-text-primary transition-colors font-semibold"
        >
          <span>Strengths, weaknesses & news</span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {expanded && (
          <div className="space-y-3.5 mt-3.5 animate-slide-down">
            {/* Strengths */}
            <div className="space-y-1">
              <p className="font-bold text-success text-[10px] uppercase tracking-wider">Strengths</p>
              <ul className="list-disc pl-4 space-y-1 text-text-secondary">
                {c.strengths?.map((s, idx) => (
                  <li key={idx}>{s}</li>
                ))}
                {(!c.strengths || c.strengths.length === 0) && <li className="italic text-text-muted">None documented</li>}
              </ul>
            </div>

            {/* Weaknesses */}
            <div className="space-y-1">
              <p className="font-bold text-danger text-[10px] uppercase tracking-wider">Weaknesses</p>
              <ul className="list-disc pl-4 space-y-1 text-text-secondary">
                {c.weaknesses?.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
                {(!c.weaknesses || c.weaknesses.length === 0) && <li className="italic text-text-muted">None documented</li>}
              </ul>
            </div>

            {/* Recent News */}
            {c.recent_news && c.recent_news.length > 0 && (
              <div className="space-y-1">
                <p className="font-bold text-accent text-[10px] uppercase tracking-wider">Recent News</p>
                <ul className="list-disc pl-4 space-y-1 text-text-secondary">
                  {c.recent_news.map((n, idx) => (
                    <li key={idx}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
