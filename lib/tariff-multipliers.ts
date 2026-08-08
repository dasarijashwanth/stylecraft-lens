// lib/tariff-multipliers.ts
// Internal tariff/duty multiplier table for the Pricing tab's landed-cost
// calculator — replaces any notion of a live web-search tariff lookup with
// a single, hardcoded, admin-reviewed source of truth. getMultiplier never
// guesses: an unmatched (country, productType, royaltyType) combination
// returns NO_MULTIPLIER_MESSAGE rather than falling back to a nearby row or
// a web search. Zero I/O, zero network calls — pure data + a pure function.

export type Country =
  | "china" | "europe" | "vietnam" | "malaysia" | "cambodia"
  | "india" | "indonesia" | "thailand" | "south_korea";

export type ProductType =
  | "clippers_trimmers" | "styling_tools_shavers" | "aprons_garments" | "liquids" | "parts";

export type RoyaltyType = "none" | "gamma_shared_5" | "gamma_nonshared_10";

export const COUNTRY_OPTIONS: { value: Country; label: string }[] = [
  { value: "china", label: "China" },
  { value: "europe", label: "Europe" },
  { value: "vietnam", label: "Vietnam" },
  { value: "malaysia", label: "Malaysia" },
  { value: "cambodia", label: "Cambodia" },
  { value: "india", label: "India" },
  { value: "indonesia", label: "Indonesia" },
  { value: "thailand", label: "Thailand" },
  { value: "south_korea", label: "South Korea" },
];

export const PRODUCT_TYPE_OPTIONS: { value: ProductType; label: string }[] = [
  { value: "clippers_trimmers", label: "Clippers & Trimmers" },
  { value: "styling_tools_shavers", label: "Styling Tools & Shavers" },
  { value: "aprons_garments", label: "Aprons & Garments" },
  { value: "liquids", label: "Liquids" },
  { value: "parts", label: "Parts" },
];

export const ROYALTY_TYPE_OPTIONS: { value: RoyaltyType; label: string }[] = [
  { value: "none", label: "None (no brand partner)" },
  { value: "gamma_shared_5", label: "Gamma+ shared barber project (5% royalty)" },
  { value: "gamma_nonshared_10", label: "Gamma+ non-shared (10% royalty)" },
];

// The Royalty % field defaults from Royalty Type but is an editable
// override (Pricing tab spec: "Royalty % derived from Royalty Type
// (editable override allowed)").
export const ROYALTY_PCT_BY_TYPE: Record<RoyaltyType, number> = {
  none: 0,
  gamma_shared_5: 0.05,
  gamma_nonshared_10: 0.10,
};

export const NO_MULTIPLIER_MESSAGE = "No tariff multiplier on file for this combination — contact admin.";

// Effective-date stamp for the chart below — bump this string every time
// TARIFF_TABLE's values change. Surfaced verbatim on the Pricing tab's
// tariff calculator footer (see TariffPriceStackEditor/Summary in
// app/(app)/dashboard/projects/[id]/page.tsx) so a viewer always knows
// which chart revision priced their number.
export const TARIFF_TABLE_UPDATED_ON = "2026-08-06";
export const TARIFF_EFFECTIVE_NOTE = `Rates effective as of loading dates at origin — tariff chart updated ${TARIFF_TABLE_UPDATED_ON}.`;

// Component breakdown of a row's markup, all as decimals (0.38 = 38%) —
// stored alongside the final `multiplier` so future chart updates are
// auditable against the source spreadsheet's own columns rather than only
// against an opaque final number. Omitted entirely for rows the chart
// gives no breakdown for (India/Indonesia/Thailand/South Korea — "Total
// Markup" only, every component column is "—"). See the sanity-check loop
// below TARIFF_TABLE for how this is validated at module load.
interface TariffComponents {
  tariff?: number;
  duty?: number;
  freight?: number;
  royalty?: number;
  other?: number;
}

interface TariffRow {
  id: string;
  country: Country;
  productTypes: ProductType[] | "any";
  royaltyTypes: RoyaltyType[] | "any";
  components?: TariffComponents;
  multiplier: number;
  sourceLabel: string; // verbatim spec line, for admin-facing display/audit
}

