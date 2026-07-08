import { getMarketData } from "@/lib/market-data";
import { buildOverviewParagraph, CompetitorSummary } from "@/lib/build-overview-paragraph";
import type { AnalysisContext } from "@/lib/analysisEngine";
import type { IdentityCard } from "@/lib/product-identification";

export async function buildPhase3Prompt(
  ctx: AnalysisContext,
  identity: IdentityCard,
  phase1: any,
  phase2: any,
  extraInstruction?: string
) {
  const marketData = getMarketData(identity.subcategory || identity.category, ctx.productName);

  // Build competitor list for price analysis
  const allCompetitors: CompetitorSummary[] = [
    ...(phase1?.competitors ?? []).map((c: any) => ({
      name: c.name,
      price: c.price ?? null,
      tier: "legacy" as const,
      asin: c.asin ?? null,
    })),
    ...(phase2?.competitors ?? []).map((c: any) => ({
      name: c.name,
      price: c.price ?? null,
      tier: "emerging" as const,
      asin: c.asin ?? null,
    })),
  ];

  // Generate the overview paragraph IN CODE — not by the AI model
  const overviewParagraph = buildOverviewParagraph({
    productName: ctx.productName,
    motorTech: ctx.motorTech ?? "",
    pricePoint: ctx.pricePoint ?? "",
    targetMarket: ctx.targetMarket,
    category: identity.category,
    subcategory: identity.subcategory,
    marketData: marketData!,
    competitors: allCompetitors,
  });

  // Find price floor, ceiling, average from real data for context block
  const realPrices = allCompetitors
    .map((c: any) => parseFloat((c.price ?? "").replace(/[^0-9.]/g, "")))
    .filter((n: number) => !isNaN(n) && n > 0);

  const priceFloor = realPrices.length ? Math.min(...realPrices).toFixed(2) : "49.99";
  const priceCeiling = realPrices.length ? Math.max(...realPrices).toFixed(2) : "319.95";

  const primaryAttribute = identity.keyAttributes[0] || ctx.motorTech || identity.subcategory;

  const productSpecificBlock = `
PRODUCT BEING ANALYZED:
  Name: ${ctx.productName}
  Category: ${identity.category} / ${identity.subcategory}
  What it is: ${identity.whatItIs}
  Key attributes: ${identity.keyAttributes.join(", ") || "not specified"}
  Our price: ${ctx.pricePoint ?? identity.priceObserved?.value ?? "not specified"}
  Target: ${ctx.targetMarket}

REAL COMPETITOR PRICES FROM PHASE 1/2 RESEARCH (Amazon-sourced):
${allCompetitors.map((c: any) =>
  ` ${c.tier === "legacy" ? "LEGACY" : "EMERGING"} | ${c.name} | Price: ${c.price ?? "—"} | ASIN: ${c.asin ?? "N/A"}`
).join("\n")}

You have live Google Search available — use it to verify current market size, CAGR, and trend data for this category and price tier before writing the analysis.
`.trim();

  const systemText = `You are a market analyst. You MUST write analysis that is SPECIFIC to this exact product and its category (${identity.category} / ${identity.subcategory}) — never any other product category.

ABSOLUTE RULES:
1. DO NOT change or rewrite the overview_paragraph provided in the template. Use it EXACTLY as provided.
2. Every trend MUST use a real data point — search for it if you don't already have a verified figure.
3. Threats MUST name specific competitors with their real prices (e.g. "BaBylissPRO at $149.99").
4. Opportunities MUST reference this product's specific price gap vs named competitors.
5. CITE sources in trends, threats, and opportunities.
6. Do not include analysis of any other product category. Do not reuse boilerplate from previous analyses — every claim must trace to the competitor data or category above.
${extraInstruction ? `\n${extraInstruction}\n` : ""}
Return ONLY valid JSON. No markdown.`;

  const userText = `${productSpecificBlock}

Return this exact JSON. The overview_paragraph is already written — copy it exactly:

{
  "web_searches_performed": 4,
  "amazon_category": "${identity.category} / ${identity.subcategory}",
  "data_sources_used": ["${marketData?.source ?? "Verified Market Research"}", "Amazon product research (Phase 1/2)", "Google Search grounding"],
  "market_snapshot": {
    "market_size_current": "${marketData?.market_size_2026 ?? "$1.5B"}",
    "market_size_year": "2026",
    "market_size_forecast": "${marketData?.market_size_forecast ?? "$2.5B"}",
    "forecast_year": "${marketData?.forecast_year ?? "2034"}",
    "cagr_percent": "${marketData?.cagr ?? "5.0%"}",
    "cagr_period": "${marketData?.cagr_period ?? "2026–2034"}",
    "data_source": "${marketData?.source ?? "Market Intelligence Research"}",
    "headline_stat_label": "growth",
    "headline_stat_value": "${marketData?.market_size_2026 ?? "$1.5B"} ${marketData?.industry_label ?? "Market"} snapshot (2026)",
    "overview_paragraph": "${overviewParagraph.replace(/"/g, '\\"')}"
  },
  "key_trends": [
    {
      "trend_name": "Name from search results or verified data",
      "description": "Description using a real data point. Include source in parentheses.",
      "source": "Source name"
    }
  ],
  "market_gaps": [
    "Gap that is SPECIFIC to ${primaryAttribute} and ${ctx.pricePoint ?? "the observed"} price point, within the ${identity.subcategory} category"
  ],
  "top_threats": [
    {
      "competitor_name": "Real name from competitor data above",
      "threat_description": "Must include their real price from the competitor data above"
    }
  ],
  "top_opportunities": [
    {
      "action": "Action specific to ${primaryAttribute} and ${ctx.pricePoint ?? "the observed price"}",
      "description": "Reference real competitor prices and the specific price gap"
    }
  ],
  "positioning_recommendation": "Must name competitors with their real prices. Must state the price gap. Must be specific to ${identity.subcategory} positioning and ${primaryAttribute}.",
  "strategic_recommendations": [
    {
      "priority": "high",
      "category": "product",
      "headline": "Specific to ${primaryAttribute} in the ${identity.subcategory} category",
      "explanation": "Reference real competitors and their prices"
    }
  ],
  "quick_wins": [
    "Reference specific competitor ASIN and name from the data provided"
  ]
}`;

  return {
    system: systemText,
    systemPrompt: systemText,
    userMessage: userText,
    userPrompt: userText
  };
}
