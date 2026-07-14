// Shared cache-check + resolve body for Strengths/Weaknesses/Recent
// Sentiment, extracted out of app/api/amazon/reviews-analysis/[asin]/
// route.ts so the same logic runs for a direct route hit (manual refresh)
// and an Inngest phase4 task (lib/inngest/functions/analyze-product.ts).
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { getAmazonProduct } from "@/lib/rainforest";
import { analyzeReviews, ReviewAnalysis } from "@/lib/amazon-review-analysis";

const REVIEWS_ANALYSIS_TTL_MS = 24 * 60 * 60 * 1000;

async function getCachedAnalysis(cacheKey: string): Promise<{ analysis: ReviewAnalysis; fetchedAt: string } | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabaseAdmin
    .from("amazon_cache")
    .select("payload, fetched_at")
    .eq("asin", cacheKey)
    .eq("cache_type", "reviews_analysis")
    .maybeSingle();

  if (data && Date.now() - new Date(data.fetched_at).getTime() < REVIEWS_ANALYSIS_TTL_MS) {
    return { analysis: data.payload as ReviewAnalysis, fetchedAt: data.fetched_at };
  }
  return null;
}

async function setCachedAnalysis(cacheKey: string, analysis: ReviewAnalysis) {
  if (!isSupabaseConfigured) return;
  try {
    await supabaseAdmin
      .from("amazon_cache")
      .upsert(
        { asin: cacheKey, cache_type: "reviews_analysis", payload: analysis, fetched_at: new Date().toISOString() },
        { onConflict: "asin,cache_type" }
      );
  } catch (e) {
    console.warn("Failed to cache review analysis:", e);
  }
}

export async function resolveReviewsCached(
  cacheKey: string,
  asin: string | null,
  productName: string | null,
  forceRefresh = false
): Promise<{ analysis: ReviewAnalysis; retrievedAt: string; cached: boolean }> {
  if (!forceRefresh) {
    const cached = await getCachedAnalysis(cacheKey);
    if (cached) return { analysis: cached.analysis, retrievedAt: cached.fetchedAt, cached: true };
  }

  const product = asin ? await getAmazonProduct(asin) : null;
  const analysis = await analyzeReviews(asin || "", productName || product?.title || asin || "this product");

  // Don't cache an "AI unavailable" result for 24h — that's a transient
  // provider outage, not a real answer, and should be retried freely.
  if (!analysis.aiUnavailable) {
    await setCachedAnalysis(cacheKey, analysis);
  }

  return { analysis, retrievedAt: new Date().toISOString(), cached: false };
}
