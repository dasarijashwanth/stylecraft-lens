// lib/build-overview-paragraph.ts

import { MarketData } from "./market-data";

export interface CompetitorSummary {
  name: string;
  price: string | null;
  tier: "legacy" | "emerging";
  asin: string | null;
}

export interface ParagraphInput {
  productName: string;
  motorTech: string;
  pricePoint: string;
  targetMarket: string;
  industry: string;
  marketData: MarketData;
  competitors: CompetitorSummary[];
}

// ── Motor-specific sentences (written by us, not the AI model) ───────────────
const MOTOR_SENTENCES: Record<string, string> = {
  "eon": "EON Digital Brushless motors represent StyleCraft's flagship proprietary technology — Modern Barber Supply (2026) ranks StyleCraft among the top three professional clippers for 2026 alongside JRL Onyx, with brushless motors praised for running cooler and delivering consistent power over extended shifts.",
  "brushless": "Brushless motors are the 2026 professional standard — Modern Barber Supply describes them as tools that 'run cooler, last longer, and deliver consistent power,' commanding a 30–50% price premium over brushed rotary alternatives in the professional tier.",
  "vector": "Vector motors — including the IN2 and similar adaptive-torque designs — deliver 11,000+ RPM with automatic resistance sensing; Barber & Co (2026) notes vector motors 'offer higher torque and cutting speed than standard rotary,' and top influencers like 360 Jeezy have endorsed this motor class as essential for high-volume barbers.",
  "rotary": "Rotary motors are the proven workhorse of professional barbering — used by Andis (7,200 SPM eMERGE, launched Feb 2024) and Wahl's V9000/V5000 series — though Modern Barber Supply (2026) positions them as 'proven reliability' against the newer brushless and vector entrants now dominating top-tier recommendations.",
  "magnetic": "Magnetic/pivot motors offer budget-friendly entry into the professional space but carry a performance caveat: Modern Barber Supply (2026) notes they are 'less powerful on thick hair' compared to brushless or rotary alternatives, making them best suited for lighter volume or consumer use.",
  "c4rbn": "The Super C4RBN motor is a high-performance carbon-composite design engineered for professional duty cycles, positioned in StyleCraft's mid-premium Rebel lineup between the entry ACE and flagship Saber/Instinct tiers.",
  "rechargeable": "Rechargeable consumer motors power the growing home-grooming segment — Accio/Amazon Trends (2025) reports a 20% rise in 'Professional Cordless Hair Clippers & Trimmer Sets' search volume from January to July 2025, with home use accounting for 72.9% of cordless clipper purchases, though professional barbers (65% of whom prioritize motor power, per Professional Barbers Association) distinguish this tier from commercial-grade tools.",
  "linear": "Linear motors — used by Panasonic's ER-GP80 at 10,000 CPM — maintain constant speed regardless of battery level or hair thickness, a key differentiator in the premium hair styling tools segment where Grand View Research (2024) reports cordless models held 65.4% revenue share.",
  "default": "This motor technology competes in a professional clipper market where 65% of barbers rank motor power as their top purchase criterion (Professional Barbers Association), and Amazon Trends data shows a 20% rise in professional clipper search volume from January to July 2025.",
};

function getMotorSentence(motorTech: string): string {
  const lower = (motorTech ?? "").toLowerCase();
  for (const [key, sentence] of Object.entries(MOTOR_SENTENCES)) {
    if (lower.includes(key)) return sentence;
  }
  return MOTOR_SENTENCES["default"];
}

// ── Price positioning sentence ────────────────────────────────────────────────
function buildPriceSentence(
  pricePoint: string,
  competitors: CompetitorSummary[]
): string {
  const ourPrice = parseFloat((pricePoint ?? "").replace(/[^0-9.]/g, ""));
  if (isNaN(ourPrice) || ourPrice <= 0) {
    return "Price positioning will be refined once retail pricing is confirmed against the competitive set.";
  }

  // Get real prices from Rainforest data
  const withPrices = competitors
    .filter(c => {
      const p = parseFloat((c.price ?? "").replace(/[^0-9.]/g, ""));
      return !isNaN(p) && p > 0;
    })
    .map(c => ({
      ...c,
      priceNum: parseFloat((c.price ?? "").replace(/[^0-9.]/g, "")),
    }))
    .sort((a, b) => a.priceNum - b.priceNum);

  if (withPrices.length === 0) {
    return `At ${pricePoint}, this product targets the professional grooming segment where premium tools command $150–$350 and emerging brands compete aggressively at $80–$130.`;
  }

  const floor = withPrices[0];
  const ceiling = withPrices[withPrices.length - 1];

  // Find the 1-2 nearest competitors by price
  const nearest = [...withPrices]
    .sort((a, b) => Math.abs(a.priceNum - ourPrice) - Math.abs(b.priceNum - ourPrice))
    .slice(0, 2);

  // Determine position: below floor / at floor / mid-range / premium / above ceiling
  let positionText: string;

  if (ourPrice <= floor.priceNum) {
    positionText = `At ${pricePoint} — at or below the competitive floor set by ${floor.name} (${floor.price}) — this product targets value-conscious buyers who want professional performance without the premium price tag.`;
  } else if (ourPrice >= ceiling.priceNum) {
    positionText = `At ${pricePoint} — at or above the competitive ceiling set by ${ceiling.name} (${ceiling.price}) — this product must deliver demonstrably superior performance or brand equity to justify the premium over every competitor in the set.`;
  } else {
    const below = withPrices.filter(c => c.priceNum < ourPrice).slice(-1)[0];
    const above = withPrices.filter(c => c.priceNum > ourPrice)[0];

    if (below && above) {
      const gapBelow = (ourPrice - below.priceNum).toFixed(0);
      const gapAbove = (above.priceNum - ourPrice).toFixed(0);
      positionText = `At ${pricePoint} — $${gapBelow} above ${below.name} (${below.price}) and $${gapAbove} below ${above.name} (${above.price}) — this product occupies a mid-tier position where buyers expect premium-adjacent performance without top-shelf pricing.`;
    } else {
      positionText = `At ${pricePoint}, sitting between ${nearest[0]?.name} (${nearest[0]?.price}) and ${nearest[1]?.name ?? "the next tier"} (${nearest[1]?.price ?? "—"}), this product must clearly communicate its value differential to capture switching buyers.`;
    }
  }

  return positionText;
}

// ── Main function: build the full overview paragraph ─────────────────────────
export function buildOverviewParagraph(input: ParagraphInput): string {
  const { motorTech, pricePoint, marketData, competitors } = input;

  // Sentence 1: Market size (always from verified data, always cited)
  const s1 = `The global ${marketData.industry_label} market was valued at ${marketData.market_size_2025} in 2025 and is projected to reach ${marketData.market_size_2026} in 2026, expanding to ${marketData.market_size_forecast} by ${marketData.forecast_year} at a ${marketData.cagr} CAGR (${marketData.source}).`;

  // Sentence 2: Market segment structure fact (from verified data)
  const topSeg = marketData.key_segments?.[0];
  const segText = topSeg ? `${topSeg.label} represent ${topSeg.share} of market activity (${topSeg.note})` : `Commercial and professional use account for the majority of market revenue`;
  const s2 = `${segText}, with continuous growth expanding across key retail and professional channels (${marketData.source}).`;

  // Sentence 3: Motor-specific context (from our hard-coded research map)
  const s3 = getMotorSentence(motorTech);

  // Sentence 4: Price positioning (calculated from real Rainforest data)
  const s4 = buildPriceSentence(pricePoint, competitors);

  return [s1, s2, s3, s4].join(" ");
}
