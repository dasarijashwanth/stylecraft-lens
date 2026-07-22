// Tier-6 "derived" computations for GTM/TDS field generation that aren't a
// direct copy from another already-known source (that's lib/gtm-derive.ts's
// job) — these actually compute something new from already-available data.
// Two gaps found by auditing every one of the 77 GTM field ids against
// gtm-derive.ts's direct-copy `set(...)` calls: good_better_best and
// hair_type had zero derivation at all, 100% AI/web-dependent, which is
// exactly why they were chronically N/A.
import { computeTiers, parsePriceToNumber } from "./pricing-analysis";
import { GtmFieldAnswer } from "./gtm-field-schema";

export interface DerivedAnswer {
  answer: string;
  source: "derived";
}

// Reuses lib/pricing-analysis.ts's own Good/Better/Best tertile-by-price-rank
// math rather than reimplementing it — includes the target price as one more
// row alongside the already-computed competitor prices, then reads off the
// tier that row itself lands in.
export function deriveGoodBetterBest(
  pricingAnalysis: { target_price?: string | null; competitor_prices?: { price_raw: number | null }[] } | null
): DerivedAnswer | null {
  if (!pricingAnalysis?.target_price) return null;
  const targetPriceRaw = parsePriceToNumber(pricingAnalysis.target_price);
  if (targetPriceRaw == null) return null;

  const rows = [{ price_raw: targetPriceRaw }, ...(pricingAnalysis.competitor_prices || [])];
  const tiers = computeTiers(rows);
  const myTier = tiers[0]; // the target price's own row, since it's index 0
  if (!myTier) return null;

  return { answer: myTier, source: "derived" };
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
    pricingAnalysis: { target_price?: string | null; competitor_prices?: { price_raw: number | null }[] } | null;
    hairTypeSourceText: string;
  }
) {
  if (schema.some(f => f.id === "good_better_best") && isUnresolved(fields, "good_better_best")) {
    const derived = deriveGoodBetterBest(input.pricingAnalysis);
    if (derived) fields["good_better_best"] = derived;
  }
  if (schema.some(f => f.id === "hair_type") && isUnresolved(fields, "hair_type")) {
    const derived = inferHairType(input.hairTypeSourceText);
    if (derived) fields["hair_type"] = derived;
  }
}
