// lib/rainforest.ts
// Shared Rainforest API client — verified live Amazon product data (price,
// rating, review count, BSR, feature bullets, and the full listing detail:
// description, manufacturer, model number, specifications, top reviews,
// rating breakdown, etc.) used to enrich AI-discovered competitors, plus
// ASIN resolution by title/brand search when the AI's own ASIN is wrong or
// a placeholder, plus real customer review fetching for review-grounded
// strengths/weaknesses analysis.
import { isSupabaseConfigured, supabaseAdmin } from "./supabase";
import { sanitizeText } from "./sanitize";
import { logCall } from "./obs";

export const hasRainforestKey =
  !!process.env.RAINFOREST_API_KEY &&
  process.env.RAINFOREST_API_KEY !== "placeholder" &&
  !process.env.RAINFOREST_API_KEY.includes("xxxx");

export interface RainforestSpec {
  name: string;
  value: string;
}

export interface RainforestTopReview {
  title: string;
  body: string;
  rating: number | null;
  date: string | null;
  verified_purchase: boolean;
}

export interface RainforestVideo {
  title: string | null;
  link: string | null;
}

export interface RainforestVariant {
  asin: string | null;
  title: string | null;
  price: string | null;
}

export interface RainforestBsrEntry {
  rank: number;
  category: string;
  link: string | null;
}

export interface RainforestRatingBreakdown {
  five_star?: number;
  four_star?: number;
  three_star?: number;
  two_star?: number;
  one_star?: number;
}

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

  // Widened fields — verbatim from the Amazon listing, never invented.
  // Scalars/objects are null when the listing doesn't have them; arrays
  // default to [] so consumers can .map/.slice unguarded.
  description: string | null;
  brand: string | null;
  manufacturer: string | null;
  model_number: string | null;
  link: string | null;
  dimensions: string | null;
  weight: string | null;
  important_information: string | null;
  first_available: string | null;
  videos_count: number | null;
  country_of_origin: string | null;
  material: string | null;

  images: string[];
  categories: string[];
  specifications: RainforestSpec[];
  attributes: RainforestSpec[];
  whats_in_the_box: string[];
  top_reviews: RainforestTopReview[];
  videos: RainforestVideo[];
  variants: RainforestVariant[];
  bestsellers_rank_full: RainforestBsrEntry[];
  rating_breakdown: RainforestRatingBreakdown | null;

  // Full, untrimmed `data.product` from Rainforest — persisted wherever this
  // object is stored (amazon_cache.payload, product_snapshots.raw_data.amazon)
  // so that any FUTURE field addition can be re-mapped from already-stored
  // data with zero additional Rainforest calls. Never sent to the browser —
  // strip it in any client-facing API route.
  raw_product?: any;
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

// Tri-state result for review fetches — distinguishes "the request itself
// failed" (error) from "the request succeeded but there's nothing here"
// (empty) from "got real reviews" (ok). Collapsing these into a single
// boolean/null was the root cause of Rainforest auth/credit outages
// silently masquerading as "this product has no reviews".
export type ReviewFetchStatus = "ok" | "empty" | "error";

export interface ReviewSetResult {
  status: ReviewFetchStatus;
  reviews: AmazonReview[];
  errorMessage?: string;
}

// Combines several per-page/per-set results into one: "ok" if anything
// genuinely succeeded, else "empty" if anything genuinely ran and found
// nothing, else "error" only when EVERY attempt failed outright.
export function combineFetchResults(pages: ReviewSetResult[]): ReviewSetResult {
  const reviews = pages.flatMap(p => p.reviews);
  if (pages.some(p => p.status === "ok")) return { status: "ok", reviews };
  if (pages.some(p => p.status === "empty")) return { status: "empty", reviews };
  return { status: "error", reviews: [], errorMessage: pages.find(p => p.errorMessage)?.errorMessage };
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

// Not-retryable class — 401/402/403 (bad key, out of credits, forbidden)
// can never be fixed by retrying. Thrown as this specific type so the loop
// below can tell it apart from a transient network/5xx error and fail
// immediately instead of burning through every remaining attempt's
// backoff delay — every caller's fallback chain (web search tiers) then
// kicks in right away instead of each Rainforest call wasting several
// seconds retrying a doomed request. Carries the HTTP status so callers can
// log/report it distinctly from a generic failure.
class RainforestAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function fetchWithRetry(url: string, attempts = 2): Promise<any> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { next: { revalidate: 3600 } });
      if (res.status === 401 || res.status === 402 || res.status === 403) {
        throw new RainforestAuthError(`HTTP ${res.status} (not retryable)`, res.status);
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
        if (i < attempts - 1) await new Promise(r => setTimeout(r, 500 * Math.pow(3, i)));
        continue;
      }
      return await res.json();
    } catch (err) {
      if (err instanceof RainforestAuthError) throw err;
      lastErr = err;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 500 * Math.pow(3, i)));
    }
  }
  throw lastErr;
}

