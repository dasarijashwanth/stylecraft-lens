// lib/brand-site-discovery.ts
// Brand-official-website discovery — searched FIRST, before Amazon, for
// each curated legacy brand's product (lib/legacy-brand-discovery.ts calls
// this concurrently with its existing Amazon widen-loop, not before/after
// it). This exists because a legacy pro brand's product that isn't sold on
// Amazon at all could never become a competitor before — Amazon was the
// only source.
//
// There is no verified `site:`-scoped web-search capability anywhere in
// this codebase (nothing has ever tested whether OpenAI's web_search tool
// actually honors a `site:{domain}` hint). This module treats that hint as
// best-effort only: it fires the hinted query, then STRICTLY requires the
// returned URL's hostname to match one of the brand's registered
// official_domains before accepting anything as brand-site-sourced — the
// same "don't trust the query, verify the result" discipline
// brandMatchesTitle/assertToolType already use elsewhere in this codebase.
import { isSupabaseConfigured, supabaseAdmin } from "./supabase";
import { hasOpenAIKey, searchAndExtractJson } from "./openai";
import { scrapeProductPage } from "./scrape";
import { resolveCacheKey } from "./product-cache-key";
import { insertProvenance } from "./db/section-provenance";
import { parsePriceToNumber } from "./pricing-analysis";
import { getToolTypeLabel, type ToolType } from "./tool-type-taxonomy";
import type { LegacyBrandRow } from "./db/legacy-brands";
import type { ToolTypeRow } from "./db/tool-types";

export interface BrandSiteResult {
  url: string;
  title: string;
  price: string | null;
  price_raw: number | null;
  // Title + description + a raw body-text sample, folded into one string
  // shaped exactly like extractCompetitorMotorType's expected input
  // (lib/motor-extraction.ts) — no new motor-matching logic needed here,
  // that existing call finds real evidence for free once real text exists.
  description: string;
  retrieved_at: string;
}

// Same amazon_cache table + cache_type-column pattern already used by
// app/api/product-data/key-features/[asin]/route.ts's getCachedFeatures/
// setCachedFeatures — Supabase-only (no memoryDb fallback), matching that
// table's existing convention exactly.
const BRAND_SITE_TTL_MS = 24 * 60 * 60 * 1000;

async function getCachedBrandSite(cacheKey: string): Promise<BrandSiteResult | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabaseAdmin.from("amazon_cache").select("payload, fetched_at").eq("asin", cacheKey).eq("cache_type", "brand_site").maybeSingle();
  if (data && Date.now() - new Date(data.fetched_at).getTime() < BRAND_SITE_TTL_MS) {
    return data.payload as BrandSiteResult;
  }
  return null;
}

async function setCachedBrandSite(cacheKey: string, result: BrandSiteResult): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    await supabaseAdmin.from("amazon_cache").upsert(
      { asin: cacheKey, cache_type: "brand_site", payload: result, fetched_at: new Date().toISOString() },
      { onConflict: "asin,cache_type" }
    );
  } catch (e) {
    console.warn("Failed to cache brand-site discovery result:", e);
  }
}

// The one real gate: never trust the site:-hinted query alone — only a
// URL whose actual hostname matches a registered domain (or a subdomain of
// one) counts as brand-site-sourced.
function urlMatchesDomain(url: string, domains: string[]): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return domains.some(d => {
    const norm = d.toLowerCase().trim().replace(/^www\./, "").replace(/^https?:\/\//, "");
    return !!norm && (hostname === norm || hostname.endsWith(`.${norm}`));
  });
}

// Duplicated deliberately (matches lib/legacy-brand-discovery.ts's own
// stated precedent for this exact ~10-line helper, to avoid a dependency
// from this file back into that one or into the engine).
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface BrandSiteAttemptContext {
  toolType: ToolType;
  toolTypes: ToolTypeRow[];
  motorLabel?: string | null;
  analysisId?: string | null;
}

