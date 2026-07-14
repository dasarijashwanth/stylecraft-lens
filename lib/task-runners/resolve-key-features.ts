// Shared cache-check + resolve body for Key Features, extracted out of
// app/api/product-data/key-features/[asin]/route.ts so the SAME logic runs
// whether triggered by a direct route hit (manual refresh/debug) or by an
// Inngest phase4 task (lib/inngest/functions/analyze-product.ts) — avoids
// two copies of the cache read/write logic drifting apart.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { resolveKeyFeatures, KeyFeaturesResult } from "@/lib/key-features-resolver";

const FEATURES_TTL_MS = 24 * 60 * 60 * 1000;

async function getCachedFeatures(cacheKey: string): Promise<{ result: KeyFeaturesResult; fetchedAt: string } | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabaseAdmin
    .from("amazon_cache")
    .select("payload, fetched_at")
    .eq("asin", cacheKey)
    .eq("cache_type", "key_features")
    .maybeSingle();

  if (data && Date.now() - new Date(data.fetched_at).getTime() < FEATURES_TTL_MS) {
    return { result: data.payload as KeyFeaturesResult, fetchedAt: data.fetched_at };
  }
  return null;
}

async function setCachedFeatures(cacheKey: string, result: KeyFeaturesResult) {
  if (!isSupabaseConfigured) return;
  try {
    await supabaseAdmin
      .from("amazon_cache")
      .upsert(
        { asin: cacheKey, cache_type: "key_features", payload: result, fetched_at: new Date().toISOString() },
        { onConflict: "asin,cache_type" }
      );
  } catch (e) {
    console.warn("Failed to cache key features:", e);
  }
}

export async function resolveKeyFeaturesCached(
  cacheKey: string,
  productName: string,
  asin: string | null,
  forceRefresh = false
): Promise<{ result: KeyFeaturesResult; retrievedAt: string; cached: boolean }> {
  if (!forceRefresh) {
    const cached = await getCachedFeatures(cacheKey);
    if (cached) return { result: cached.result, retrievedAt: cached.fetchedAt, cached: true };
  }
  const result = await resolveKeyFeatures(productName, asin);
  await setCachedFeatures(cacheKey, result);
  return { result, retrievedAt: new Date().toISOString(), cached: false };
}