// Order matters only for readability — resolution below is specificity-based,
// not first-match-wins, so row order never silently changes an answer.
//
// Chart revision: 2026-08-06 (see TARIFF_TABLE_UPDATED_ON above). "Parts"
// no longer has its own row — the chart now bundles Clippers & trimmers,
// blades, AND parts into one no-brand-partner China row (cn_clip_none
// below), so `parts` was added to that row's productTypes instead of
// keeping a separate `cn_parts` entry; Gamma+ clippers rows were never
// spec'd to include parts and still don't.
export const TARIFF_TABLE: TariffRow[] = [
  { id: "cn_clip_none", country: "china", productTypes: ["clippers_trimmers", "parts"], royaltyTypes: ["none"], components: { tariff: 0.38, duty: 0.04, freight: 0.075 }, multiplier: 1.49, sourceLabel: "China, Clippers & trimmers, blades, and parts, no brand partner" },
  { id: "cn_style_none", country: "china", productTypes: ["styling_tools_shavers"], royaltyTypes: ["none"], components: { tariff: 0.21, duty: 0.04, freight: 0.075 }, multiplier: 1.32, sourceLabel: "China, Styling tools, nose trimmer, shavers & hair dryers, no brand partner" },
  { id: "cn_clip_shared5", country: "china", productTypes: ["clippers_trimmers"], royaltyTypes: ["gamma_shared_5"], components: { tariff: 0.38, duty: 0.04, freight: 0.075, royalty: 0.05 }, multiplier: 1.54, sourceLabel: "China, Shared Barber projects (shared mold cost), Gamma+ (5% royalty)" },
  { id: "cn_clip_nonshared10", country: "china", productTypes: ["clippers_trimmers"], royaltyTypes: ["gamma_nonshared_10"], components: { tariff: 0.38, duty: 0.04, freight: 0.075, royalty: 0.10 }, multiplier: 1.59, sourceLabel: "China, Clippers & trimmers & blades, Gamma+ (10% royalty)" },
  { id: "cn_style_nonshared10", country: "china", productTypes: ["styling_tools_shavers"], royaltyTypes: ["gamma_nonshared_10"], components: { tariff: 0.21, duty: 0.04, freight: 0.075, royalty: 0.10 }, multiplier: 1.42, sourceLabel: "China, Styling tools, nose trimmer, shavers & hair dryers, Gamma+ (10% royalty)" },
  { id: "cn_aprons", country: "china", productTypes: ["aprons_garments"], royaltyTypes: "any", components: { tariff: 0.21, duty: 0.075, freight: 0.075, other: 0.16 }, multiplier: 1.52, sourceLabel: "China, Aprons, capes, garments" },
  { id: "eu_beauty_gamma", country: "europe", productTypes: "any", royaltyTypes: ["gamma_shared_5", "gamma_nonshared_10"], components: { tariff: 0.11, duty: 0.075, freight: 0.075 }, multiplier: 1.26, sourceLabel: "Europe, Beauty projects, Gamma+" },
  { id: "eu_liquids", country: "europe", productTypes: ["liquids"], royaltyTypes: "any", components: { tariff: 0.10, duty: 0, freight: 0.075 }, multiplier: 1.18, sourceLabel: "Europe, Liquids HTS 3305.90.000" },
  { id: "vn_any", country: "vietnam", productTypes: "any", royaltyTypes: "any", components: { tariff: 0.20, duty: 0.075, freight: 0.075 }, multiplier: 1.35, sourceLabel: "Vietnam, any" },
  { id: "my_any", country: "malaysia", productTypes: "any", royaltyTypes: "any", components: { tariff: 0.19, duty: 0.075, freight: 0.075 }, multiplier: 1.34, sourceLabel: "Malaysia, any" },
  { id: "kh_beauty_tools", country: "cambodia", productTypes: ["styling_tools_shavers"], royaltyTypes: "any", components: { tariff: 0.19, duty: 0.075, freight: 0.075 }, multiplier: 1.34, sourceLabel: "Cambodia, Beauty tools" },
  { id: "in_any", country: "india", productTypes: "any", royaltyTypes: "any", multiplier: 1.50, sourceLabel: "India, any" },
  { id: "id_any", country: "indonesia", productTypes: "any", royaltyTypes: "any", multiplier: 1.19, sourceLabel: "Indonesia, any" },
  { id: "th_any", country: "thailand", productTypes: "any", royaltyTypes: "any", multiplier: 1.19, sourceLabel: "Thailand, any" },
  { id: "kr_any", country: "south_korea", productTypes: "any", royaltyTypes: "any", multiplier: 1.15, sourceLabel: "South Korea, any" },
];

