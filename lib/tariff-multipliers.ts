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

interface TariffRow {
  id: string;
  country: Country;
  productTypes: ProductType[] | "any";
  royaltyTypes: RoyaltyType[] | "any";
  multiplier: number;
  sourceLabel: string; // verbatim spec line, for admin-facing display/audit
}

// Order matters only for readability — resolution below is specificity-based,
// not first-match-wins, so row order never silently changes an answer.
export const TARIFF_TABLE: TariffRow[] = [
  { id: "cn_clip_none", country: "china", productTypes: ["clippers_trimmers"], royaltyTypes: ["none"], multiplier: 1.52, sourceLabel: "China, Clippers/trimmers/blades/parts, no brand partner" },
  { id: "cn_style_none", country: "china", productTypes: ["styling_tools_shavers"], royaltyTypes: ["none"], multiplier: 1.34, sourceLabel: "China, Styling tools/nose trimmer/shavers/hair dryers, no brand partner" },
  { id: "cn_clip_shared5", country: "china", productTypes: ["clippers_trimmers"], royaltyTypes: ["gamma_shared_5"], multiplier: 1.57, sourceLabel: "China, Clippers/trimmers/blades, Gamma+ shared barber project (5% royalty)" },
  { id: "cn_clip_nonshared10", country: "china", productTypes: ["clippers_trimmers"], royaltyTypes: ["gamma_nonshared_10"], multiplier: 1.62, sourceLabel: "China, Clippers/trimmers/blades, Gamma+ non-shared (10% royalty)" },
  { id: "cn_style_nonshared10", country: "china", productTypes: ["styling_tools_shavers"], royaltyTypes: ["gamma_nonshared_10"], multiplier: 1.44, sourceLabel: "China, Styling tools/shavers/dryers, Gamma+ (10% royalty)" },
  { id: "cn_aprons", country: "china", productTypes: ["aprons_garments"], royaltyTypes: "any", multiplier: 1.54, sourceLabel: "China, Aprons/capes/garments" },
  { id: "eu_beauty_gamma", country: "europe", productTypes: "any", royaltyTypes: ["gamma_shared_5", "gamma_nonshared_10"], multiplier: 1.30, sourceLabel: "Europe, Beauty projects, Gamma+" },
  { id: "eu_liquids", country: "europe", productTypes: ["liquids"], royaltyTypes: "any", multiplier: 1.18, sourceLabel: "Europe, Liquids HTS 3305.90" },
  { id: "vn_any", country: "vietnam", productTypes: "any", royaltyTypes: "any", multiplier: 1.35, sourceLabel: "Vietnam, any" },
  { id: "my_any", country: "malaysia", productTypes: "any", royaltyTypes: "any", multiplier: 1.34, sourceLabel: "Malaysia, any" },
  { id: "kh_beauty_tools", country: "cambodia", productTypes: ["styling_tools_shavers"], royaltyTypes: "any", multiplier: 1.34, sourceLabel: "Cambodia, Beauty tools" },
  { id: "in_any", country: "india", productTypes: "any", royaltyTypes: "any", multiplier: 1.50, sourceLabel: "India, any" },
  { id: "id_any", country: "indonesia", productTypes: "any", royaltyTypes: "any", multiplier: 1.19, sourceLabel: "Indonesia, any" },
  { id: "th_any", country: "thailand", productTypes: "any", royaltyTypes: "any", multiplier: 1.19, sourceLabel: "Thailand, any" },
  { id: "kr_any", country: "south_korea", productTypes: "any", royaltyTypes: "any", multiplier: 1.15, sourceLabel: "South Korea, any" },
  { id: "cn_parts", country: "china", productTypes: ["parts"], royaltyTypes: "any", multiplier: 1.49, sourceLabel: "China, Parts only" },
];

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
