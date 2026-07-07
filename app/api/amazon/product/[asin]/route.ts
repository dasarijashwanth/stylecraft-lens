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

  return NextResponse.json(product);
}
