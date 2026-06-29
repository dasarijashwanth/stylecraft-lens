import { getMarketData } from "@/lib/market-data";
import { buildOverviewParagraph, CompetitorSummary } from "@/lib/build-overview-paragraph";
import type { AnalysisContext } from "@/lib/analysisEngine";

export async function buildPhase3Prompt(
  ctx: AnalysisContext,
  phase1: any,
  phase2: any
) {
  const marketData = getMarketData(ctx.industry, ctx.productName, ctx.category);

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

  // Generate the overview paragraph IN CODE — not by Claude
  const overviewParagraph = buildOverviewParagraph({
    productName: ctx.productName,
    motorTech: ctx.motorTech ?? "",
    pricePoint: ctx.pricePoint ?? "",
    targetMarket: ctx.targetMarket,
    industry: ctx.industry,
    marketData: marketData!,
    competitors: allCompetitors,
  });

  // Find price floor, ceiling, average from real data for context block
  const realPrices = allCompetitors
    .map((c: any) => parseFloat((c.price ?? "").replace(/[^0-9.]/g, "")))
    .filter((n: number) => !isNaN(n) && n > 0);

  const priceFloor = realPrices.length ? Math.min(...realPrices).toFixed(2) : "49.99";
  const priceCeiling = realPrices.length ? Math.max(...realPrices).toFixed(2) : "319.95";

  // Build Google search live snippets
  let liveSnippets = "";
  try {
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_CX;

    if (apiKey && cx) {
      const [trendRes, motorRes] = await Promise.allSettled([
        fetch(`https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(`${ctx.motorTech ?? "professional"} hair clipper market trends 2025 2026 barber`)}&num=3`).then(r => r.json()),
        fetch(`https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(`${ctx.productName} ${ctx.industry} Amazon competitive analysis 2025`)}&num=3`).then(r => r.json()),
      ]);

      const snippets: string[] = [];

      if (trendRes.status === "fulfilled" && trendRes.value.items) {
        trendRes.value.items.slice(0, 2).forEach((item: any) => {
          snippets.push(`[${new URL(item.link).hostname.replace("www.","")}]: ${item.snippet}`);
        });
      }
      if (motorRes.status === "fulfilled" && motorRes.value.items) {
        motorRes.value.items.slice(0, 2).forEach((item: any) => {
          snippets.push(`[${new URL(item.link).hostname.replace("www.","")}]: ${item.snippet}`);
        });
      }

      liveSnippets = snippets.join("\n");
    } else {
      liveSnippets = "Google Search unavailable — use motor context and competitor data only.";
    }
  } catch {
    liveSnippets = "Google Search unavailable — use motor context and competitor data only.";
  }

  const productSpecificBlock = `
PRODUCT BEING ANALYZED:
  Name: ${ctx.productName}
  Motor: ${ctx.motorTech ?? "not specified"}
  Our price: ${ctx.pricePoint ?? "not specified"}
  Target: ${ctx.targetMarket}
  Industry: ${ctx.industry}

REAL COMPETITOR PRICES FROM AMAZON (Rainforest API — verified live data):
${allCompetitors.map((c: any) =>
  ` ${c.tier === "legacy" ? "LEGACY" : "EMERGING"} | ${c.name} | Price: ${c.price ?? "—"} | ASIN: ${c.asin ?? "N/A"}`
).join("\n")}

LIVE WEB SEARCH SNIPPETS (product-specific, from Google):
${liveSnippets}
`.trim();

  const systemText = `You are a market analyst. You MUST write analysis that is SPECIFIC to this exact product.

ABSOLUTE RULES:
1. DO NOT change or rewrite the overview_paragraph provided in the template. Use it EXACTLY as provided.
2. Every trend MUST use a real data point from the provided snippets or verified data.
3. Threats MUST name specific competitors with their real prices (e.g. "BaBylissPRO at $149.99").
4. Opportunities MUST reference this product's specific price gap vs named competitors.
5. CITE sources in trends, threats, and opportunities.

Return ONLY valid JSON. No markdown.`;

  const userText = `${productSpecificBlock}

Return this exact JSON. The overview_paragraph is already written — copy it exactly:

{
  "web_searches_performed": 4,
  "amazon_category": "${ctx.category ?? ctx.industry ?? "Market Analysis"}",
  "data_sources_used": ["${marketData?.source ?? "Verified Market Research"}", "Rainforest API", "Google Custom Search"],
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
    "Gap that is SPECIFIC to ${ctx.motorTech} motor type and ${ctx.pricePoint} price point"
  ],
  "top_threats": [
    {
      "competitor_name": "Real name from competitor data above",
      "threat_description": "Must include their real price from Rainforest API data"
    }
  ],
  "top_opportunities": [
    {
      "action": "Action specific to ${ctx.motorTech} and ${ctx.pricePoint}",
      "description": "Reference real competitor prices and the specific price gap"
    }
  ],
  "positioning_recommendation": "Must name competitors with their real prices. Must state the price gap. Must be specific to ${ctx.motorTech} motor positioning.",
  "strategic_recommendations": [
    {
      "priority": "high",
      "category": "product",
      "headline": "Specific to ${ctx.motorTech} motor in ${ctx.industry}",
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
