import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { getAmazonProduct } from "@/lib/rainforest";
import { analyzeReviews, maskSentimentForResponse, ReviewAnalysis } from "@/lib/amazon-review-analysis";
import { resolveCacheKey } from "@/lib/product-cache-key";
import { insertProvenance } from "@/lib/db/section-provenance";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis } from "@/lib/db/analyses";
import { isBuyerSentimentEnabled } from "@/lib/feature-flags";
import { checkRateLimit } from "@/lib/rate-limit";
import type { ToolType } from "@/lib/tool-type-taxonomy";

// Best-effort — analysisId is already threaded into this route for
// provenance; reused here to look up the analysis's strict tool type
// (lib/tool-type-taxonomy.ts) with zero new client-side plumbing, so a
// trimmer analysis's Tier C web-review search can reject an article
// that's actually about the brand's clipper. Returns null (never blocks)
// if analysisId is absent or the analysis has no resolved toolType yet.
async function resolveAnalysisToolType(analysisId: string | null): Promise<ToolType | null> {
  if (!analysisId) return null;
  try {
    const analysis = await getAnalysis(analysisId);
    return (analysis?.phase0_result?.toolType as ToolType) || null;
  } catch {
    return null;
  }
}

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
  const analysisId = req.nextUrl.searchParams.get("analysisId") || null;
  const cacheKey = resolveCacheKey(isRealAsin ? rawAsin : "", productName || rawAsin || "product");

  try {
    // No per-user ownership concept on this shared, ASIN-keyed cache —
    // middleware.ts already blocks anonymous /api/** requests; this is
    // defense-in-depth consistency with the rest of the codebase.
    const session = await getAuthSession();

    // Security audit fix — ?refresh=true bypasses the 24h cache and forces
    // a fresh, credit-costing Rainforest+AI resolution; was previously
    // unrated, letting any authenticated user loop over ASINs to burn
    // real spend essentially unbounded. Normal cached reads (no refresh)
    // stay unrated since they're cheap and already TTL-bounded.
    if (forceRefresh) {
      const rateLimit = await checkRateLimit({ eventType: "reviews_refresh", userId: session.userId, maxAttempts: 20, windowMinutes: 60 });
      if (rateLimit.limited) {
        return NextResponse.json({ error: "RATE_LIMITED", message: `Too many forced refreshes — please wait ${rateLimit.retryAfterMinutes} minutes and try again.` }, { status: 429 });
      }
    }
    // Read once, applied consistently to both the cache-hit and fresh-
    // compute branches below — masks the response only, never the stored
    // row, so old cached sentiment (from before the flag existed) reappears
    // immediately with zero regeneration if the flag is flipped back on.
    const sentimentOn = await isBuyerSentimentEnabled();

    if (!forceRefresh) {
      const cached = await getCachedAnalysis(cacheKey);
      if (cached) {
        return NextResponse.json({ ...maskSentimentForResponse(cached.analysis, sentimentOn), retrievedAt: cached.fetchedAt, cached: true });
      }
    }

    const product = isRealAsin ? await getAmazonProduct(rawAsin) : null;
    const requiredToolType = await resolveAnalysisToolType(analysisId);
    const analysis = await analyzeReviews(isRealAsin ? rawAsin : "", productName || product?.title || rawAsin || "this product", new Date(), product, requiredToolType, { includeSentiment: sentimentOn });

    // Don't cache an "AI unavailable" or "sources unavailable" result for
    // 24h — both are transient (AI provider outage / Rainforest auth-credit
    // outage), not a real answer, and should be retried freely rather than
    // locking in a false negative for a full day.
    if (!analysis.aiUnavailable && !analysis.sourcesUnavailable) {
      await setCachedAnalysis(cacheKey, analysis);
    }

    // Best-effort — a slow/broken provenance write must never turn a good
    // resolver result into an error response. Only on a genuine fresh
    // resolve (the cache-hit branch above already returns its own stored
    // trail, no new row needed).
    if (analysis.provenance) {
      try {
        await insertProvenance({
          productKey: cacheKey, section: "reviews", analysisId,
          productName: productName || product?.title || rawAsin,
          tiers: analysis.provenance.tiers, queries: analysis.provenance.queries,
        });
      } catch (e) {
        console.warn("Failed to persist reviews provenance:", e);
      }
    }

    return NextResponse.json({ ...maskSentimentForResponse(analysis, sentimentOn), retrievedAt: new Date().toISOString(), cached: false });
  } catch (err: any) {
    return NextResponse.json({ error: "Live review data unavailable — retry" }, { status: 503 });
  }
}
