// lib/provenance-format.ts
// Single source of truth for how a section's persisted provenance trail
// (lib/section-provenance.ts) is described in prose — shared by the live
// browser UI (components/analyze/SectionSourceLine.tsx) and BOTH PDF
// pipelines (lib/export-pdf.ts, lib/pdf/ActiveReportPdf.tsx), so all three
// read identically. Deliberately ASCII-only (no emoji, no star glyphs) so
// the exact same string is safe to reuse verbatim in either PDF renderer.
// Plain TS, no server-only imports.
import type { ProvenanceTier, SectionProvenanceData } from "./section-provenance";

export type SectionFlavor = "key_features" | "reviews" | "news" | "pricing";

export function formatRetrievedAt(iso: string | null | undefined): string {
  if (!iso) return "time unknown";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "time unknown";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function domainOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function uniqueDomains(urls: string[] | undefined): string[] {
  return Array.from(new Set((urls || []).map(domainOf).filter(Boolean)));
}

// Turns one tier's outcome into a short, honest phrase — "returned 0" and
// "failed" must read differently, since they mean very different things
// (the section genuinely has no data vs. the source was unreachable).
export function describeProvenanceTier(t: ProvenanceTier): string {
  const timing = t.elapsedMs != null ? ` - ${t.elapsedMs} ms` : "";
  if (!t.attempted || t.outcome === "skipped") {
    return `skipped${t.errorMessage ? ` (${t.errorMessage})` : ""}`;
  }
  if (t.outcome === "success") {
    const rejected = t.rejectedCount ? `, ${t.rejectedCount} rejected` : "";
    return `ok - ${t.itemCount ?? 0} item(s)${rejected}${timing}`;
  }
  if (t.outcome === "empty") return `returned 0${timing}`;
  if (t.outcome === "error") return `failed${t.errorMessage ? ` (${t.errorMessage})` : ""}${timing}`;
  return `${t.outcome}${timing}`;
}

// The one-line summary per the user's 4 example formats, ASCII only.
// `resolvedAt` is passed separately (not read off `data`) since the live UI
// sources it from each section's own fetch response (retrievedAt/searchedAt)
// while a saved report sources it from a persisted ProvenanceRow — two
// different origins for the same kind of timestamp.
export function summarizeSource(
  flavor: SectionFlavor,
  data: SectionProvenanceData | null | undefined,
  resolvedAt: string | null | undefined,
  opts?: { asin?: string | null }
): string {
  const tiers = data?.tiers ?? [];
  const errored = tiers.some(t => t.attempted && t.outcome === "error");
  const ts = formatRetrievedAt(resolvedAt);

  if (flavor === "key_features") {
    const successful = tiers.filter(t => t.outcome === "success");
    if (successful.length === 0) {
      return errored ? `Some sources unavailable - checked ${ts}` : `No source found - checked ${ts}`;
    }
    const parts = successful.map(t => {
      if (t.tier === "Amazon") return opts?.asin ? `Amazon listing (ASIN ${opts.asin})` : "Amazon listing";
      const domains = uniqueDomains(t.sourceUrls);
      return domains.length ? `${t.tier} (${domains.join(", ")})` : t.tier;
    });
    return `${parts.join(" + ")} - retrieved ${ts}`;
  }

  if (flavor === "reviews") {
    const amazonReviews = tiers.find(t => t.tier === "Amazon reviews" && t.outcome === "success");
    if (amazonReviews) return `${amazonReviews.itemCount ?? 0} Amazon reviews - retrieved ${ts}`;
    const listing = tiers.find(t => t.tier === "Amazon listing (top reviews)" && t.outcome === "success");
    if (listing) return `Listing top reviews + rating breakdown - retrieved ${ts}`;
    const expert = tiers.find(t => t.tier === "Expert reviews" && t.outcome === "success");
    const forum = tiers.find(t => t.tier === "Forum discussions" && t.outcome === "success");
    if (expert || forum) {
      const count = (expert?.itemCount ?? 0) + (forum?.itemCount ?? 0);
      const domains = uniqueDomains([...(expert?.sourceUrls ?? []), ...(forum?.sourceUrls ?? [])]);
      return `${count} expert reviews${domains.length ? ` (${domains.join(", ")})` : ""} - retrieved ${ts}`;
    }
    return errored ? `Live review sources unavailable - checked ${ts}` : `No review sources found - checked ${ts}`;
  }

  if (flavor === "news") {
    const tier = tiers[0];
    if (!tier || tier.outcome !== "success" || !tier.itemCount) {
      return errored ? `News search unavailable - checked ${ts}` : `No product-specific coverage found - searched ${ts}`;
    }
    const domains = uniqueDomains(tier.sourceUrls);
    return `Web news search (${tier.itemCount} article${tier.itemCount === 1 ? "" : "s"}${domains.length ? `: ${domains.join(", ")}` : ""}) - searched ${ts}`;
  }

  // pricing
  const tier = tiers[0];
  if (!tier || tier.outcome === "empty") return `No live price found - checked ${ts}`;
  return `Live Amazon prices via Rainforest - retrieved ${ts}`;
}

// "A section can't render without provenance" — throws in dev (surfaces
// immediately during development), logs + degrades in prod (the section's
// real data still renders; only the source line falls back to a muted
// caption). Hiding real analysis data over missing metadata would be a
// worse failure than a degraded caption.
export function assertProvenance(
  data: SectionProvenanceData | null | undefined,
  section: string,
  ctx?: string | null
): data is SectionProvenanceData {
  if (data && Array.isArray(data.tiers)) return true;
  const msg = `[provenance] missing record for "${section}"${ctx ? ` (${ctx})` : ""}`;
  if (process.env.NODE_ENV !== "production") {
    throw new Error(msg);
  }
  console.error(msg);
  return false;
}
