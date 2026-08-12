import { NextRequest, NextResponse } from "next/server";
import { getAmazonProduct, hasRainforestKey } from "@/lib/rainforest";
import { getAuthSession } from "@/lib/auth";

// ASIN-keyed Amazon data has no per-user ownership concept (it's shared,
// public product data, cached in amazon_cache by ASIN for every caller) —
// middleware.ts already blocks fully-unauthenticated /api/** requests, so
// this call is defense-in-depth consistency with every other route, not
// closing an otherwise-open door.
//
// See app/api/analyses/[id]/competitors/preview/route.ts's fuller comment —
// getAmazonProduct can legitimately take well over Vercel's default
// function duration for some listings.
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: { asin: string } }) {
  await getAuthSession();
  const asin = params.asin?.toUpperCase();
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
    return NextResponse.json({ error: "Invalid ASIN" }, { status: 400 });
  }

  if (!hasRainforestKey) {
    return NextResponse.json({ error: "Live Amazon data unavailable — Rainforest API key not configured" }, { status: 503 });
  }

  const product = await getAmazonProduct(asin);
  if (!product) {
    return NextResponse.json({ error: "Live Amazon data unavailable — retry" }, { status: 503 });
  }

  // Strip the heavy, internal-only fields (raw_product is the full
  // untrimmed Rainforest payload kept for future zero-cost re-mapping;
  // variants/full attributes/specifications are rarely needed client-side)
  // before sending this to the browser — keeps useAmazonProduct's payload
  // small while still exposing everything CompetitorCard actually renders.
  const { raw_product, variants, attributes, ...clientProduct } = product;
  return NextResponse.json(clientProduct);
}