// Tries each of the brand's registered official_domains in order, stopping
// at the first usable hit. Best-effort throughout: never throws, returns
// null on any failure/miss — the caller's Amazon leg is the concurrent
// backstop, so a brand-site miss is never fatal to that brand's slot.
export async function attemptBrandSite(brand: LegacyBrandRow, ctx: BrandSiteAttemptContext): Promise<BrandSiteResult | null> {
  const domains = (brand.official_domains || []).filter(Boolean);
  if (domains.length === 0 || !hasOpenAIKey) return null;

  const toolTypeWord = getToolTypeLabel(ctx.toolType, ctx.toolTypes).toLowerCase() || "product";
  const cacheKey = resolveCacheKey("", `brandsite:${brand.brand_name}:${domains.join(",")}:${ctx.toolType}:${ctx.motorLabel || ""}`);

  const cached = await getCachedBrandSite(cacheKey);
  if (cached) return cached;

  for (const domain of domains) {
    const startedAt = Date.now();
    const query = ctx.motorLabel ? `site:${domain} ${ctx.motorLabel} ${toolTypeWord}` : `site:${domain} ${toolTypeWord}`;

    try {
      const { data, citations } = await searchAndExtractJson<{ urls?: string[] }>(
        `You are searching ONLY within ${brand.brand_name}'s official website (${domain}). Find up to 3 real product page URLs, actually sold on this exact domain, for a ${toolTypeWord}${ctx.motorLabel ? ` using ${ctx.motorLabel} motor technology` : ""}. Never invent a URL — only ones you actually found via search. Return ONLY valid JSON: {"urls": ["https://...", ...]}`,
        query,
        6_000,
        2
      );
      const candidateUrls = [...(data?.urls || []), ...citations.map(c => c.url)].filter(Boolean);
      const onDomainUrl = candidateUrls.find(u => urlMatchesDomain(u, [domain]));

      if (!onDomainUrl) {
        await logAttempt(cacheKey, brand.brand_name, ctx.analysisId, domain, query, "empty", startedAt);
        continue;
      }

      const scraped = await scrapeProductPage(onDomainUrl, { aiFallback: false });
      if (!scraped || (!scraped.title && !scraped.description)) {
        await logAttempt(cacheKey, brand.brand_name, ctx.analysisId, domain, query, "empty", startedAt, onDomainUrl);
        continue;
      }

      const description = [scraped.title, scraped.description, scraped.raw?.bodyTextSample].filter(Boolean).join(" ");
      const result: BrandSiteResult = {
        url: onDomainUrl,
        title: scraped.title || brand.brand_name,
        price: scraped.price || null,
        price_raw: scraped.price ? parsePriceToNumber(scraped.price) : null,
        description,
        retrieved_at: new Date().toISOString(),
      };

      await setCachedBrandSite(cacheKey, result);
      await logAttempt(cacheKey, brand.brand_name, ctx.analysisId, domain, query, "success", startedAt, onDomainUrl);
      return result;
    } catch (err: any) {
      await logAttempt(cacheKey, brand.brand_name, ctx.analysisId, domain, query, "error", startedAt, undefined, err?.message || String(err));
    }
  }

  return null;
}

// Emerging/indie brands aren't in the curated legacy_brands registry (by
// definition — that's what makes them "emerging"), so there's no
// admin-maintained official_domains list to search against the way
// attemptBrandSite does for legacy brands. Best-effort alternative: search
// for the brand's own official site directly, then verify the result's
// hostname plausibly matches the brand name (never trust the query alone —
// same discipline as urlMatchesDomain above, just fuzzy instead of an exact
// registered-domain match since there's no admin-curated list here).
function hostnameLooksLikeBrand(url: string, brandName: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  const domainWord = (hostname.split(".")[0] || "").replace(/[^a-z0-9]/g, "");
  const brandWord = brandName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!domainWord || !brandWord) return false;
  return domainWord.includes(brandWord) || brandWord.includes(domainWord);
}

// Only worth calling for a candidate that Rainforest enrichment left with
// zero grounding data at all (see the caller in lib/analysisEngine.ts) —
// keeps this rare, deliberately, since it's a real added-latency operation
// and most candidates already resolve motor type from cheaper sources.
export async function attemptBrandSiteForEmergingBrand(brandName: string, ctx: BrandSiteAttemptContext): Promise<BrandSiteResult | null> {
  if (!hasOpenAIKey || !brandName) return null;
  const toolTypeWord = getToolTypeLabel(ctx.toolType, ctx.toolTypes).toLowerCase() || "product";
  const cacheKey = resolveCacheKey("", `brandsite-emerging:${brandName}:${ctx.toolType}:${ctx.motorLabel || ""}`);

  const cached = await getCachedBrandSite(cacheKey);
  if (cached) return cached;

  const startedAt = Date.now();
  const query = `${brandName} official site ${toolTypeWord}`;
  try {
    const { data, citations } = await searchAndExtractJson<{ urls?: string[] }>(
      `Find the OFFICIAL brand website (never Amazon, never a retailer, never a review/roundup site) for the brand "${brandName}", specifically a product page for a ${toolTypeWord}${ctx.motorLabel ? ` using ${ctx.motorLabel} motor technology` : ""}. Never invent a URL — only ones you actually found via search. Return ONLY valid JSON: {"urls": ["https://...", ...]}`,
      query,
      6_000,
      2
    );
    const candidateUrls = [...(data?.urls || []), ...citations.map(c => c.url)].filter(Boolean);
    const brandUrl = candidateUrls.find(u => hostnameLooksLikeBrand(u, brandName));

    if (!brandUrl) {
      await logAttempt(cacheKey, brandName, ctx.analysisId, "web-search", query, "empty", startedAt);
      return null;
    }

    const scraped = await scrapeProductPage(brandUrl, { aiFallback: false });
    if (!scraped || (!scraped.title && !scraped.description)) {
      await logAttempt(cacheKey, brandName, ctx.analysisId, "web-search", query, "empty", startedAt, brandUrl);
      return null;
    }

    const description = [scraped.title, scraped.description, scraped.raw?.bodyTextSample].filter(Boolean).join(" ");
    const result: BrandSiteResult = {
      url: brandUrl,
      title: scraped.title || brandName,
      price: scraped.price || null,
      price_raw: scraped.price ? parsePriceToNumber(scraped.price) : null,
      description,
      retrieved_at: new Date().toISOString(),
    };

    await setCachedBrandSite(cacheKey, result);
    await logAttempt(cacheKey, brandName, ctx.analysisId, "web-search", query, "success", startedAt, brandUrl);
    return result;
  } catch (err: any) {
    await logAttempt(cacheKey, brandName, ctx.analysisId, "web-search", query, "error", startedAt, undefined, err?.message || String(err));
    return null;
  }
}

