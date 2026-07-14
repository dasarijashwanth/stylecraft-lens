// Multi-tier Key Features resolver — Amazon is one source, not the only
// one. Falls through to the official brand page, then retailer listings,
// then expert reviews, so a product with no Amazon presence (or a sparse
// listing) still gets real, cited features instead of "no data available".
//
// Every extracted feature is verified against the ACTUAL fetched text
// (never trusted from the model's own say-so) — same independent
// verification pattern as lib/citations.ts/lib/amazon-review-analysis.ts.
import { getAmazonProduct } from "./rainforest";
import { scrapeProductPage } from "./scrape";
import { searchForUrls } from "./web-search";
import { callOpenAiForJson } from "./openai";
import { fetchPageText, quoteAppearsInText } from "./citations";
import { textSimilarity } from "./text-similarity";

export type FeatureSourceType = "Amazon" | "Brand site" | "Retailer" | "Expert review";

export interface ResolvedFeature {
  headline: string;
  detail: string;
  source: FeatureSourceType;
  sourceUrl: string | null;
  sourceTitle: string;
  quote: string;
  retrievedAt: string;
}

export interface KeyFeaturesResult {
  features: ResolvedFeature[];
  tiersTried: FeatureSourceType[];
  tiersSucceeded: FeatureSourceType[];
  searchedAt: string;
}

const MIN_FEATURES_TARGET = 4; // stop cascading once we have "enough" real features
const TIME_BUDGET_MS = 42_000; // this resolver's own route sets maxDuration; leaves headroom for the response itself
const DEDUPE_SIMILARITY_THRESHOLD = 0.6;

async function extractFeaturesFromText(
  productName: string,
  text: string,
  source: FeatureSourceType,
  sourceUrl: string | null,
  sourceTitle: string
): Promise<ResolvedFeature[]> {
  if (!text || text.trim().length < 50) return [];
  // Real article/product content is often preceded by several thousand
  // characters of nav/membership/ad boilerplate — a small window reliably
  // missed it in testing (confirmed against live retailer/review pages).
  const truncated = text.slice(0, 20_000);
  const retrievedAt = new Date().toISOString();

  const result = await callOpenAiForJson<{ features: { headline: string; detail: string; quote: string }[] }>(
    `Extract the key features/specifications of "${productName}" from the text below. Using ONLY this text — no outside knowledge, no guessing. Each feature needs a short headline (a few words), a 1-sentence detail, and a verbatim quote fragment from the text that supports it. If this text is not really about this exact product, return an empty list.

Return ONLY valid JSON: { "features": [{ "headline": "...", "detail": "...", "quote": "..." }] }`,
    `Text:\n${truncated}`,
    `key features (${source})`,
    { timeoutMs: 35_000 }
  );

  if (!result || !Array.isArray(result.features)) return [];
  return result.features
    .filter(f => f?.headline && f?.quote && quoteAppearsInText(f.quote, [text]))
    .map(f => ({
      headline: f.headline,
      detail: f.detail || "",
      source,
      sourceUrl,
      sourceTitle,
      quote: f.quote,
      retrievedAt,
    }));
}

function dedupeFeatures(features: ResolvedFeature[]): ResolvedFeature[] {
  const kept: ResolvedFeature[] = [];
  for (const f of features) {
    const isDupe = kept.some(k => textSimilarity(k.headline, f.headline) > DEDUPE_SIMILARITY_THRESHOLD);
    if (!isDupe) kept.push(f);
  }
  return kept;
}

export async function resolveKeyFeatures(competitorName: string, asin: string | null): Promise<KeyFeaturesResult> {
  const startedAt = Date.now();
  const searchedAt = new Date().toISOString();
  const tiersTried: FeatureSourceType[] = [];
  const tiersSucceeded: FeatureSourceType[] = [];
  let features: ResolvedFeature[] = [];

  const overBudget = () => Date.now() - startedAt > TIME_BUDGET_MS;
  const enough = () => features.length >= MIN_FEATURES_TARGET;

  // Tier 1: Amazon — already-fetched, no extra search/scrape needed.
  tiersTried.push("Amazon");
  if (asin) {
    const product = await getAmazonProduct(asin);
    const bullets: string[] = (product as any)?.feature_bullets || [];
    if (bullets.length > 0) {
      tiersSucceeded.push("Amazon");
      const retrievedAt = new Date().toISOString();
      for (const bullet of bullets.slice(0, 6)) {
        features.push({
          headline: bullet.length > 70 ? `${bullet.slice(0, 70)}…` : bullet,
          detail: bullet,
          source: "Amazon",
          sourceUrl: `https://www.amazon.com/dp/${asin}`,
          sourceTitle: "Amazon product listing",
          quote: bullet,
          retrievedAt,
        });
      }
    }
  }

  // Tier 2: official brand page. fetchPageText (full cleaned body text) is
  // the primary source, not scrapeProductPage's description meta tag —
  // confirmed live that a short truthy meta description was winning over
  // richer body text under a naive `||`, starving extraction of real
  // content. scrapeProductPage is kept only for a better page title.
  if (!enough() && !overBudget()) {
    tiersTried.push("Brand site");
    const hits = await searchForUrls(`"${competitorName}" official product page`, 2);
    for (const hit of hits) {
      if (overBudget()) break;
      const [scraped, pageText] = await Promise.all([scrapeProductPage(hit.url), fetchPageText(hit.url)]);
      const text = pageText || scraped?.description || "";
      const extracted = await extractFeaturesFromText(competitorName, text, "Brand site", hit.url, hit.title || scraped?.title || hit.url);
      if (extracted.length) tiersSucceeded.push("Brand site");
      features.push(...extracted);
    }
  }

  // Tier 3: retailer listings
  if (!enough() && !overBudget()) {
    tiersTried.push("Retailer");
    const hits = await searchForUrls(`"${competitorName}" buy`, 2);
    for (const hit of hits) {
      if (overBudget()) break;
      const [scraped, pageText] = await Promise.all([scrapeProductPage(hit.url), fetchPageText(hit.url)]);
      const text = pageText || scraped?.description || "";
      const extracted = await extractFeaturesFromText(competitorName, text, "Retailer", hit.url, hit.title || scraped?.title || hit.url);
      if (extracted.length) tiersSucceeded.push("Retailer");
      features.push(...extracted);
    }
  }

  // Tier 4: expert reviews
  if (!enough() && !overBudget()) {
    tiersTried.push("Expert review");
    const hits = await searchForUrls(`"${competitorName}" review`, 2);
    for (const hit of hits) {
      if (overBudget()) break;
      const text = await fetchPageText(hit.url);
      if (!text) continue;
      const extracted = await extractFeaturesFromText(competitorName, text, "Expert review", hit.url, hit.title || hit.url);
      if (extracted.length) tiersSucceeded.push("Expert review");
      features.push(...extracted);
    }
  }

  features = dedupeFeatures(features);

  return {
    features,
    tiersTried: Array.from(new Set(tiersTried)),
    tiersSucceeded: Array.from(new Set(tiersSucceeded)),
    searchedAt,
  };
}
