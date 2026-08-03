// Tier-6 "derived" computations for GTM/TDS field generation that aren't a
// direct copy from another already-known source (that's lib/gtm-derive.ts's
// job) — these actually compute something new from already-available data.
// Started from an audit finding good_better_best/hair_type had zero
// derivation at all (100% AI/web-dependent, chronically N/A); GTM Schema v2
// added good_better_best_performance and reworked manufacturer the same way.
import { computeTiers } from "./pricing-analysis";
import { GtmFieldAnswer } from "./gtm-field-schema";
import { extractCompetitorSpecs } from "./spec-extraction";
import { brandMatchesTitle } from "./legacy-brand-discovery";

export interface DerivedAnswer {
  answer: string;
  source: "derived";
}

// CHANGE 1 — "Good Better Best (Lineup)": where OUR product sits in OUR OWN
// catalog lineup by price. Replaced the field's old basis (tiering vs.
// competitor prices, which measured how we compare to THEM, not where we
// sit in OUR OWN lineup — the wrong basis for a field literally named
// "Lineup"). Reuses lib/pricing-analysis.ts's own Good/Better/Best
// tertile-by-rank math, fed our own catalog siblings' prices instead.
export interface CatalogLineupRow {
  tool_type: string;
  target_price: number | null;
  active: boolean;
}

export function deriveGoodBetterBestLineup(
  ourToolType: string | null | undefined,
  ourPriceRaw: number | null,
  catalogProducts: CatalogLineupRow[],
  toolTypeLabel: string
): GtmFieldAnswer | null {
  if (!ourToolType || ourPriceRaw == null) return null;
  const siblings = catalogProducts.filter(p => p.active && p.tool_type === ourToolType && p.target_price != null);
  if (siblings.length < 1) return null; // need >=1 sibling + ours = >=2 total, computeTiers' own floor

  const values = [ourPriceRaw, ...siblings.map(p => p.target_price as number)];
  const tiers = computeTiers(values);
  const myTier = tiers[0];
  if (!myTier) return null;

  const n = siblings.length;
  return {
    answer: myTier,
    source: "derived",
    sourceDetail: { label: `Derived from catalog lineup (${n} ${toolTypeLabel}${n === 1 ? "" : "s"})` },
  };
}