function errStatus(err: any): number | null {
  return typeof err?.status === "number" ? err.status : null;
}

// Case-insensitive substring match over Rainforest's {name, value}
// specification/attribute pairs — Rainforest doesn't reliably surface
// manufacturer/model/dimensions/weight as dedicated top-level fields across
// every listing, so this recovers them from specifications when present.
// Defaults to null rather than guessing when nothing matches.
function findSpec(specs: RainforestSpec[], labelVariants: string[]): string | null {
  for (const s of specs) {
    const name = (s?.name || "").toLowerCase().trim();
    if (name && labelVariants.some(v => name.includes(v))) {
      const val = (s?.value || "").toString().trim();
      if (val) return val;
    }
  }
  return null;
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

// Bypasses both the in-memory and Supabase caches — used by the opt-in
// backfill script (scripts/backfill-amazon-fields.ts) so a re-fetch after
// widening this file's mapping actually gets the new fields, instead of
// replaying a pre-widening cached payload. Makes a real, credit-costing
// Rainforest call every time — never call this from request-serving code.
export async function fetchAmazonProductFresh(asin: string): Promise<RainforestProduct | null> {
  if (!hasRainforestKey) return null;
  if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) return null;
  return fetchAmazonProduct(asin.toUpperCase());
}

async function fetchAmazonProduct(cleanAsin: string): Promise<RainforestProduct | null> {
  const t0 = Date.now();
  try {
    const url = new URL("https://api.rainforestapi.com/request");
    url.searchParams.set("api_key", process.env.RAINFOREST_API_KEY!);
    url.searchParams.set("type", "product");
    url.searchParams.set("asin", cleanAsin);
    url.searchParams.set("amazon_domain", "amazon.com");

    const data = await fetchWithRetry(url.toString());

    if (!data.request_info?.success || !data.product) {
      logCall("rainforest", { op: "product", asin: cleanAsin, requestSuccess: !!data.request_info?.success, outcome: "empty", elapsedMs: Date.now() - t0 });
      return null;
    }

    const p = data.product;

    const specifications: RainforestSpec[] = Array.isArray(p.specifications)
      ? p.specifications.filter((s: any) => s?.name || s?.value).map((s: any) => ({ name: String(s.name || "").trim(), value: String(s.value || "").trim() }))
      : [];
    const attributes: RainforestSpec[] = Array.isArray(p.attributes)
      ? p.attributes.filter((a: any) => a?.name || a?.value).map((a: any) => ({ name: String(a.name || "").trim(), value: String(a.value || "").trim() }))
      : [];
    // Rainforest splits the same kind of fact across `specifications` and
    // `attributes` inconsistently by listing — findSpec below always
    // searches both combined, never just one.
    const specAndAttr = [...specifications, ...attributes];

    const product: RainforestProduct = {
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

      description: sanitizeText(p.description),
      brand: p.brand ?? null,
      manufacturer: p.manufacturer ?? findSpec(specAndAttr, ["manufacturer"]) ?? null,
      // Rainforest's schema is inconsistent on model number across listings —
      // check the dedicated fields, then specifications/attributes, defaulting to null.
      model_number: p.model_number ?? p.model ?? findSpec(specAndAttr, ["model number", "item model number", "model no", "model"]) ?? null,
      link: p.link ?? null,
      dimensions: p.dimensions ?? findSpec(specAndAttr, ["product dimensions", "package dimensions", "item dimensions", "dimensions"]) ?? null,
      weight: p.weight ?? findSpec(specAndAttr, ["item weight", "product weight", "package weight", "shipping weight", "weight"]) ?? null,
      important_information: Array.isArray(p.important_information?.sections)
        ? (p.important_information.sections.map((s: any) => s?.body).filter(Boolean).join("\n\n") || null)
        : (typeof p.important_information === "string" ? p.important_information : null),
      first_available: p.first_available?.raw ?? (typeof p.first_available === "string" ? p.first_available : null),
      videos_count: typeof p.videos_count === "number" ? p.videos_count : (Array.isArray(p.videos) ? p.videos.length : null),
      country_of_origin: findSpec(specAndAttr, ["country of origin", "country/region of origin", "made in"]) ?? null,
      material: findSpec(specAndAttr, ["material", "material type", "outer material", "fabric type"]) ?? null,

      images: Array.isArray(p.images)
        ? p.images.map((i: any) => i?.link).filter((l: any) => typeof l === "string")
        : (p.main_image?.link ? [p.main_image.link] : []),
      categories: Array.isArray(p.categories) ? p.categories.map((c: any) => c?.name).filter(Boolean) : [],
      specifications,
      attributes,
      whats_in_the_box: Array.isArray(p.whats_in_the_box) ? p.whats_in_the_box.filter((x: any) => typeof x === "string" && x.trim()) : [],
      top_reviews: Array.isArray(p.top_reviews)
        ? p.top_reviews.map((r: any) => ({
            title: r.title || "",
            body: r.body || "",
            rating: r.rating ?? null,
            date: r.date?.utc || r.date?.raw || null,
            verified_purchase: !!r.verified_purchase,
          }))
        : [],
      videos: Array.isArray(p.videos) ? p.videos.map((v: any) => ({ title: v?.title ?? null, link: v?.link ?? null })) : [],
      variants: Array.isArray(p.variants) ? p.variants.map((v: any) => ({ asin: v?.asin ?? null, title: v?.title ?? null, price: v?.price?.raw ?? null })) : [],
      bestsellers_rank_full: Array.isArray(p.bestsellers_rank)
        ? p.bestsellers_rank.filter((b: any) => b?.rank).map((b: any) => ({ rank: b.rank, category: b.category || "", link: b.link ?? null }))
        : [],
      rating_breakdown: p.rating_breakdown && typeof p.rating_breakdown === "object"
        ? {
            five_star: p.rating_breakdown.five_star?.percentage,
            four_star: p.rating_breakdown.four_star?.percentage,
            three_star: p.rating_breakdown.three_star?.percentage,
            two_star: p.rating_breakdown.two_star?.percentage,
            one_star: p.rating_breakdown.one_star?.percentage,
          }
        : null,

      raw_product: data.product,
    };

    logCall("rainforest", { op: "product", asin: cleanAsin, requestSuccess: true, outcome: "ok", elapsedMs: Date.now() - t0 });
    return product;
  } catch (err: any) {
    const httpStatus = errStatus(err);
    logCall("rainforest", { op: "product", asin: cleanAsin, httpStatus, outcome: "error", elapsedMs: Date.now() - t0, errorMessage: String(err?.message ?? err) });
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
  const t0 = Date.now();
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

    if (!best || best.score < 0.6) {
      logCall("rainforest", { op: "search", outcome: "empty", itemCount: results.length, elapsedMs: Date.now() - t0 });
      return null;
    }

    logCall("rainforest", { op: "search", outcome: "ok", itemCount: results.length, elapsedMs: Date.now() - t0 });
    return {
      asin: best.r.asin,
      matchedTitle: best.r.title,
      confidence: best.score,
    };
  } catch (err: any) {
    logCall("rainforest", { op: "search", httpStatus: errStatus(err), outcome: "error", elapsedMs: Date.now() - t0, errorMessage: String(err?.message ?? err) });
    console.warn(`Rainforest ASIN search failed for "${searchTerm}":`, err);
    return null;
  }
}

