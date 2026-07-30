import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { resolveKeyFeatures, KeyFeaturesResult } from "@/lib/key-features-resolver";
import { resolveCacheKey } from "@/lib/product-cache-key";
import { insertProvenance } from "@/lib/db/section-provenance";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis } from "@/lib/db/analyses";
import type { ToolType } from "@/lib/tool-type-taxonomy";
import { listToolTypes } from "@/lib/db/tool-types";

// Duplicated deliberately (matches the reviews-analysis/product-news route's
// own copies) — a tiny, DB-touching helper, same precedent
// lib/legacy-brand-discovery.ts's own header comment sets for small
// per-file helpers in this codebase.
async function resolveAnalysisToolType(analysisId: string | null): Promise<ToolType | null> {
  if (!analysisId) return null;
  try {
    const analysis = await getAnalysis(analysisId);
    return (analysis?.phase0_result?.toolType as ToolType) || null;
  } catch {
    return null;
  }
}

// Multi-tier feature resolution (Amazon -> brand site -> retailers ->
// expert reviews) can genuinely take 30-40s when Amazon has nothing and
// every fallback tier has to run. 60s is Vercel Hobby's actual ceiling —
// bumped from 55 for the same reason as the other per-product resolver
// routes: every extra second of headroom reduces how often a hard Vercel
// kill mid-response returns a non-JSON error page instead of real JSON.
export const maxDuration = 60;

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

export async function GET(req: NextRequest, { params }: { params: { asin: string } }) {
  const rawAsin = params.asin?.toUpperCase();
  const isRealAsin = !!rawAsin && /^[A-Z0-9]{10}$/.test(rawAsin);
  if (!isRealAsin && rawAsin !== "NONE") {
    return NextResponse.json({ error: "Invalid ASIN" }, { status: 400 });
  }

  const productName = req.nextUrl.searchParams.get("productName");
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
    await getAuthSession();

    if (!forceRefresh) {
      const cached = await getCachedFeatures(cacheKey);
      if (cached) {
        return NextResponse.json({ ...cached.result, retrievedAt: cached.fetchedAt, cached: true });
      }
    }

    const requiredToolType = await resolveAnalysisToolType(analysisId);
    const toolTypes = await listToolTypes();
    const result = await resolveKeyFeatures(productName, isRealAsin ? rawAsin : null, toolTypes, requiredToolType);
    await setCachedFeatures(cacheKey, result);

    if (result.provenance) {
      try {
        await insertProvenance({
          productKey: cacheKey, section: "key_features", analysisId, productName,
          tiers: result.provenance.tiers, queries: result.provenance.queries,
        });
      } catch (e) {
        console.warn("Failed to persist key-features provenance:", e);
      }
    }

    return NextResponse.json({ ...result, retrievedAt: new Date().toISOString(), cached: false });
  } catch (err: any) {
    return NextResponse.json({ error: "Live feature data unavailable — retry" }, { status: 503 });
  }
}
