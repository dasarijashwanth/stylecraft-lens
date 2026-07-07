import { NextRequest, NextResponse } from "next/server";
import { getAmazonProduct, hasRainforestKey } from "@/lib/rainforest";

export async function GET(req: NextRequest) {
  const asin = req.nextUrl.searchParams.get("asin");
  if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) {
    return NextResponse.json({ error: "Invalid ASIN" }, { status: 400 });
  }

  const cleanAsin = asin.toUpperCase();

  if (!hasRainforestKey) {
    return NextResponse.json({
      asin: cleanAsin,
      title: `Amazon Product ${cleanAsin}`,
      price: "$149.99",
      price_raw: 149.99,
      rating: 4.6,
      rating_str: "4.6",
      reviews_total: 1245,
      reviews_str: "1,245",
      monthly_sales: 1500,
      monthly_str: "1,500+ bought in past month",
      bsr: "#1,245 in Beauty & Personal Care",
      image: null,
      amazon_url: `https://www.amazon.com/dp/${cleanAsin}`,
      in_stock: true,
      last_updated: new Date().toISOString(),
      is_mock: true
    });
  }

  const product = await getAmazonProduct(cleanAsin);

  if (!product) {
    return NextResponse.json({
      asin: cleanAsin,
      title: `Amazon Product ${cleanAsin}`,
      price: "$149.99",
      price_raw: 149.99,
      rating: 4.5,
      rating_str: "4.5",
      reviews_total: 850,
      reviews_str: "850",
      monthly_sales: 500,
      monthly_str: "500+ bought in past month",
      bsr: "#2,150 in Beauty & Personal Care",
      image: null,
      amazon_url: `https://www.amazon.com/dp/${cleanAsin}`,
      in_stock: true,
      last_updated: new Date().toISOString(),
      is_mock: true
    });
  }

  return NextResponse.json(product);
}
