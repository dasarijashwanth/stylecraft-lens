import { NextRequest, NextResponse } from "next/server";
import { getAmazonProduct, hasRainforestKey } from "@/lib/rainforest";

export async function GET(req: NextRequest, { params }: { params: { asin: string } }) {
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