export interface CategorySearchResult {
  asin: string;
  title: string;
  price: string;
  // Real Rainforest-reported numeric price — lets a caller price-band-gate
  // these results without a redundant second `type=product` lookup per
  // candidate (see lib/analysisEngine.ts's applyPriceBandGate).
  price_raw: number | null;
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
  const t0 = Date.now();
  try {
    const url = new URL("https://api.rainforestapi.com/request");
    url.searchParams.set("api_key", process.env.RAINFOREST_API_KEY!);
    url.searchParams.set("type", "search");
    url.searchParams.set("amazon_domain", "amazon.com");
    url.searchParams.set("search_term", searchTerm);

    const data = await fetchWithRetry(url.toString());
    const results: any[] = (data.search_results || []).filter((r: any) => !r.sponsored && r.asin && r.title);

    const mapped = results.slice(0, limit).map((r: any) => {
      const priceEntry = Array.isArray(r.prices) ? r.prices[0] : null;
      return {
        asin: r.asin,
        title: r.title,
        price: priceEntry?.raw || (typeof priceEntry?.value === "number" ? `$${priceEntry.value}` : "—"),
        price_raw: typeof priceEntry?.value === "number" ? priceEntry.value : null,
        rating: typeof r.rating === "number" ? String(r.rating) : "—",
        reviewsTotal: typeof r.ratings_total === "number" ? r.ratings_total.toLocaleString() : "—",
        monthlyStr: r.recent_sales || null,
        image: r.image || null,
      };
    });
    logCall("rainforest", { op: "category-search", outcome: mapped.length ? "ok" : "empty", itemCount: mapped.length, elapsedMs: Date.now() - t0 });
    return mapped;
  } catch (err: any) {
    logCall("rainforest", { op: "category-search", httpStatus: errStatus(err), outcome: "error", elapsedMs: Date.now() - t0, errorMessage: String(err?.message ?? err) });
    console.warn(`Rainforest category search failed for "${searchTerm}":`, err);
    return [];
  }
}

