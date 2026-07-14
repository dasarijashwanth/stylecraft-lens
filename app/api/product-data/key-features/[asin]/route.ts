import { NextRequest, NextResponse } from "next/server";
import { resolveCacheKey } from "@/lib/product-cache-key";
import { resolveKeyFeaturesCached } from "@/lib/task-runners/resolve-key-features";

// Multi-tier feature resolution (Amazon -> brand site -> retailers ->
// expert reviews) can genuinely take 30-40s when Amazon has nothing and
// every fallback tier has to run — same budget reasoning as the other
// per-product resolver routes. Kept as a manual refresh/debug entry point
// now that the analysis pipeline resolves this itself via an Inngest
// phase4 task (lib/inngest/functions/analyze-product.ts) calling the same
// resolveKeyFeaturesCached — hitting this route again for an already-
// resolved competitor is a cache read, not a recomputation.
export const maxDuration = 55;

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
  const cacheKey = resolveCacheKey(isRealAsin ? rawAsin : "", productName);

  try {
    const { result, retrievedAt, cached } = await resolveKeyFeaturesCached(cacheKey, productName, isRealAsin ? rawAsin : null, forceRefresh);
    return NextResponse.json({ ...result, retrievedAt, cached });
  } catch (err: any) {
    return NextResponse.json({ error: "Live feature data unavailable — retry" }, { status: 503 });
  }
}
