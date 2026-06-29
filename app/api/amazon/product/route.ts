import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const asin = req.nextUrl.searchParams.get("asin");
  if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) {
    return NextResponse.json({ error: "Invalid ASIN" }, { status: 400 });
  }

  const cleanAsin = asin.toUpperCase();
  const apiKey = process.env.RAINFOREST_API_KEY;
  
  // If the key is not set or holds placeholder values, fallback to realistic mock data
  if (!apiKey || apiKey === "placeholder" || apiKey.includes("xxxx")) {
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

  try {
    const url = new URL("https://api.rainforestapi.com/request");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("type", "product");
    url.searchParams.set("asin", cleanAsin);
    url.searchParams.set("amazon_domain", "amazon.com");

    const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
    const data = await res.json();

    if (!data.request_info?.success || !data.product) {
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

    const p = data.product;
    return NextResponse.json({
      asin: p.asin || cleanAsin,
      title: p.title || `Amazon Product ${cleanAsin}`,
      price: p.buybox_winner?.price?.value
        ? `$${p.buybox_winner.price.value}`
        : p.price?.value ? `$${p.price.value}` : "—",
      price_raw: p.buybox_winner?.price?.value ?? p.price?.value ?? null,
      rating: p.rating ?? null,
      rating_str: p.rating ? String(p.rating) : "—",
      reviews_total: p.ratings_total ?? null,
      reviews_str: p.ratings_total
        ? p.ratings_total.toLocaleString()
        : "—",
      monthly_sales: p.bought_in_past_month ?? null,
      monthly_str: p.bought_in_past_month
        ? `${p.bought_in_past_month}+ bought in past month`
        : null,
      bsr: p.bestsellers_rank?.[0]
        ? `#${p.bestsellers_rank[0].rank.toLocaleString()} in ${p.bestsellers_rank[0].category}`
        : null,
      image: p.main_image?.link ?? null,
      amazon_url: `https://www.amazon.com/dp/${cleanAsin}`,
      in_stock: p.buybox_winner?.is_prime !== undefined
        ? true
        : (p.availability?.type === "in_stock"),
      last_updated: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Rainforest API error:", err);
    return NextResponse.json({
      asin: cleanAsin,
      title: `Amazon Product ${cleanAsin}`,
      price: "$149.99",
      price_raw: 149.99,
      rating: 4.6,
      rating_str: "4.6",
      reviews_total: 1245,
      reviews_str: "1,245",
      monthly_sales: 1000,
      monthly_str: "1,000+ bought in past month",
      bsr: "#1,500 in Beauty & Personal Care",
      image: null,
      amazon_url: `https://www.amazon.com/dp/${cleanAsin}`,
      in_stock: true,
      last_updated: new Date().toISOString(),
      is_mock: true
    });
  }
}