// CHANGE 2 — "Good Better Best (Performance)": a performance-tier rating
// (motor family + RPM + run time), completely distinct from the
// price-based Lineup tier above. Ranks our RPM against the pooled RPMs of
// the analysis' own matched competitors (already-scored, already-persisted
// on the saved report — no re-fetch). Requires >=1 competitor with a
// parseable RPM (>=2 total values including ours) or returns null, same
// graceful-degradation floor as every other Tier 6 deriver.
export interface CompetitorSpecSource {
  motor_type?: string | null;
  description?: string | null;
  feature_bullets?: string[];
  specifications?: any[];
  attributes?: any[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function deriveGoodBetterBestPerformance(
  ourRpm: number | null,
  ourMotorLabel: string,
  competitors: CompetitorSpecSource[]
): GtmFieldAnswer | null {
  if (ourRpm == null) return null;
  const competitorRpms = competitors
    .map(c => extractCompetitorSpecs(c).rpm)
    .filter((r): r is number => r != null);
  if (competitorRpms.length < 1) return null;

  const tiers = computeTiers([ourRpm, ...competitorRpms]);
  const myTier = tiers[0];
  if (!myTier) return null;

  const medianRpm = Math.round(median(competitorRpms));
  const label = `${myTier} — ${ourRpm}rpm${ourMotorLabel ? ` ${ourMotorLabel}` : ""} vs competitor median ${medianRpm}rpm`;
  return { answer: myTier, source: "derived", sourceDetail: { label } };
}

// CHANGE 6 — Manufacturer auto-detect cascade: catalog record (most
// authoritative, set when the analysis was built from a real catalog pick)
// -> admin-editable name-prefix hint map (lib/db/brand-name-hints.ts) ->
// TDS's own manufacturer field (today's sole path, kept as the last real
// signal) -> ambiguous (never silently guesses). Prefix matching reuses
// lib/legacy-brand-discovery.ts's brandMatchesTitle/normalizeBrandToken
// exactly — same word-boundary token discipline, just against name
// prefixes instead of brand aliases.
export interface BrandNameHintInput {
  brand: string;
  namePrefixes: string[];
}

export function deriveManufacturer(
  productName: string,
  catalogBrand: string | null | undefined,
  hints: BrandNameHintInput[],
  tdsManufacturer: string | null | undefined
): GtmFieldAnswer {
  if (catalogBrand?.trim()) {
    return { answer: catalogBrand.trim(), source: "derived", sourceDetail: { label: "From catalog record" } };
  }

  for (const hint of hints) {
    if (hint.namePrefixes.some(prefix => brandMatchesTitle(productName, prefix))) {
      return { answer: hint.brand, source: "derived", sourceDetail: { label: "From product line match" } };
    }
  }

  if (tdsManufacturer?.trim()) {
    return { answer: tdsManufacturer.trim(), source: "derived", sourceDetail: { label: "From product data" } };
  }

  return {
    answer: "Confirm manufacturer",
    source: "derived",
    flagged: true,
    sourceDetail: { label: "Confirm manufacturer", ambiguous: true },
  };
}

// CHANGE 5 — Comparison Chart WEB ONLY auto-suggest: prefills the two-slot
// picker with the closest same-tool-type catalog products by motor family +
// adjacent price tier (one above, one below where possible) — editable,
// never authoritative (labeled "Suggested — confirm", never silently final).
export interface ComparisonChartCatalogRow {
  name: string;
  brand: string | null;
  sku: string | null;
  tool_type: string;
  target_price: number | null;
  motor_family: string | null;
  active: boolean;
}

function renderComparisonChartSuggestion(slots: { name: string; brand: string; sku: string | null }[]): string {
  return slots.map((s, i) => `${i + 1}. ${s.name} (${s.brand}) — SKU ${s.sku || "—"}`).join("\n");
}

export function deriveComparisonChartSuggestion(
  ourToolType: string | null | undefined,
  ourPriceRaw: number | null,
  ourMotorFamily: string | null | undefined,
  catalogProducts: ComparisonChartCatalogRow[]
): GtmFieldAnswer | null {
  if (!ourToolType || ourPriceRaw == null) return null;
  const candidates = catalogProducts.filter(p => p.active && p.tool_type === ourToolType && p.target_price != null);
  if (candidates.length === 0) return null;

  const sameFamily = ourMotorFamily ? candidates.filter(p => p.motor_family === ourMotorFamily) : [];
  const pool = sameFamily.length >= 2 ? sameFamily : candidates;

  const above = [...pool].filter(p => (p.target_price as number) > ourPriceRaw).sort((a, b) => (a.target_price as number) - (b.target_price as number))[0];
  const below = [...pool].filter(p => (p.target_price as number) < ourPriceRaw).sort((a, b) => (b.target_price as number) - (a.target_price as number))[0];

  let picks = [below, above].filter((p): p is ComparisonChartCatalogRow => !!p);
  if (picks.length === 0) {
    picks = [...pool].sort((a, b) => Math.abs((a.target_price as number) - ourPriceRaw) - Math.abs((b.target_price as number) - ourPriceRaw)).slice(0, 2);
  }
  if (picks.length === 0) return null;

  const slots = picks.slice(0, 2).map(p => ({ name: p.name, brand: p.brand || "StyleCraft", sku: p.sku }));
  return {
    answer: renderComparisonChartSuggestion(slots),
    source: "derived",
    flagged: true,
    sourceDetail: { label: "Suggested — confirm", slots, suggested: true },
  };
}

// Keyword inference over already-sourced text (TDS product_description,
// Sales Kit feature headlines, the project's own category) — deliberately
// narrow and literal (a real keyword must appear), never a guess. Labeled
// per the spec's exact format so it's never presented with the confidence
// of a real cited fact.
const HAIR_TYPE_KEYWORDS: Record<string, string[]> = {
  "Curly/Coily Hair": ["curly", "coily", "kinky", "afro-textured", "type 4 hair"],
  "Straight/Fine Hair": ["straight hair", "fine hair", "thin hair"],
  "Thick/Coarse Hair": ["thick hair", "coarse hair", "dense hair"],
  "Wavy Hair": ["wavy hair", "wave pattern"],
  "All Hair Types": ["all hair types", "any hair type", "universal fit"],
};

export function inferHairType(sourcedText: string): DerivedAnswer | null {
  const lower = (sourcedText || "").toLowerCase();
  if (!lower.trim()) return null;

  for (const [label, keywords] of Object.entries(HAIR_TYPE_KEYWORDS)) {
    const matched = keywords.filter(k => lower.includes(k));
    if (matched.length > 0) {
      return { answer: `${label} — Derived from product features (${matched.join(", ")})`, source: "derived" };
    }
  }
  return null;
}

// Applied deliberately AFTER the web-search fallback tier in the caller's
// pipeline (lib/gtm-generate.ts) — these are pure computed inferences, not
// direct source copies, so they must never preempt a real web search result.
// Only fills a field that's STILL unresolved once AI + web search have both
// had their turn; never overwrites a real answer either tier already found.
function isUnresolved(fields: Record<string, GtmFieldAnswer>, id: string): boolean {
  const current = fields[id];
  return !current || current.source === "none" || current.answer.toUpperCase() === "N/A";
}

export function applyTier6Inference(
  fields: Record<string, GtmFieldAnswer>,
  schema: { id: string }[],
  input: {
    hairTypeSourceText: string;
    catalogLineup?: {
      ourToolType: string | null | undefined;
      ourPriceRaw: number | null;
      catalogProducts: CatalogLineupRow[];
      toolTypeLabel: string;
    } | null;
    performance?: {
      ourRpm: number | null;
      ourMotorLabel: string;
      competitors: CompetitorSpecSource[];
    } | null;
    manufacturer?: {
      productName: string;
      catalogBrand: string | null | undefined;
      hints: BrandNameHintInput[];
      tdsManufacturer: string | null | undefined;
    } | null;
    comparisonChart?: {
      ourToolType: string | null | undefined;
      ourPriceRaw: number | null;
      ourMotorFamily: string | null | undefined;
      catalogProducts: ComparisonChartCatalogRow[];
    } | null;
  }
) {
  if (schema.some(f => f.id === "good_better_best") && isUnresolved(fields, "good_better_best") && input.catalogLineup) {
    const derived = deriveGoodBetterBestLineup(
      input.catalogLineup.ourToolType,
      input.catalogLineup.ourPriceRaw,
      input.catalogLineup.catalogProducts,
      input.catalogLineup.toolTypeLabel
    );
    if (derived) fields["good_better_best"] = derived;
  }
  if (schema.some(f => f.id === "good_better_best_performance") && isUnresolved(fields, "good_better_best_performance") && input.performance) {
    const derived = deriveGoodBetterBestPerformance(input.performance.ourRpm, input.performance.ourMotorLabel, input.performance.competitors);
    if (derived) fields["good_better_best_performance"] = derived;
  }
  if (schema.some(f => f.id === "hair_type") && isUnresolved(fields, "hair_type")) {
    const derived = inferHairType(input.hairTypeSourceText);
    if (derived) fields["hair_type"] = derived;
  }
  if (schema.some(f => f.id === "manufacturer") && isUnresolved(fields, "manufacturer") && input.manufacturer) {
    fields["manufacturer"] = deriveManufacturer(
      input.manufacturer.productName,
      input.manufacturer.catalogBrand,
      input.manufacturer.hints,
      input.manufacturer.tdsManufacturer
    );
  }
  if (schema.some(f => f.id === "comparison_chart_web_only") && isUnresolved(fields, "comparison_chart_web_only") && input.comparisonChart) {
    const derived = deriveComparisonChartSuggestion(
      input.comparisonChart.ourToolType,
      input.comparisonChart.ourPriceRaw,
      input.comparisonChart.ourMotorFamily,
      input.comparisonChart.catalogProducts
    );
    if (derived) fields["comparison_chart_web_only"] = derived;
  }
}