// Fetches real customer reviews for an ASIN — the ONLY source strengths,
// weaknesses, and recent-buyer-sentiment analysis is allowed to draw from
// (see lib/amazon-review-analysis.ts). Pulls up to 2 pages of the most
// recent reviews (~20-30 reviews); bounded deliberately to keep this fast
// enough for an on-demand UI action rather than a full 3-page sweep.
//
// Returns a tri-state result rather than T[] | null: "error" (the request
// itself failed — auth/credit outage, network issue) must never be treated
// the same as "empty" (the request succeeded and there just aren't many
// reviews) — collapsing those was the root cause of a Rainforest credit
// outage silently rendering as "this product has no reviews".
export async function getAmazonReviews(asin: string): Promise<ReviewSetResult> {
  if (!hasRainforestKey) return { status: "error", reviews: [], errorMessage: "Rainforest not configured" };
  if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) return { status: "error", reviews: [], errorMessage: "Invalid or missing ASIN" };

  const cleanAsin = asin.toUpperCase();

  if (isSupabaseConfigured) {
    try {
      const { data } = await supabaseAdmin
        .from("amazon_cache")
        .select("payload, fetched_at")
        .eq("asin", cleanAsin)
        .eq("cache_type", "reviews_raw")
        .maybeSingle();

      if (data && Date.now() - new Date(data.fetched_at).getTime() < REVIEWS_TTL_MS) {
        const arr = (data.payload as AmazonReview[]) || [];
        return { status: arr.length ? "ok" : "empty", reviews: arr };
      }
    } catch (e) {
      console.warn(`Amazon cache read failed for ${cleanAsin}/reviews_raw:`, e);
    }
  }

  const fresh = await fetchAllReviews(cleanAsin);

  // Never cache an "error" result — a transient credit outage must not
  // poison the 24h cache with a false "empty" that then blocks a retry
  // once Rainforest is available again.
  if (isSupabaseConfigured && fresh.status !== "error") {
    try {
      await supabaseAdmin
        .from("amazon_cache")
        .upsert({ asin: cleanAsin, cache_type: "reviews_raw", payload: fresh.reviews, fetched_at: new Date().toISOString() }, { onConflict: "asin,cache_type" });
    } catch (e) {
      console.warn(`Amazon cache write failed for ${cleanAsin}/reviews_raw:`, e);
    }
  }

  return fresh;
}

async function fetchAllReviews(cleanAsin: string): Promise<ReviewSetResult> {
  const [page1, page2] = await Promise.all([fetchReviewsPage(cleanAsin, 1), fetchReviewsPage(cleanAsin, 2)]);
  return combineFetchResults([page1, page2]);
}

// Star-filtered pass — used for the Strengths (four_star,five_star) and
// Weaknesses (one_star,two_star) sections so each is analyzed from
// genuinely positive/negative reviews rather than a single mixed
// most-recent stream. Not cached under the same key as the unfiltered
// fetch (different Rainforest query = different result set).
export async function getAmazonReviewsByStars(asin: string, reviewStars: string, pages = 2): Promise<ReviewSetResult> {
  if (!hasRainforestKey) return { status: "error", reviews: [], errorMessage: "Rainforest not configured" };
  if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) return { status: "error", reviews: [], errorMessage: "Invalid or missing ASIN" };
  const cleanAsin = asin.toUpperCase();

  const pageNumbers = Array.from({ length: pages }, (_, i) => i + 1);
  const results = await Promise.all(pageNumbers.map(p => fetchReviewsPage(cleanAsin, p, reviewStars)));
  return combineFetchResults(results);
}

// Fetches most-recent reviews across enough pages to cover the last 90
// days, bounded to MAX_PAGES so a slow-moving listing (few reviews/day)
// can't turn this into an unbounded crawl. Stops early once a page's
// oldest review already falls outside the window.
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_RECENT_SENTIMENT_PAGES = 5;

