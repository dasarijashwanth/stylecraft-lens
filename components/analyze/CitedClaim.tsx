"use client";

import { ExternalLink, ShieldCheck, AlertTriangle } from "lucide-react";

export interface ClaimSource {
  url: string;
  title: string;
  publisher: string;
  quote: string;
  retrievedAt: string;
}

export interface Claim {
  claimId: string;
  text: string;
  type: string;
  verification: "verified" | "unverified" | "model_estimate";
  sources: ClaimSource[];
}

// Renders the full set of citations backing a document's claims — a
// numbered reference list (verified, with real URLs) plus a separate count
// of claims that were checked and could NOT be verified server-side (their
// quote didn't actually appear on the page cited). Nothing here is ever
// silently dropped: an unverified claim still shows, just labeled honestly.
export function CitationsSection({ claims }: { claims: Claim[] }) {
  if (!claims || claims.length === 0) return null;

  const verified = claims.filter(c => c.verification === "verified");
  const unverified = claims.filter(c => c.verification !== "verified");

  return (
    <div className="subsection space-y-3 pt-4 border-t border-border/40">
      <h3 className="subsection-heading text-xs font-bold text-text-muted uppercase tracking-wider flex items-center gap-1">
        <ShieldCheck className="w-4 h-4 text-accent" />
        <span>Sources & References</span>
      </h3>

      {verified.length > 0 && (
        <ol className="space-y-2 text-xs">
          {verified.map((c, i) => (
            <li key={c.claimId} className="flex items-start gap-2 leading-normal">
              <span className="shrink-0 text-text-muted font-mono text-[10px] mt-0.5">[{i + 1}]</span>
              <div className="space-y-0.5">
                <p className="text-text-secondary">{c.text}</p>
                {c.sources.map((s, si) => (
                  <a
                    key={si}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-accent hover:underline"
                  >
                    <span>{s.publisher || s.title || s.url}</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}

      {unverified.length > 0 && (
        <div className="space-y-1.5 pt-1">
          {unverified.map(c => (
            <div key={c.claimId} className="flex items-start gap-2 p-2 rounded-lg bg-warning/5 border border-warning/20">
              <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
              <div className="text-[11px] leading-normal">
                <p className="text-text-secondary">{c.text}</p>
                <p className="text-warning font-semibold mt-0.5">No verifiable source found — treat as unverified estimate</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Inline badge for a single unverified figure shown elsewhere in the page
// (e.g. next to a market-size stat) — the numbered citation list above
// covers the full reference detail; this is just the at-a-glance flag.
export function UnverifiedBadge({ title }: { title?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-warning/10 border border-warning/25 text-warning"
      title={title || "No verifiable source found — treat as unverified estimate"}
    >
      <AlertTriangle className="w-2.5 h-2.5" />
      Unverified
    </span>
  );
}
