"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Award, TrendingUp } from "lucide-react";

interface CompetitorCardProps {
  competitor: {
    name: string;
    brand: string;
    tier: "legacy" | "emerging";
    asin: string;
    amazon_url: string;
    price: string;
    rating: string;
    review_count: string;
    monthly_sales?: string;
    bsr_rank?: string;
    initials: string;
    key_features: Array<{
      headline: string;
      source: string;
      attribution: string;
      detail: string;
    }>;
    strengths: string[];
    weaknesses: string[];
    recent_news: string[];
  };
  tier: "legacy" | "emerging";
}

export function CompetitorCard({ competitor: c }: CompetitorCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="competitor-card bg-surface-2 border border-border rounded-xl p-5 space-y-4 shadow-sm hover:border-border-strong transition-colors text-xs">
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

        {c.amazon_url && (
          <a
            href={c.amazon_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] font-semibold text-accent hover:underline shrink-0"
          >
            <span>View on Amazon</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Data Row */}
      <div className="grid grid-cols-3 gap-2 py-2 border-y border-border/40 text-center font-mono">
        <div className="text-left">
          <p className="text-[9px] text-text-muted uppercase font-sans font-bold">Price</p>
          <p className="font-bold text-text-primary text-xs mt-0.5">{c.price || "—"}</p>
        </div>
        <div>
          <p className="text-[9px] text-text-muted uppercase font-sans font-bold">Rating</p>
          <p className="font-bold text-text-primary text-xs mt-0.5">{c.rating || "—"} ★</p>
        </div>
        <div className="text-right">
          <p className="text-[9px] text-text-muted uppercase font-sans font-bold">Reviews</p>
          <p className="font-bold text-text-primary text-xs mt-0.5">{c.review_count || "—"}</p>
        </div>
      </div>

      {/* ASIN & BSR details */}
      <div className="space-y-1 font-mono text-[10px] text-text-secondary leading-none">
        {c.bsr_rank && (
          <p>
            <span className="text-text-muted">BSR:</span> {c.bsr_rank}
          </p>
        )}
        {c.asin && (
          <p>
            <span className="text-text-muted">ASIN:</span> {c.asin}
          </p>
        )}
      </div>

      {/* Key Features */}
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

      {/* Expandable Section */}
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
