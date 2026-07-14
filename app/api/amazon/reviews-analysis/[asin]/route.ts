import { NextRequest, NextResponse } from "next/server";
import { resolveCacheKey } from "@/lib/product-cache-key";
import { resolveReviewsCached } from "@/lib/task-runners/resolve-reviews";

export const maxDuration = 45;

// Path segment accepts a real 10-char ASIN OR the literal "none" — a
// product with no Amazon presence at all still needs this route (that's
// the point of the multi-source fallback in lib/amazon-review-analysis.ts),
// keyed instead by a hash of productName (lib/product-cache-key.ts). Kept
// as a manual refresh/debug entry point now that the analysis pipeline
// resolves this itself via an Inngest phase4 task — hitting this route
// again for an already-resolved competitor is a cache read, not a
// recomputation.
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
    const { analysis, retrievedAt, cached } = await resolveReviewsCached(cacheKey, isRealAsin ? rawAsin : null, productName, forceRefresh);
    return NextResponse.json({ ...analysis, retrievedAt, cached });
  } catch (err: any) {
    return NextResponse.json({ error: "Live review data unavailable — retry" }, { status: 503 });
  }
}
