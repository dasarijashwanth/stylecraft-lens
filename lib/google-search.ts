// lib/google-search.ts

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  source: string; // domain name
}

export interface MarketSearchResults {
  market_size_results: SearchResult[];
  trend_results: SearchResult[];
  competitor_results: SearchResult[];
  news_results: SearchResult[];
}

const BASE = "https://www.googleapis.com/customsearch/v1";

async function googleSearch(query: string, num = 5): Promise<SearchResult[]> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;

  if (!apiKey || !cx) {
    return [];
  }

  try {
    const params = new URLSearchParams({
      key: apiKey,
      cx: cx,
      q: query,
      num: String(Math.min(num, 10)),
    });

    const res = await fetch(`${BASE}?${params.toString()}`, {
      next: { revalidate: 3600 }, // cache 1 hour
    });

    if (!res.ok) {
      console.error(`Google Search API error: ${res.status}`);
      return [];
    }

    const data = await res.json();

    return (data.items ?? []).map((item: any) => ({
      title: item.title ?? "",
      link: item.link ?? "",
      snippet: item.snippet ?? "",
      source: new URL(item.link ?? "https://unknown.com").hostname.replace("www.", ""),
    }));
  } catch (err) {
    console.error("Google Search fetch error:", err);
    return [];
  }
}

// Run all market research queries for a specific product
export async function runMarketResearch(
  productName: string,
  industry: string,
  pricePoint: string,
  motorTech: string
): Promise<MarketSearchResults> {
  // Run 4 targeted searches in parallel
  const [market, trends, competitors, news] = await Promise.allSettled([
    googleSearch(`${industry} professional clipper market size 2025 2026 revenue CAGR billion`, 5),
    googleSearch(`professional barber ${motorTech || ""} clipper trends 2025 2026 technology`, 5),
    googleSearch(`${productName} competitors amazon professional ${industry} ${pricePoint || ""}`, 5),
    googleSearch(`professional hair clipper industry news 2025 2026 emerging brands`, 5),
  ]);

  return {
    market_size_results: market.status === "fulfilled" ? market.value : [],
    trend_results: trends.status === "fulfilled" ? trends.value : [],
    competitor_results: competitors.status === "fulfilled" ? competitors.value : [],
    news_results: news.status === "fulfilled" ? news.value : [],
  };
}

// Format search results for Claude's context
export function formatSearchResultsForClaude(results: MarketSearchResults): string {
  const format = (items: SearchResult[]) =>
    items.length > 0
      ? items.map(r => `SOURCE: ${r.source}\nTITLE: ${r.title}\nSNIPPET: ${r.snippet}\nURL: ${r.link}`).join("\n\n")
      : "No live Google search results available.";

  return `
=== MARKET SIZE & REVENUE DATA (from Google Search) ===
${format(results.market_size_results)}

=== CURRENT TRENDS (from Google Search) ===
${format(results.trend_results)}

=== COMPETITOR LANDSCAPE (from Google Search) ===
${format(results.competitor_results)}

=== INDUSTRY NEWS (from Google Search) ===
${format(results.news_results)}
`.trim();
}
