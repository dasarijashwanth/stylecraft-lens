// Shared, deterministic pricing-analysis builder — the single place that
// computes the "Pricing Analysis & Benchmarks" report section, consumed by
// the report-save path (lib/db/reports.ts), the legacy-report lazy-recompute
// path (lib/db/reports.ts's getReport), the pre-save ephemeral PDF export
// (components/analyze/ResultsPanel.tsx), and both PDF renderers
// (lib/export-pdf.ts, lib/pdf/ActiveReportPdf.tsx) — one shape, one set of
// rules, instead of four independent (and previously inconsistent) copies.
//
// Plain TS, no server-only imports — must be importable from "use client"
// components as well as server-side route/db code.
import { firstOf } from "./gtm-derive";

export type PricingTier = "Good" | "Better" | "Best";
export type TargetPriceSource = "project_record" | "gtm_approved_pricing" | "catalog_default";

export interface PricingBenchmarkRow {
  name: string;
  brand: string | null;
  // 3 buckets by price rank across the compared set — the user's own spec
  // named exactly 3 labels (Good/Better/Best), which is a TERTILE split,
  // not a literal quartile (4 groups) despite the word "quartile" being
  // used — documented here since it's a deliberate correction, not a typo.
  tier: PricingTier | null;
  price: string | null;
  price_raw: number | null;
  source_url: string | null;
  retrieved_at: string | null;
}

export interface PricingAnalysis {
  schema_version: 2;
  target_price: string | null;
  target_price_source: TargetPriceSource | null;
  competitor_prices: PricingBenchmarkRow[];
  price_positioning: string | null;
  notes: string | null;
}

