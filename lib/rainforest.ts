// lib/rainforest.ts
// Shared Rainforest API client — verified live Amazon product data (price,
// rating, review count, BSR) used to enrich AI-discovered competitors, plus
// ASIN resolution by title/brand search when the AI's own ASIN is wrong or
// a placeholder.

export const hasRainforestKey =
  !!process.env.RAINFOREST_API_KEY &&
  process.env.RAINFOREST_API_KEY !== "placeholder" &&
  !process.env.RAINFOREST_API_KEY.includes("xxxx");

export interface RainforestProduct {
  asin: string;
  title: string;
  price: string;
  price_raw: number | null;
  rating: number | null;
  rating_str: string;
  reviews_total: number | null;
  reviews_str: string;
  monthly_sales: number | null;
  monthly_str: string | null;
  bsr: string | null;
  image: string | null;
  amazon_url: string;
  in_stock: boolean;
  last_updated: string;
}

export interface AsinMatch {
  asin: string;
  matchedTitle: string;
  confidence: number;
}

const productCache = new Map<string, Promise<RainforestProduct | null>>();
const searchCache = new Map<string, Promise<AsinMatch | null>>();

async function fetchWithRetry(url: string, attempts = 3): Promise<any> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { next: { revalidate: 3600 } });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        await new Promise(r => setTimeout(r, 500 * Math.pow(3, i)));
        continue;
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise(r => setTimeout(r, 500 * Math.pow(3, i)));
    }
  }
  throw lastErr;
}

// Looks up a real, currently-listed Amazon product by ASIN. Returns null if
// Rainforest isn't configured, the ASIN isn't a real/found listing, or the
// request fails — callers should keep whatever data they already had in
// that case rather than treating null as an error.
export async function getAmazonProduct(asin: string): Promise<RainforestProduct | null> {
  if (!hasRainforestKey) return null;
  if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) return null;

  const cleanAsin = asin.toUpperCase();
  if (productCache.has(cleanAsin)) return productCache.get(cleanAsin)!;

  const promise = fetchAmazonProduct(cleanAsin);
  productCache.set(cleanAsin, promise);
  return promise;
}

async function fetchAmazonProduct(cleanAsin: string): Promise<RainforestProduct | null> {
  try {
    const url = new URL("https://api.rainforestapi.com/request");
    url.searchParams.set("api_key", process.env.RAINFOREST_API_KEY!);
    url.searchParams.set("type", "product");
    url.searchParams.set("asin", cleanAsin);
    url.searchParams.set("amazon_domain", "amazon.com");

    const data = await fetchWithRetry(url.toString());

    if (!data.request_info?.success || !data.product) {
      return null;
    }

    const p = data.product;
    return {
      asin: p.asin || cleanAsin,
      title: p.title || `Amazon Product ${cleanAsin}`,
      price: p.buybox_winner?.price?.value
        ? `$${p.buybox_winner.price.value}`
        : p.price?.value ? `$${p.price.value}` : "—",
      price_raw: p.buybox_winner?.price?.value ?? p.price?.value ?? null,
      rating: p.rating ?? null,
      rating_str: p.rating ? String(p.rating) : "—",
      reviews_total: p.ratings_total ?? null,
      reviews_str: p.ratings_total ? p.ratings_total.toLocaleString() : "—",
      monthly_sales: p.bought_in_past_month ?? null,
      monthly_str: p.bought_in_past_month ? `${p.bought_in_past_month}+ bought in past month` : null,
      bsr: p.bestsellers_rank?.[0]
        ? `#${p.bestsellers_rank[0].rank.toLocaleString()} in ${p.bestsellers_rank[0].category}`
        : null,
      image: p.main_image?.link ?? null,
      amazon_url: `https://www.amazon.com/dp/${cleanAsin}`,
      in_stock: p.buybox_winner?.is_prime !== undefined ? true : (p.availability?.type === "in_stock"),
      last_updated: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(`Rainforest product lookup failed for ${cleanAsin}:`, err);
    return null;
  }
}

function normalizeTokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
}

function titleSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeTokens(a));
  const setB = new Set(normalizeTokens(b));
  if (setA.size === 0) return 0;
  let overlap = 0;
  setA.forEach(t => { if (setB.has(t)) overlap += 1; });
  return overlap / setA.size;
}

// Finds the real ASIN for a product by searching Amazon on title + brand,
// for when the AI-discovered ASIN is missing, a placeholder, or doesn't
// resolve to a real listing. Requires the brand name to appear in the
// candidate title and a minimum token-overlap similarity — never returns a
// low-confidence guess.
export async function resolveAsinBySearch(title: string, brand?: string): Promise<AsinMatch | null> {
  if (!hasRainforestKey) return null;
  if (!title) return null;

  const searchTerm = brand ? `${brand} ${title}` : title;
  const cacheKey = normalizeTokens(searchTerm).join(" ");
  if (searchCache.has(cacheKey)) return searchCache.get(cacheKey)!;

  const promise = fetchAsinMatch(searchTerm, title, brand);
  searchCache.set(cacheKey, promise);
  return promise;
}

async function fetchAsinMatch(searchTerm: string, title: string, brand?: string): Promise<AsinMatch | null> {
  try {
    const url = new URL("https://api.rainforestapi.com/request");
    url.searchParams.set("api_key", process.env.RAINFOREST_API_KEY!);
    url.searchParams.set("type", "search");
    url.searchParams.set("amazon_domain", "amazon.com");
    url.searchParams.set("search_term", searchTerm);

    const data = await fetchWithRetry(url.toString());
    const results: any[] = (data.search_results || []).filter((r: any) => !r.sponsored && r.asin);

    let best: { r: any; score: number } | null = null;
    for (const r of results) {
      const resultTitle = r.title || "";
      if (brand && !resultTitle.toLowerCase().includes(brand.toLowerCase())) continue;
      const score = titleSimilarity(title, resultTitle);
      if (!best || score > best.score) best = { r, score };
    }

    if (!best || best.score < 0.6) return null;

    return {
      asin: best.r.asin,
      matchedTitle: best.r.title,
      confidence: best.score,
    };
  } catch (err) {
    console.warn(`Rainforest ASIN search failed for "${searchTerm}":`, err);
    return null;
  }
}
