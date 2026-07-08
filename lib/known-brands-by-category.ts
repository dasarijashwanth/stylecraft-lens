// Dynamically-selected brand hints for the Phase 1/2 competitor-discovery
// prompts — looked up by the VERIFIED category from Stage 1's Identity
// Card, never applied unconditionally. This replaces the old hardcoded
// "search ONLY these 8 brands" instruction that fired for every analysis
// regardless of what product was actually submitted. Reuses the same real
// brand knowledge already encoded in getCategoryFallbackCompetitors's
// mock data (lib/analysisEngine.ts) rather than inventing a second list.
const KNOWN_BRANDS_BY_CATEGORY: { keys: string[]; brands: string[] }[] = [
  { keys: ["clipper", "trimmer", "barber"], brands: ["Wahl", "Andis", "BaBylissPRO", "JRL", "TPOB", "StyleCraft", "Gamma+", "Coco"] },
  { keys: ["dryer", "blow dryer", "styler", "haircare"], brands: ["Dyson", "BaBylissPRO", "Conair", "Parlux", "Revlon", "Shark", "Zuvi", "Laifen"] },
  { keys: ["straighten", "flat iron", "hair iron"], brands: ["Dyson", "BaBylissPRO", "Conair", "TYMO", "Waverly", "GHD", "T3"] },
  { keys: ["shaver", "razor"], brands: ["Braun", "Philips Norelco", "Panasonic", "Remington", "Andis"] },
];

// Returns a hint list only when the identified category clearly matches a
// known family — otherwise null, meaning the prompt gives no brand hint
// at all and relies purely on the AI's own web search.
export function getKnownBrandsHint(category: string | undefined | null): string[] | null {
  if (!category) return null;
  const key = category.toLowerCase();
  for (const entry of KNOWN_BRANDS_BY_CATEGORY) {
    if (entry.keys.some(k => key.includes(k))) return entry.brands;
  }
  return null;
}
