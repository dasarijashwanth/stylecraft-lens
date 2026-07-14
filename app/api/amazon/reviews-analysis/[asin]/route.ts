import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { getAmazonProduct } from "@/lib/rainforest";
import { analyzeReviews, ReviewAnalysis } from "@/lib/amazon-review-analysis";
import { resolveCacheKey } from "@/lib/product-cache-key";

// 60s is Vercel Hobby's actual ceiling — was 45s, but confirmed live that
// the multi-tier resolver (Amazon -> expert reviews -> forums) sometimes
// takes right up to that limit, and a hard Vercel kill mid-response
// returns a non-JSON error page instead of this route's own JSON, which
// then crashed the client's res.json() call with a raw parse error
// ("Unexpected token 'A', "An error o"... is not valid JSON") instead of
// a clean message. Every extra second of real headroom here reduces how
// often that happens.
export const maxDuration = 60;

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

// Path segment accepts a real 10-char ASIN OR the literal "none" — a
// product with no Amazon presence at all still needs this route (that's
// the point of the multi-source fallback in lib/amazon-review-analysis.ts),
// keyed instead by a hash of productName (lib/product-cache-key.ts).
export async function GET(req: NextRequest, { params }: { params: { asin: string } }) {
  const rawAsin = params.asin?.toUpperCase();
  const isRealAsin = !!rawAsin && /^[A-Z0-9]{10}$/.test(rawAsin);
  const productName = req.nextUrl.searchParams.get("productName");

  if (!isRealAsin && rawAsin !== "NONE") {
    return NextResponse.json({ error: "Invalid ASIN" }, { status: 400 });
  }
  if (!isRealAsin && !productName) {
    return NextResponse.json({ error: "productName query param is required when no ASIN is available" }, { status: 400 });
  }

  const forceRefresh = req.nextUrl.searchParams.get("refresh") === "true";
  const cacheKey = resolveCacheKey(isRealAsin ? rawAsin : "", productName || rawAsin || "product");

  try {
    if (!forceRefresh) {
      const cached = await getCachedAnalysis(cacheKey);
      if (cached) {
        return NextResponse.json({ ...cached.analysis, retrievedAt: cached.fetchedAt, cached: true });
      }
    }

    const product = isRealAsin ? await getAmazonProduct(rawAsin) : null;
    const analysis = await analyzeReviews(isRealAsin ? rawAsin : "", productName || product?.title || rawAsin || "this product");

    // Don't cache an "AI unavailable" result for 24h — that's a transient
    // provider outage, not a real answer, and should be retried freely.
    if (!analysis.aiUnavailable) {
      await setCachedAnalysis(cacheKey, analysis);
    }

    return NextResponse.json({ ...analysis, retrievedAt: new Date().toISOString(), cached: false });
  } catch (err: any) {
    return NextResponse.json({ error: "Live review data unavailable — retry" }, { status: 503 });
  }
}