export async function getRecentReviews(asin: string, referenceDate: Date): Promise<ReviewSetResult> {
  if (!hasRainforestKey) return { status: "error", reviews: [], errorMessage: "Rainforest not configured" };
  if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) return { status: "error", reviews: [], errorMessage: "Invalid or missing ASIN" };
  const cleanAsin = asin.toUpperCase();
  const cutoff = referenceDate.getTime() - NINETY_DAYS_MS;

  const collected: AmazonReview[] = [];
  const pageResults: ReviewSetResult[] = [];

  for (let page = 1; page <= MAX_RECENT_SENTIMENT_PAGES; page++) {
    const result = await fetchReviewsPage(cleanAsin, page);
    pageResults.push(result);

    if (result.status === "error") {
      if (page === 1) return combineFetchResults(pageResults); // endpoint itself unavailable
      break; // later page failed after earlier ones succeeded — stop, keep what we have
    }
    if (result.reviews.length === 0) break;
    collected.push(...result.reviews);

    const oldestOnPage = result.reviews
      .map(r => (r.date ? new Date(r.date).getTime() : NaN))
      .filter(t => !isNaN(t))
      .sort((a, b) => a - b)[0];
    if (oldestOnPage !== undefined && oldestOnPage < cutoff) break;
  }

  const filtered = collected.filter(r => {
    if (!r.date) return false;
    const t = new Date(r.date).getTime();
    return !isNaN(t) && t >= cutoff;
  });

  const combined = combineFetchResults(pageResults);
  return { status: combined.status, reviews: filtered, errorMessage: combined.errorMessage };
}

// Distinguishes "the request itself failed / the endpoint is unavailable"
// (status: "error" — caller should surface "Live Amazon data unavailable",
// never substitute anything) from "the request succeeded and there just
// aren't many reviews" (status: "empty", reviews: []) — those must not be
// treated the same. `reviewStars` (Rainforest's own param, e.g.
// "five_star,four_star" or "one_star,two_star") lets callers pull a
// specific sentiment slice instead of the default unfiltered most-recent
// stream — used by the Strengths (positive) and Weaknesses (negative)
// passes in amazon-review-analysis.ts.
async function fetchReviewsPage(cleanAsin: string, page: number, reviewStars?: string): Promise<ReviewSetResult> {
  const t0 = Date.now();
  try {
    const url = new URL("https://api.rainforestapi.com/request");
    url.searchParams.set("api_key", process.env.RAINFOREST_API_KEY!);
    url.searchParams.set("type", "reviews");
    url.searchParams.set("asin", cleanAsin);
    url.searchParams.set("amazon_domain", "amazon.com");
    url.searchParams.set("sort_by", "most_recent");
    url.searchParams.set("page", String(page));
    if (reviewStars) url.searchParams.set("review_stars", reviewStars);

    const data = await fetchWithRetry(url.toString());
    if (!data.request_info?.success || !Array.isArray(data.reviews)) {
      const errorMessage = data.request_info?.message || "request_info.success=false";
      logCall("rainforest", { op: "reviews", asin: cleanAsin, page, reviewStars, requestSuccess: false, outcome: "error", elapsedMs: Date.now() - t0, errorMessage });
      return { status: "error", reviews: [], errorMessage };
    }

    const reviews = data.reviews.map((r: any) => ({
      title: r.title || "",
      body: r.body || "",
      rating: r.rating ?? null,
      date: r.date?.utc || r.date?.raw || null,
      verifiedPurchase: !!r.verified_purchase,
    })).filter((r: AmazonReview) => r.body.trim().length > 0);

    logCall("rainforest", { op: "reviews", asin: cleanAsin, page, reviewStars, requestSuccess: true, outcome: reviews.length ? "ok" : "empty", itemCount: reviews.length, elapsedMs: Date.now() - t0 });
    return { status: reviews.length ? "ok" : "empty", reviews };
  } catch (err: any) {
    const httpStatus = errStatus(err);
    const errorMessage = err instanceof RainforestAuthError
      ? `Rainforest auth/credit error${httpStatus ? ` (HTTP ${httpStatus})` : ""}`
      : String(err?.message ?? err);
    logCall("rainforest", { op: "reviews", asin: cleanAsin, page, reviewStars, httpStatus, outcome: "error", elapsedMs: Date.now() - t0, errorMessage });
    return { status: "error", reviews: [], errorMessage };
  }
}
