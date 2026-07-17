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
import { SectionProvenanceData, ProvenanceTier, ProvenanceQuery } from "./section-provenance";

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
  // Persisted, section-level source trail (see lib/section-provenance.ts) —
  // additive/optional so cached pre-existing payloads without it stay valid.
  provenance?: SectionProvenanceData;
}

const MIN_FEATURES_TARGET = 4; // stop cascading once we have "enough" real features
const TIME_BUDGET_MS = 42_000; // this resolver's own route sets maxDuration; leaves headroom for the response itself
const DEDUPE_SIMILARITY_THRESHOLD = 0.6;

interface ExtractResult {
  features: ResolvedFeature[];
  rejectedCount: number;
  rejectedReasons: string[];
}

export async function extractFeaturesFromText(
  productName: string,
  text: string,
  source: FeatureSourceType,
  sourceUrl: string | null,
  sourceTitle: string
): Promise<ExtractResult> {
  if (!text || text.trim().length < 50) {
    return { features: [], rejectedCount: 1, rejectedReasons: [`${sourceTitle || sourceUrl || "page"} — text too short (<50 chars) to extract from`] };
  }
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

  if (!result || !Array.isArray(result.features)) return { features: [], rejectedCount: 0, rejectedReasons: [] };

  const kept = result.features.filter(f => f?.headline && f?.quote && quoteAppearsInText(f.quote, [text]));
  const droppedCount = result.features.length - kept.length;
  return {
    features: kept.map(f => ({
      headline: f.headline,
      detail: f.detail || "",
      source,
      sourceUrl,
      sourceTitle,
      quote: f.quote,
      retrievedAt,
    })),
    rejectedCount: droppedCount,
    rejectedReasons: droppedCount > 0 ? [`${droppedCount} feature(s) dropped from ${sourceTitle || sourceUrl || "page"} — quote not found in fetched text`] : [],
  };
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

  const provenanceTiers: ProvenanceTier[] = [];
  const provenanceQueries: ProvenanceQuery[] = [];

  const overBudget = () => Date.now() - startedAt > TIME_BUDGET_MS;
  const enough = () => features.length >= MIN_FEATURES_TARGET;
  const skipReason = () => (enough() ? "enough features already found" : "time budget exceeded");

  // Tier 1: Amazon — already-fetched, no extra search/scrape needed.
  tiersTried.push("Amazon");
  {
    const tierT0 = Date.now();
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
      provenanceTiers.push({
        tier: "Amazon", attempted: true, outcome: bullets.length > 0 ? "success" : "empty",
        itemCount: bullets.length, sourceUrls: [`https://www.amazon.com/dp/${asin}`], elapsedMs: Date.now() - tierT0,
      });
      provenanceQueries.push({ tier: "Amazon", query: `Amazon listing bullets — ASIN ${asin}`, outcome: bullets.length > 0 ? "success" : "empty", itemCount: bullets.length, verified: true });
    } else {
      provenanceTiers.push({ tier: "Amazon", attempted: false, outcome: "skipped", errorMessage: "no ASIN available" });
    }
  }

  // Tier 2: official brand page. fetchPageText (full cleaned body text) is
  // the primary source, not scrapeProductPage's description meta tag —
  // confirmed live that a short truthy meta description was winning over
  // richer body text under a naive `||`, starving extraction of real
  // content. scrapeProductPage is kept only for a better page title.
  if (!enough() && !overBudget()) {
    tiersTried.push("Brand site");
    const tierT0 = Date.now();
    const query = `"${competitorName}" official product page`;
    const hits = await searchForUrls(query, 2);
    let tierItemCount = 0;
    let tierRejectedCount = 0;
    const tierRejectedReasons: string[] = [];
    const tierUrls: string[] = [];
    for (const hit of hits) {
      if (overBudget()) break;
      const [scraped, pageText] = await Promise.all([scrapeProductPage(hit.url), fetchPageText(hit.url)]);
      const text = pageText || scraped?.description || "";
      const extracted = await extractFeaturesFromText(competitorName, text, "Brand site", hit.url, hit.title || scraped?.title || hit.url);
      if (extracted.features.length) { tiersSucceeded.push("Brand site"); tierUrls.push(hit.url); }
      features.push(...extracted.features);
      tierItemCount += extracted.features.length;
      tierRejectedCount += extracted.rejectedCount;
      tierRejectedReasons.push(...extracted.rejectedReasons);
    }
    provenanceTiers.push({
      tier: "Brand site", attempted: true, outcome: tierItemCount > 0 ? "success" : "empty",
      itemCount: tierItemCount, rejectedCount: tierRejectedCount || undefined,
      rejectedReasons: tierRejectedReasons.length ? tierRejectedReasons : undefined,
      sourceUrls: tierUrls, elapsedMs: Date.now() - tierT0,
    });
    provenanceQueries.push({ tier: "Brand site", query, outcome: tierItemCount > 0 ? "success" : "empty", itemCount: hits.length, elapsedMs: Date.now() - tierT0, verified: true });
  } else {
    provenanceTiers.push({ tier: "Brand site", attempted: false, outcome: "skipped", errorMessage: skipReason() });
  }

  // Tier 3: retailer listings
  if (!enough() && !overBudget()) {
    tiersTried.push("Retailer");
    const tierT0 = Date.now();
    const query = `"${competitorName}" buy`;
    const hits = await searchForUrls(query, 2);
    let tierItemCount = 0;
    let tierRejectedCount = 0;
    const tierRejectedReasons: string[] = [];
    const tierUrls: string[] = [];
    for (const hit of hits) {
      if (overBudget()) break;
      const [scraped, pageText] = await Promise.all([scrapeProductPage(hit.url), fetchPageText(hit.url)]);
      const text = pageText || scraped?.description || "";
      const extracted = await extractFeaturesFromText(competitorName, text, "Retailer", hit.url, hit.title || scraped?.title || hit.url);
      if (extracted.features.length) { tiersSucceeded.push("Retailer"); tierUrls.push(hit.url); }
      features.push(...extracted.features);
      tierItemCount += extracted.features.length;
      tierRejectedCount += extracted.rejectedCount;
      tierRejectedReasons.push(...extracted.rejectedReasons);
    }
    provenanceTiers.push({
      tier: "Retailer", attempted: true, outcome: tierItemCount > 0 ? "success" : "empty",
      itemCount: tierItemCount, rejectedCount: tierRejectedCount || undefined,
      rejectedReasons: tierRejectedReasons.length ? tierRejectedReasons : undefined,
      sourceUrls: tierUrls, elapsedMs: Date.now() - tierT0,
    });
    provenanceQueries.push({ tier: "Retailer", query, outcome: tierItemCount > 0 ? "success" : "empty", itemCount: hits.length, elapsedMs: Date.now() - tierT0, verified: true });
  } else {
    provenanceTiers.push({ tier: "Retailer", attempted: false, outcome: "skipped", errorMessage: skipReason() });
  }

  // Tier 4: expert reviews
  if (!enough() && !overBudget()) {
    tiersTried.push("Expert review");
    const tierT0 = Date.now();
    const query = `"${competitorName}" review`;
    const hits = await searchForUrls(query, 2);
    let tierItemCount = 0;
    let tierRejectedCount = 0;
    const tierRejectedReasons: string[] = [];
    const tierUrls: string[] = [];
    for (const hit of hits) {
      if (overBudget()) break;
      const text = await fetchPageText(hit.url);
      if (!text) { tierRejectedCount++; tierRejectedReasons.push(`${hit.title || hit.url} — page text unavailable`); continue; }
      const extracted = await extractFeaturesFromText(competitorName, text, "Expert review", hit.url, hit.title || hit.url);
      if (extracted.features.length) { tiersSucceeded.push("Expert review"); tierUrls.push(hit.url); }
      features.push(...extracted.features);
      tierItemCount += extracted.features.length;
      tierRejectedCount += extracted.rejectedCount;
      tierRejectedReasons.push(...extracted.rejectedReasons);
    }
    provenanceTiers.push({
      tier: "Expert review", attempted: true, outcome: tierItemCount > 0 ? "success" : "empty",
      itemCount: tierItemCount, rejectedCount: tierRejectedCount || undefined,
      rejectedReasons: tierRejectedReasons.length ? tierRejectedReasons : undefined,
      sourceUrls: tierUrls, elapsedMs: Date.now() - tierT0,
    });
    provenanceQueries.push({ tier: "Expert review", query, outcome: tierItemCount > 0 ? "success" : "empty", itemCount: hits.length, elapsedMs: Date.now() - tierT0, verified: true });
  } else {
    provenanceTiers.push({ tier: "Expert review", attempted: false, outcome: "skipped", errorMessage: skipReason() });
  }

  features = dedupeFeatures(features);

  return {
    features,
    tiersTried: Array.from(new Set(tiersTried)),
    tiersSucceeded: Array.from(new Set(tiersSucceeded)),
    searchedAt,
    provenance: { tiers: provenanceTiers, queries: provenanceQueries },
  };
}