export function parsePriceToNumber(price: string | null | undefined): number | null {
  if (!price) return null;
  const n = parseFloat(String(price).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

// Buckets priced rows into 3 groups by ascending price rank. Rows with no
// resolvable price get `null` (excluded from bucketing, not guessed into a
// tier); if fewer than 2 rows have a price, tiering isn't meaningful at all
// and every row gets `null`.
export function computeTiers(rows: { price_raw: number | null }[]): (PricingTier | null)[] {
  const labels: PricingTier[] = ["Good", "Better", "Best"];
  const pricedIndexes = rows
    .map((r, i) => ({ i, price: r.price_raw }))
    .filter((r): r is { i: number; price: number } => r.price != null)
    .sort((a, b) => a.price - b.price);

  const result: (PricingTier | null)[] = rows.map(() => null);
  if (pricedIndexes.length < 2) return result;

  const n = pricedIndexes.length;
  pricedIndexes.forEach((row, rank) => {
    const bucket = Math.min(2, Math.floor((rank * 3) / n));
    result[row.i] = labels[bucket];
  });
  return result;
}

export function resolveTargetPrice(
  candidates: [string | null | undefined, TargetPriceSource][]
): { value: string; source: TargetPriceSource } | null {
  const picked = firstOf(...candidates);
  return picked ? { value: picked.answer, source: picked.source } : null;
}

// "Target price $X sits {below/at/above} the category median of $M across N
// compared competitors (range $min–$max)." Every number here comes from the
// same rows the benchmarks table renders — never a separate, uncited figure
// (e.g. a market-size stat) smuggled into this sentence.
export function buildPricePositioningSentence(
  targetPriceRaw: number | null,
  rows: PricingBenchmarkRow[]
): string | null {
  const priced = rows.map(r => r.price_raw).filter((p): p is number => p != null);
  if (targetPriceRaw == null || priced.length === 0) return null;

  const sorted = [...priced].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  const relation = targetPriceRaw > median * 1.02 ? "above" : targetPriceRaw < median * 0.98 ? "below" : "at";
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  return `Target price ${fmt(targetPriceRaw)} sits ${relation} the category median of ${fmt(median)} across ${priced.length} compared competitor${priced.length === 1 ? "" : "s"} (range ${fmt(min)}–${fmt(max)}).`;
}

// 2-4 deterministic template sentences built only from numbers already in
// `rows`/`targetPriceRaw`/`identity` — the same "never claim what isn't in
// the provided sources" discipline this codebase's AI-grounding conventions
// use, applied here as plain code rather than a new LLM call (this data is
// already fully resolved by the time this runs; an async AI call would only
// add latency/cost to restate numbers already on the page).
export function buildPricingNotes(
  targetPriceRaw: number | null,
  rows: PricingBenchmarkRow[],
  identity?: { category?: string; subcategory?: string; whatItIs?: string }
): string | null {
  const priced = rows.filter(r => r.price_raw != null);
  if (priced.length === 0) return null;

  const sorted = [...priced].sort((a, b) => (a.price_raw as number) - (b.price_raw as number));
  const cheapest = sorted[0];
  const priciest = sorted[sorted.length - 1];
  const categoryLabel = identity?.subcategory || identity?.category;

  const lines: string[] = [];

  if (targetPriceRaw != null) {
    const bestRow = rows.find(r => r.tier === "Best");
    const goodRow = rows.find(r => r.tier === "Good");
    if (bestRow && targetPriceRaw >= (bestRow.price_raw ?? Infinity)) {
      lines.push(`Priced in line with the premium "Best" tier of the compared set${categoryLabel ? ` for ${categoryLabel}` : ""}; messaging should lead with brand equity or standout specs rather than price.`);
    } else if (goodRow && targetPriceRaw <= (goodRow.price_raw ?? -Infinity)) {
      lines.push(`Priced at the accessible "Good" tier of the compared set${categoryLabel ? ` for ${categoryLabel}` : ""}; value-for-money is the natural pricing story here.`);
    } else {
      lines.push(`Priced in the "Better" mid-tier of the compared set${categoryLabel ? ` for ${categoryLabel}` : ""}, between ${cheapest.name} (${cheapest.price}) and ${priciest.name} (${priciest.price}).`);
    }
  }

  if (priced.length >= 2) {
    lines.push(`The ${priced.length} priced competitors span ${cheapest.price} to ${priciest.price} — a gap worth calling out explicitly if this product's pricing sits toward either end.`);
  }

  return lines.length ? lines.join(" ") : null;
}

export function isPricingAnalysisEmpty(pa: PricingAnalysis | null | undefined): boolean {
  return !pa?.target_price && (!pa?.competitor_prices || pa.competitor_prices.length === 0);
}

export interface BuildPricingAnalysisInput {
  competitors: Array<{
    name: string;
    brand?: string | null;
    price?: string | null;
    price_raw?: number | null;
    amazon_url?: string | null;
    source_url?: string | null;
    last_updated?: string | null;
    retrieved_at?: string | null;
  }>;
  targetPriceCandidates: [string | null | undefined, TargetPriceSource][];
  identity?: { category?: string; subcategory?: string; whatItIs?: string };
}

export function buildPricingAnalysis(input: BuildPricingAnalysisInput): PricingAnalysis {
  const rows: PricingBenchmarkRow[] = input.competitors
    .filter(c => c && c.name)
    .map(c => ({
      name: c.name,
      brand: c.brand ?? null,
      tier: null,
      price: c.price ?? null,
      price_raw: c.price_raw ?? parsePriceToNumber(c.price),
      source_url: c.source_url ?? c.amazon_url ?? null,
      retrieved_at: c.retrieved_at ?? c.last_updated ?? null,
    }));

  const tiers = computeTiers(rows);
  rows.forEach((r, i) => { r.tier = tiers[i]; });

  const target = resolveTargetPrice(input.targetPriceCandidates);
  const targetPriceRaw = target ? parsePriceToNumber(target.value) : null;

  return {
    schema_version: 2,
    target_price: target?.value ?? null,
    target_price_source: target?.source ?? null,
    competitor_prices: rows,
    price_positioning: buildPricePositioningSentence(targetPriceRaw, rows),
    notes: buildPricingNotes(targetPriceRaw, rows, input.identity),
  };
}
