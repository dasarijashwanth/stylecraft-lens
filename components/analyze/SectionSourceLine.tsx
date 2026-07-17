"use client";

// Shared, flavor-parameterized source line + "Details" disclosure panel —
// one component for all four analysis sections (Key Features, Reviews,
// News, Pricing) rather than four near-duplicates, since they differ only
// in summarizeSource()'s one-line output; the Details panel is identical.
// Follows this codebase's existing hand-rolled-useState disclosure idiom
// (no shared <Disclosure>/<Collapsible> primitive exists anywhere in this
// app) — each caller owns its own open/onToggle state.
import { ChevronDown, ChevronUp, CheckCircle2, MinusCircle, AlertCircle, CircleSlash } from "lucide-react";
import type { SectionProvenanceData, ProvenanceTier } from "@/lib/section-provenance";
import { SectionFlavor, summarizeSource, describeProvenanceTier, domainOf, formatRetrievedAt } from "@/lib/provenance-format";

function TierStatusIcon({ tier }: { tier: ProvenanceTier }) {
  if (!tier.attempted || tier.outcome === "skipped") return <CircleSlash className="w-3 h-3 text-text-muted shrink-0" />;
  if (tier.outcome === "success") return <CheckCircle2 className="w-3 h-3 text-success shrink-0" />;
  if (tier.outcome === "empty") return <MinusCircle className="w-3 h-3 text-text-muted shrink-0" />;
  return <AlertCircle className="w-3 h-3 text-danger shrink-0" />;
}

export function ProvenanceDetails({ provenance, resolvedAt }: { provenance: SectionProvenanceData; resolvedAt?: string | null }) {
  return (
    <div className="mt-1.5 p-2 rounded-lg bg-surface-3/40 border border-border/40 space-y-2 text-[10px]">
      <div className="space-y-1">
        {provenance.tiers.map((t, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <TierStatusIcon tier={t} />
            <div>
              <span className="text-text-secondary">{t.tier} — {describeProvenanceTier(t)}</span>
              {!!t.rejectedReasons?.length && (
                <ul className="pl-3 list-disc text-text-muted">
                  {t.rejectedReasons.map((r, ri) => <li key={ri}>{r}</li>)}
                </ul>
              )}
              {!!t.sourceUrls?.length && (
                <div className="flex flex-wrap gap-1.5 mt-0.5">
                  {Array.from(new Set(t.sourceUrls)).map((url, ui) => (
                    <a key={ui} href={url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                      {domainOf(url) || url}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {provenance.queries.length > 0 && (
        <div className="pt-1.5 border-t border-border/30 space-y-0.5">
          <p className="text-text-muted uppercase font-bold tracking-wider text-[9px]">Queries run</p>
          {provenance.queries.map((q, i) => (
            <div key={i} className="font-mono text-text-secondary">
              {q.query}
              {q.itemCount != null && <span className="text-text-muted"> ({q.itemCount})</span>}
              {q.verified === false && <span className="text-warning italic"> (self-reported, unverified)</span>}
            </div>
          ))}
        </div>
      )}

      <p className="pt-1.5 border-t border-border/30 text-text-muted">Retrieved {formatRetrievedAt(resolvedAt)}</p>
    </div>
  );
}

export function SectionSourceLine({
  flavor,
  provenance,
  resolvedAt,
  asin,
  open,
  onToggle,
}: {
  flavor: SectionFlavor;
  provenance: SectionProvenanceData;
  resolvedAt?: string | null;
  asin?: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="text-[10px] text-text-muted">
      <div className="flex items-center gap-1 flex-wrap">
        <span>📍 {flavor === "news" ? "Sources" : "Source"}: {summarizeSource(flavor, provenance, resolvedAt, { asin })}</span>
        <button type="button" onClick={onToggle} className="inline-flex items-center gap-0.5 text-accent hover:underline font-semibold shrink-0">
          Details {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>
      {open && <ProvenanceDetails provenance={provenance} resolvedAt={resolvedAt} />}
    </div>
  );
}

// Muted fallback shown in production when a section legitimately has no
// stored provenance yet (e.g. a report saved before this feature existed) —
// the section's real data still renders; only this caption is degraded.
export function SourceUnavailableCaption() {
  return <p className="text-[10px] text-text-muted italic">Source trail unavailable</p>;
}
