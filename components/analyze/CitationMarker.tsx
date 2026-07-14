"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";

export interface MarkerSource {
  number: number;
  url: string;
  title: string;
  publisher: string;
  quote: string;
  retrievedAt: string;
}

function faviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return "";
  }
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// A single ChatGPT-style inline citation chip — small raised number,
// hover/tap reveals a source card (favicon, title, domain, retrieved date,
// supporting quote). Numbers are assigned by the caller (per-section,
// deduped by URL) so the same source cited twice keeps one number.
export function CitationMarker({ source }: { source: MarkerSource }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex items-center justify-center align-super ml-0.5 w-3.5 h-3.5 rounded-full bg-accent/15 border border-accent/30 text-accent text-[8px] font-bold hover:bg-accent/25 transition-colors"
      >
        {source.number}
      </button>

      {open && (
        <div
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className="absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-64 p-2.5 rounded-lg bg-surface-1 border border-border-strong shadow-lg text-left"
        >
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 group">
            {faviconUrl(source.url) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={faviconUrl(source.url)} alt="" className="w-4 h-4 mt-0.5 shrink-0 rounded-sm" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-text-primary leading-snug line-clamp-2 group-hover:underline">
                {source.title || domainOf(source.url)}
              </p>
              <p className="text-[9px] text-text-muted flex items-center gap-1 mt-0.5">
                {domainOf(source.url)} <ExternalLink className="w-2.5 h-2.5" />
              </p>
            </div>
          </a>
          {source.quote && (
            <p className="text-[10px] text-text-secondary italic mt-1.5 pt-1.5 border-t border-border/40 line-clamp-3">
              &ldquo;{source.quote}&rdquo;
            </p>
          )}
          <p className="text-[8px] text-text-muted mt-1">
            Retrieved {new Date(source.retrievedAt).toLocaleDateString()}
          </p>
        </div>
      )}
    </span>
  );
}

// Builds stable, per-section, deduped-by-URL citation numbering. Call once
// per section with the raw sources encountered (in display order); returns
// a lookup so each claim's source renders the same number if cited again.
export function useCitationNumbering() {
  const [registry] = useState(() => new Map<string, number>());

  function numberFor(url: string): number {
    const key = url.split("?")[0].replace(/\/$/, "").toLowerCase();
    if (!registry.has(key)) registry.set(key, registry.size + 1);
    return registry.get(key)!;
  }

  function allSources(): string[] {
    return Array.from(registry.keys());
  }

  return { numberFor, allSources };
}

// Per-section numbered Sources footer — favicon + title + domain, deduped,
// linking out. Mirrors the existing CitationsSection list style but adds
// favicons per the "ChatGPT-style" ask.
export function SourcesFootnoteList({ sources }: { sources: MarkerSource[] }) {
  if (sources.length === 0) return null;
  const seen = new Set<number>();
  const unique = sources.filter(s => (seen.has(s.number) ? false : (seen.add(s.number), true))).sort((a, b) => a.number - b.number);

  return (
    <div className="space-y-1 pt-2 border-t border-border/30">
      <p className="text-[9px] font-bold text-text-muted uppercase tracking-wider">Sources</p>
      <ol className="space-y-1">
        {unique.map(s => (
          <li key={s.number} className="flex items-start gap-1.5 text-[10px]">
            <span className="text-text-muted font-mono shrink-0">[{s.number}]</span>
            {faviconUrl(s.url) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={faviconUrl(s.url)} alt="" className="w-3 h-3 mt-0.5 shrink-0 rounded-sm" />
            )}
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline truncate">
              {s.title || domainOf(s.url)} <span className="text-text-muted">— {domainOf(s.url)}</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
