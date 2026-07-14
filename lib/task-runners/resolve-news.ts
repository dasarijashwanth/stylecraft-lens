// Shared cache-check + resolve body for News Updates, extracted out of
// app/api/amazon/product-news/[asin]/route.ts so the same logic runs for a
// direct route hit (manual refresh) and an Inngest phase4 task
// (lib/inngest/functions/analyze-product.ts).
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { findProductNews, ProductNewsResult } from "@/lib/product-news";

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

export async function resolveNewsCached(
  cacheKey: string,
  productName: string,
  brand: string | null,
  forceRefresh = false
): Promise<{ result: ProductNewsResult; retrievedAt: string; cached: boolean }> {
  if (!forceRefresh) {
    const cached = await getCachedNews(cacheKey);
    if (cached) return { result: cached.result, retrievedAt: cached.fetchedAt, cached: true };
  }

  const result = await findProductNews(productName, brand);
  if (!result.aiUnavailable) {
    await setCachedNews(cacheKey, result);
  }

  return { result, retrievedAt: new Date().toISOString(), cached: false };
}
