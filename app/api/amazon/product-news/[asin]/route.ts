import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { findProductNews, ProductNewsResult } from "@/lib/product-news";
import { resolveCacheKey } from "@/lib/product-cache-key";
import { insertProvenance } from "@/lib/db/section-provenance";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis } from "@/lib/db/analyses";
import { isNewsUpdatesEnabled } from "@/lib/feature-flags";
import { logCall } from "@/lib/obs";
import type { ToolType } from "@/lib/tool-type-taxonomy";
import { listToolTypes } from "@/lib/db/tool-types";
import { checkRateLimit } from "@/lib/rate-limit";

// Duplicated deliberately (matches app/api/amazon/reviews-analysis/[asin]/
// route.ts's own copy) rather than sharing a module — a tiny, DB-touching
// helper, same precedent lib/legacy-brand-discovery.ts's own header
// comment sets for small per-file helpers in this codebase.
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
// a real news search can take 30s+ and a hard Vercel kill mid-response
// returns a non-JSON error page instead of this route's own JSON, which
// crashed the client's res.json() call with a raw parse error instead of
// a clean message. Every extra second of real headroom reduces that.
export const maxDuration = 60;

// Mirrors app/api/amazon/reviews-analysis/[asin]/route.ts's cache pattern
// exactly — same amazon_cache table, same 24h TTL, same refresh-bypass
// query param, same aiUnavailable-never-cached rule, same "none" path
// segment for products with no ASIN (see lib/product-cache-key.ts).
const NEWS_TTL_MS = 24 * 60 * 60 * 1000;

async function getCachedNews(cacheKey: string): Promise<{ result: ProductNewsResult; fetchedAt: string } | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabaseAdmin
    .from("amazon_cache")
    .select("payload, fetched_at")
    .eq("asin", cacheKey)
    .eq("cache_type", "product_news")
    .maybeSingle();

  if (data && Date.now() - new Date(data.fetched_at).getTime() < NEWS_TTL_MS) {
    return { result: data.payload as ProductNewsResult, fetchedAt: data.fetched_at };
  }
  return null;
}

async function setCachedNews(cacheKey: string, result: ProductNewsResult) {
  if (!isSupabaseConfigured) return;
  try {
    await supabaseAdmin
      .from("amazon_cache")
      .upsert(
        { asin: cacheKey, cache_type: "product_news", payload: result, fetched_at: new Date().toISOString() },
        { onConflict: "asin,cache_type" }
      );
  } catch (e) {
    console.warn("Failed to cache product news:", e);
  }
}

export async function GET(req: NextRequest, { params }: { params: { asin: string } }) {
  const rawAsin = params.asin?.toUpperCase();
  const isRealAsin = !!rawAsin && /^[A-Z0-9]{10}$/.test(rawAsin);
  if (!isRealAsin && rawAsin !== "NONE") {
    return NextResponse.json({ error: "Invalid ASIN" }, { status: 400 });
  }

  const productName = req.nextUrl.searchParams.get("productName");
  const brand = req.nextUrl.searchParams.get("brand");
  if (!productName) {
    return NextResponse.json({ error: "productName query param is required" }, { status: 400 });
  }

  const forceRefresh = req.nextUrl.searchParams.get("refresh") === "true";
  const analysisId = req.nextUrl.searchParams.get("analysisId") || null;
  const cacheKey = resolveCacheKey(isRealAsin ? rawAsin : "", productName);

  try {
    // No per-user ownership concept on this shared, ASIN-keyed cache —
    // middleware.ts already blocks anonymous /api/** requests; this is
    // defense-in-depth consistency with the rest of the codebase.
    const session = await getAuthSession();

    // Security audit fix — same reasoning as the reviews-analysis sibling
    // route: ?refresh=true bypasses the 24h cache and costs a real OpenAI
    // web_search call.
    if (forceRefresh) {
      const rateLimit = await checkRateLimit({ eventType: "product_news_refresh", userId: session.userId, maxAttempts: 20, windowMinutes: 60 });
      if (rateLimit.limited) {
        return NextResponse.json({ error: "RATE_LIMITED", message: `Too many forced refreshes — please wait ${rateLimit.retryAfterMinutes} minutes and try again.` }, { status: 429 });
      }
    }

    // Defense-in-depth: components/analyze/CompetitorCard.tsx already
    // doesn't call this route at all when the flag is off — this guard
    // only matters for a direct/stale request, and skips the real cost
    // (findProductNews's OpenAI web_search call) entirely rather than
    // fetching and hiding the result.
    if (!(await isNewsUpdatesEnabled())) {
      logCall("review-tier", { op: "news-skip", outcome: "ok", errorMessage: "disabled via feature flag", elapsedMs: 0 });
      return NextResponse.json({ error: "News Updates is currently disabled", disabled: true }, { status: 404 });
    }

    if (!forceRefresh) {
      const cached = await getCachedNews(cacheKey);
      if (cached) {
        return NextResponse.json({ ...cached.result, retrievedAt: cached.fetchedAt, cached: true });
      }
    }

    const requiredToolType = await resolveAnalysisToolType(analysisId);
    const toolTypes = await listToolTypes();
    const result = await findProductNews(productName, brand, toolTypes, new Date(), requiredToolType);

    if (!result.aiUnavailable) {
      await setCachedNews(cacheKey, result);
    }

    if (result.provenance) {
      try {
        await insertProvenance({
          productKey: cacheKey, section: "news", analysisId, productName,
          tiers: result.provenance.tiers, queries: result.provenance.queries,
        });
      } catch (e) {
        console.warn("Failed to persist news provenance:", e);
      }
    }

    return NextResponse.json({ ...result, retrievedAt: new Date().toISOString(), cached: false });
  } catch (err: any) {
    return NextResponse.json({ error: "Live news search unavailable — retry" }, { status: 503 });
  }
}
