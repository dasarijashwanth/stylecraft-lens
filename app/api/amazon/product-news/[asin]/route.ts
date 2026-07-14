import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { findProductNews, ProductNewsResult } from "@/lib/product-news";
import { resolveCacheKey } from "@/lib/product-cache-key";

export const maxDuration = 45;

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
  const cacheKey = resolveCacheKey(isRealAsin ? rawAsin : "", productName);

  try {
    if (!forceRefresh) {
      const cached = await getCachedNews(cacheKey);
      if (cached) {
        return NextResponse.json({ ...cached.result, retrievedAt: cached.fetchedAt, cached: true });
      }
    }

    const result = await findProductNews(productName, brand);

    if (!result.aiUnavailable) {
      await setCachedNews(cacheKey, result);
    }

    return NextResponse.json({ ...result, retrievedAt: new Date().toISOString(), cached: false });
  } catch (err: any) {
    return NextResponse.json({ error: "Live news search unavailable — retry" }, { status: 503 });
  }
}