// Batch entry point mirroring discoverBrandSiteCandidates — concurrency 4,
// shared deadline, fail-open per brand.
export async function discoverBrandSiteCandidatesForEmerging(
  brandNames: string[],
  ctx: BrandSiteAttemptContext,
  timeBudgetMsOverride?: number
): Promise<Map<string, BrandSiteResult>> {
  const timeBudgetMs = timeBudgetMsOverride ?? BRAND_SITE_PASS_TIME_BUDGET_MS;
  const deadline = Date.now() + timeBudgetMs;
  const distinctNames = Array.from(new Set(brandNames.filter(Boolean)));
  if (distinctNames.length === 0 || !hasOpenAIKey) return new Map();

  async function attemptWithDeadline(brandName: string): Promise<BrandSiteResult | null> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), remaining));
    return Promise.race([attemptBrandSiteForEmergingBrand(brandName, ctx), timeout]);
  }

  const results = await mapWithConcurrency(distinctNames, 4, async brandName => ({
    brandName,
    result: await attemptWithDeadline(brandName),
  }));

  const out = new Map<string, BrandSiteResult>();
  for (const { brandName, result } of results) {
    if (result) out.set(brandName, result);
  }
  return out;
}

async function logAttempt(
  cacheKey: string, brandName: string, analysisId: string | null | undefined, domain: string, query: string,
  outcome: "success" | "empty" | "error", startedAt: number, sourceUrl?: string, errorMessage?: string
): Promise<void> {
  try {
    await insertProvenance({
      productKey: cacheKey,
      section: "brand_site_discovery",
      analysisId: analysisId ?? null,
      productName: brandName,
      tiers: [{ tier: domain, attempted: true, outcome, itemCount: outcome === "success" ? 1 : 0, sourceUrls: sourceUrl ? [sourceUrl] : [], elapsedMs: Date.now() - startedAt, errorMessage }],
      queries: [{ tier: domain, query, outcome, verified: true, elapsedMs: Date.now() - startedAt }],
    });
  } catch (e) {
    console.warn("Failed to persist brand-site discovery provenance:", e);
  }
}

// One-shot per invocation (NOT repeated per price-widen-step — finding the
// official product page doesn't need re-searching at 3 different price
// tolerances the way an Amazon category search does), concurrency 4, with
// a shared deadline so a slow brand can't blow the budget for the rest —
// any attempt still in flight when the deadline passes resolves to null
// (fail-open "no brand-site hit" for that brand), matching this codebase's
// existing CURATED_BRAND_SEARCH_TIME_BUDGET_MS fail-open convention.
export const BRAND_SITE_PASS_TIME_BUDGET_MS = 12_000;

export async function discoverBrandSiteCandidates(
  brands: LegacyBrandRow[],
  ctx: BrandSiteAttemptContext,
  timeBudgetMsOverride?: number
): Promise<Map<string, BrandSiteResult>> {
  const timeBudgetMs = timeBudgetMsOverride ?? BRAND_SITE_PASS_TIME_BUDGET_MS;
  const deadline = Date.now() + timeBudgetMs;
  const withDomains = brands.filter(b => (b.official_domains || []).length > 0);
  if (withDomains.length === 0 || !hasOpenAIKey) return new Map();

  async function attemptWithDeadline(brand: LegacyBrandRow): Promise<BrandSiteResult | null> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), remaining));
    return Promise.race([attemptBrandSite(brand, ctx), timeout]);
  }

  const results = await mapWithConcurrency(withDomains, 4, async brand => ({
    brand: brand.brand_name,
    result: await attemptWithDeadline(brand),
  }));

  const out = new Map<string, BrandSiteResult>();
  for (const { brand, result } of results) {
    if (result) out.set(brand, result);
  }
  return out;
}