// Royalty metadata — documentation only, does NOT drive resolution (the
// form's Royalty Type selection above remains the sole input to
// getMultiplier). Recorded here per the tariff chart's own royalty notes:
// Gamma+ royalties are built in at 5% (shared-mold Barber projects) or 10%
// (non-shared / the XCell line), and the chart calls out these known SKU
// examples for each rate.
export const ROYALTY_SKU_NOTES: Record<"gamma_shared_5" | "gamma_nonshared_10", { label: string; exampleSkus: string[] }> = {
  gamma_shared_5: {
    label: "Gamma+ shared Barber projects — 5% royalty built in",
    exampleSkus: ["GP803B XCell Shaver", "GP609B XCell Clipper", "GP418B XCell Trimmer"],
  },
  gamma_nonshared_10: {
    label: "Gamma+ non-shared / XCell line — 10% royalty built in",
    exampleSkus: ["GP103G Xcell Horizon Hair Dryer", "GPXCell black/red dryers"],
  },
};

// Sanity check, run once at module load — catches transcription errors now
// and on every future chart update: for any row that stores a component
// breakdown, 1 + tariff + duty + freight + royalty + other must equal the
// stored multiplier within ±0.005. That tolerance isn't slack for OUR
// transcription — it's required because the source chart's own "Total
// Markup" column is itself pre-rounded per row (e.g. China Clippers &
// trimmers, Gamma+ 10%: 1 + .38 + .04 + .075 + .10 = 1.595 exactly, but the
// chart states "59%" / 1.59 — a real rounding in the source spreadsheet,
// not a bug here). A row with no `components` (India/Indonesia/Thailand/
// South Korea — chart gives no breakdown) is skipped entirely.
const TARIFF_SANITY_TOLERANCE = 0.0051;
for (const row of TARIFF_TABLE) {
  if (!row.components) continue;
  const { tariff = 0, duty = 0, freight = 0, royalty = 0, other = 0 } = row.components;
  const computed = 1 + tariff + duty + freight + royalty + other;
  const diff = Math.abs(computed - row.multiplier);
  if (diff > TARIFF_SANITY_TOLERANCE) {
    throw new Error(
      `Tariff table sanity check failed for row "${row.id}" (${row.sourceLabel}): component breakdown sums to ` +
      `${computed.toFixed(4)}x but the stored multiplier is ${row.multiplier}x (difference ${diff.toFixed(4)} exceeds the ±${TARIFF_SANITY_TOLERANCE} tolerance).`
    );
  }
}

function matches(scope: unknown[] | "any", value: string): boolean {
  return scope === "any" || (Array.isArray(scope) && scope.includes(value as never));
}

// Specificity score — lower is more specific. A row scoped to a real list on
// BOTH dimensions beats a row that's "any" on one or both. This is what
// resolves the one intentional overlap in the table (Europe + Liquids +
// Gamma+ matches both "eu_liquids" [specific product type] and
// "eu_beauty_gamma" [specific royalty type, any product type] — the
// product-type-specific row wins, matching the spec's own more-specific
// "Liquids HTS 3305.90" line taking precedence over the general "Beauty
// projects" line).
// Weighted, not a flat count: a row scoped to a specific PRODUCT TYPE
// outranks a row scoped to a specific ROYALTY TYPE when both would
// otherwise tie (e.g. Europe+Liquids+Gamma+ matches both "eu_liquids"
// [specific product type, any royalty] and "eu_beauty_gamma" [any product
// type, specific royalty] — a flat tie-count can't tell these apart, and
// resolving it by array/insertion order would make the answer depend on
// how the table happens to be written rather than on the table's actual
// meaning). Product type is the more semantically decisive dimension here
// — "Liquids get their own tariff treatment" should win over "Beauty
// projects get 1.30 with Gamma+" regardless of where each row sits in the
// list.
function specificity(row: TariffRow): number {
  return (row.productTypes === "any" ? 10 : 0) + (row.royaltyTypes === "any" ? 1 : 0);
}

export interface MultiplierResult {
  multiplier: number | null;
  error: string | null;
  matchedRow: string | null; // sourceLabel of the row that resolved, for audit/display
}

export function getMultiplier(country: Country, productType: ProductType, royaltyType: RoyaltyType): MultiplierResult {
  const candidates = TARIFF_TABLE.filter(
    row => row.country === country && matches(row.productTypes, productType) && matches(row.royaltyTypes, royaltyType)
  );

  if (candidates.length === 0) {
    return { multiplier: null, error: NO_MULTIPLIER_MESSAGE, matchedRow: null };
  }

  const best = [...candidates].sort((a, b) => specificity(a) - specificity(b))[0];
  return { multiplier: best.multiplier, error: null, matchedRow: best.sourceLabel };
}
