// lib/rainforest.ts
// Shared Rainforest API client — verified live Amazon product data (price,
// rating, review count, BSR, feature bullets) used to enrich AI-discovered
// competitors, plus ASIN resolution by title/brand search when the AI's own
// ASIN is wrong or a placeholder, plus real customer review fetching for
// review-grounded strengths/weaknesses analysis.
import { isSupabaseConfigured, supabaseAdmin } from "./supabase";

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
  feature_bullets: string[];
  last_updated: string;
}

export interface AsinMatch {
  asin: string;
  matchedTitle: string;
  confidence: number;
}

export interface AmazonReview {
  title: string;
  body: string;
  rating: number | null;
  date: string | null;
  verifiedPurchase: boolean;
}

const productCache = new Map<string, Promise<RainforestProduct | null>>();
const searchCache = new Map<string, Promise<AsinMatch | null>>();

const PRODUCT_TTL_MS = 12 * 60 * 60 * 1000;
const REVIEWS_TTL_MS = 24 * 60 * 60 * 1000;

// Cross-instance cache backed by Supabase — an in-memory Map only survives
// within one warm serverless container. Read-through/write-through; callers
// pass a fetcher that only runs on a genuine cache miss/expiry.
async function withSupabaseCache<T>(asin: string, cacheType: string, ttlMs: number, fetcher: () => Promise<T | null>): Promise<T | null> {
  if (isSupabaseConfigured) {
    try {
      const { data } = await supabaseAdmin
        .from("amazon_cache")
        .select("payload, fetched_at")
        .eq("asin", asin)
        .eq("cache_type", cacheType)
        .maybeSingle();

      if (data && Date.now() - new Date(data.fetched_at).getTime() < ttlMs) {
        return data.payload as T;
      }
    } catch (e) {
      console.warn(`Amazon cache read failed for ${asin}/${cacheType}:`, e);
    }
  }

  const fresh = await fetcher();

  if (isSupabaseConfigured && fresh !== null) {
    try {
      await supabaseAdmin
        .from("amazon_cache")
        .upsert({ asin, cache_type: cacheType, payload: fresh, fetched_at: new Date().toISOString() }, { onConflict: "asin,cache_type" });
    } catch (e) {
      console.warn(`Amazon cache write failed for ${asin}/${cacheType}:`, e);
    }
  }

  return fresh;
}

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

  const promise = withSupabaseCache(cleanAsin, "product", PRODUCT_TTL_MS, () => fetchAmazonProduct(cleanAsin));
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
      // Real, verbatim bullet points from the live listing — never invented.
      feature_bullets: Array.isArray(p.feature_bullets) ? p.feature_bullets.filter((b: any) => typeof b === "string" && b.trim()) : [],
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

export interface CategorySearchResult {
  asin: string;
  title: string;
  price: string;
  rating: string;
  reviewsTotal: string;
  monthlyStr: string | null;
  image: string | null;
}

// Real, currently-listed Amazon products for an arbitrary category search
// term — used as the competitor-discovery fallback when no AI provider is
// available (see lib/analysisEngine.ts's discoverCompetitorsLive). Unlike
// resolveAsinBySearch (which finds the ONE best match for a specific known
// product), this returns up to `limit` organic results as-is, so a
// category with no hardcoded mock data still gets real, current
// competitors instead of fabricated placeholder brand names.
export async function searchAmazonCategory(searchTerm: string, limit = 8): Promise<CategorySearchResult[]> {
  if (!hasRainforestKey) return [];
  try {
    const url = new URL("https://api.rainforestapi.com/request");
    url.searchParams.set("api_key", process.env.RAINFOREST_API_KEY!);
    url.searchParams.set("type", "search");
    url.searchParams.set("amazon_domain", "amazon.com");
    url.searchParams.set("search_term", searchTerm);

    const data = await fetchWithRetry(url.toString());
    const results: any[] = (data.search_results || []).filter((r: any) => !r.sponsored && r.asin && r.title);

    return results.slice(0, limit).map((r: any) => {
      const priceEntry = Array.isArray(r.prices) ? r.prices[0] : null;
      return {
        asin: r.asin,
        title: r.title,
        price: priceEntry?.raw || (typeof priceEntry?.value === "number" ? `$${priceEntry.value}` : "—"),
        rating: typeof r.rating === "number" ? String(r.rating) : "—",
        reviewsTotal: typeof r.ratings_total === "number" ? r.ratings_total.toLocaleString() : "—",
        monthlyStr: r.recent_sales || null,
        image: r.image || null,
      };
    });
  } catch (err) {
    console.warn(`Rainforest category search failed for "${searchTerm}":`, err);
    return [];
  }
}

// Fetches real customer reviews for an ASIN — the ONLY source strengths,
// weaknesses, and recent-buyer-sentiment analysis is allowed to draw from
// (see lib/amazon-review-analysis.ts). Pulls up to 2 pages of the most
// recent reviews (~20-30 reviews); bounded deliberately to keep this fast
// enough for an on-demand UI action rather than a full 3-page sweep.
export async function getAmazonReviews(asin: string): Promise<AmazonReview[] | null> {
  if (!hasRainforestKey) return null;
  if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) return null;

  const cleanAsin = asin.toUpperCase();
  const cached = await withSupabaseCache<AmazonReview[]>(cleanAsin, "reviews_raw", REVIEWS_TTL_MS, () => fetchAllReviews(cleanAsin));
  return cached;
}

// Distinguishes "the request itself failed / the endpoint is unavailable"
// (ok: false — caller should surface "Live Amazon data unavailable", never
// substitute anything) from "the request succeeded and there just aren't
// many reviews" (ok: true, reviews: []) — those must not be treated the same.
async function fetchReviewsPage(cleanAsin: string, page: number): Promise<{ ok: boolean; reviews: AmazonReview[] }> {
  try {
    const url = new URL("https://api.rainforestapi.com/request");
    url.searchParams.set("api_key", process.env.RAINFOREST_API_KEY!);
    url.searchParams.set("type", "reviews");
    url.searchParams.set("asin", cleanAsin);
    url.searchParams.set("amazon_domain", "amazon.com");
    url.searchParams.set("sort_by", "most_recent");
    url.searchParams.set("page", String(page));

    const data = await fetchWithRetry(url.toString());
    if (!data.request_info?.success || !Array.isArray(data.reviews)) {
      console.warn(`Rainforest reviews request unsuccessful for ${cleanAsin} page ${page}:`, data.request_info?.message);
      return { ok: false, reviews: [] };
    }

    return {
      ok: true,
      reviews: data.reviews.map((r: any) => ({
        title: r.title || "",
        body: r.body || "",
        rating: r.rating ?? null,
        date: r.date?.utc || r.date?.raw || null,
        verifiedPurchase: !!r.verified_purchase,
      })).filter((r: AmazonReview) => r.body.trim().length > 0),
    };
  } catch (err) {
    console.warn(`Rainforest reviews fetch failed for ${cleanAsin} page ${page}:`, err);
    return { ok: false, reviews: [] };
  }
}

// Returns null if the reviews endpoint itself failed on every page (caller
// must show "unavailable", never fall back to anything); returns the
// (possibly empty) review list if at least one page genuinely succeeded.
async function fetchAllReviews(cleanAsin: string): Promise<AmazonReview[] | null> {
  const [page1, page2] = await Promise.all([fetchReviewsPage(cleanAsin, 1), fetchReviewsPage(cleanAsin, 2)]);
  if (!page1.ok && !page2.ok) return null;
  return [...page1.reviews, ...page2.reviews];
}
