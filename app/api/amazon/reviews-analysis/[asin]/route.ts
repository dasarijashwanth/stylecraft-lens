import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { getAmazonProduct, getAmazonReviews, hasRainforestKey } from "@/lib/rainforest";
import { analyzeReviews, ReviewAnalysis } from "@/lib/amazon-review-analysis";

export const maxDuration = 45;

const REVIEWS_ANALYSIS_TTL_MS = 24 * 60 * 60 * 1000;

async function getCachedAnalysis(asin: string): Promise<{ analysis: ReviewAnalysis; fetchedAt: string } | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabaseAdmin
    .from("amazon_cache")
    .select("payload, fetched_at")
    .eq("asin", asin)
    .eq("cache_type", "reviews_analysis")
    .maybeSingle();

  if (data && Date.now() - new Date(data.fetched_at).getTime() < REVIEWS_ANALYSIS_TTL_MS) {
    return { analysis: data.payload as ReviewAnalysis, fetchedAt: data.fetched_at };
  }
  return null;
}

async function setCachedAnalysis(asin: string, analysis: ReviewAnalysis) {
  if (!isSupabaseConfigured) return;
  try {
    await supabaseAdmin
      .from("amazon_cache")
      .upsert(
        { asin, cache_type: "reviews_analysis", payload: analysis, fetched_at: new Date().toISOString() },
        { onConflict: "asin,cache_type" }
      );
  } catch (e) {
    console.warn("Failed to cache review analysis:", e);
  }
}

export async function GET(req: NextRequest, { params }: { params: { asin: string } }) {
  const asin = params.asin?.toUpperCase();
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
    return NextResponse.json({ error: "Invalid ASIN" }, { status: 400 });
  }

  if (!hasRainforestKey) {
    return NextResponse.json({ error: "Live Amazon data unavailable — Rainforest API key not configured" }, { status: 503 });
  }

  try {
    const cached = await getCachedAnalysis(asin);
    if (cached) {
      return NextResponse.json({ ...cached.analysis, retrievedAt: cached.fetchedAt, cached: true });
    }

    const product = await getAmazonProduct(asin);
    const reviews = await getAmazonReviews(asin);

    if (reviews === null) {
      return NextResponse.json({ error: "Live Amazon data unavailable — retry" }, { status: 503 });
    }

    const analysis = await analyzeReviews(asin, product?.title || asin, reviews);
    await setCachedAnalysis(asin, analysis);

    return NextResponse.json({ ...analysis, retrievedAt: new Date().toISOString(), cached: false });
  } catch (err: any) {
    return NextResponse.json({ error: "Live Amazon data unavailable — retry" }, { status: 503 });
  }
}
