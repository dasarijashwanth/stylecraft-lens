// lib/legacy-brand-discovery.ts
// Brand-targeted Amazon discovery for the curated legacy-brand registry
// (lib/db/legacy-brands.ts) — replaces open-ended AI brand judgment for
// Phase 1's legacy competitor slots with a deterministic, priority-ordered
// search per enabled brand, gated by the SAME price-band rules already
// used everywhere else (lib/price-band.ts, unchanged).
import { searchAmazonCategory, CategorySearchResult } from "./rainforest";
import { computePriceBand, isWithinBand } from "./price-band";
import { competitorMatchesCategory } from "./category-synonyms";
import type { IdentityCard } from "./product-identification";
import type { LegacyBrandRow } from "./db/legacy-brands";
import type { CategorySlug } from "./legacy-brand-registry";

// Hard ceiling on this pre-pass alone — inserted BEFORE Phase 1's existing
// AI call, which itself has no time-budget gate on its OpenAI leg (only
// Gemini's does, since nothing used to run first). Without this, a slow
// widen-step sweep across many brands could push the combined phase past
// Vercel's 60s ceiling, which fails as an uncatchable platform kill rather
// than a normal exception.
export const CURATED_BRAND_SEARCH_TIME_BUDGET_MS = 15_000;

const WIDEN_PCT_LABELS = [30, 40, 50];

export type BrandProgressStatus = "searching" | "found" | "not_found";

export interface BrandProgressEntry {
  brand: string;
  status: BrandProgressStatus;
  price?: string | null;
  reason?: string | null;
  // Best-effort LIVE hint only — true when the motor-first query (not the
  // plain fallback) is what actually produced this brand's match. The
  // authoritative motor match tier (exact/adjacent/different/unverified)
  // is computed properly downstream by lib/analysisEngine.ts's
  // selectByCompositeScore against the real motor taxonomy; this is just
  // what the in-progress panel can show without duplicating that logic.
  motorMatched?: boolean;
}

export interface CuratedBrandCandidate {
  name: string;
  brand: string;
  tier: "legacy";
  asin: string;
  amazon_url: string;
  price: string;
  price_raw: number;
  rating: string;
  review_count: string;
  monthly_sales: string | null;
  bsr_rank: null;
  initials: string;
  key_features: never[];
  strengths: never[];
  weaknesses: never[];
  recent_news: never[];
  top_feature_summary: string;
  verified_by_rainforest: true;
  curated_brand: true;
  registry_brand: string;
}

// Duplicated deliberately rather than exporting the private helper from
// lib/analysisEngine.ts — matches this codebase's existing precedent
// (scripts/backfill-amazon-fields.ts does the same for this ~10-line
// helper) and avoids a dependency from this file back into the engine.
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

// Accent/typography/casing-normalized, word-boundary token match —
// stricter than lib/category-synonyms.ts's plain substring check (fine for
// low-stakes category words), since brand identity is higher-stakes: a
// naive .includes() on short aliases like "T3"/"JRL" risks matching inside
// an unrelated SKU/model token.
export function normalizeBrandToken(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritic combining marks (e.g. \u00e9 -> e)
    .replace(/[\u2018\u2019]/g, "'") // curly quotes -> straight apostrophe
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

export function brandMatchesTitle(title: string, brandName: string, aliases: string[] = []): boolean {
  const titleTokens = new Set(normalizeBrandToken(title).split(/\s+/).filter(Boolean));
  return [brandName, ...aliases].some(candidate => {
    const candidateTokens = normalizeBrandToken(candidate).split(/\s+/).filter(Boolean);
    return candidateTokens.length > 0 && candidateTokens.every(t => titleTokens.has(t));
  });
}

// Prefer an audience-appropriate alias for the search term itself when the
// resolved category is a Professional list (e.g. search "BaBylissPRO"
// rather than plain "BaByliss") — reduces surfacing the wrong sub-line at
// the source; price-band + category filtering are defense-in-depth on top
// of this, not a substitute for it.
function pickSearchAlias(brand: LegacyBrandRow, isProfessional: boolean): string {
  if (isProfessional) {
    const proAlias = brand.aliases.find(a => /pro/i.test(a));
    if (proAlias) return proAlias;
  }
  return brand.brand_name;
}

function toCandidate(result: CategorySearchResult, brand: LegacyBrandRow): CuratedBrandCandidate {
  return {
    name: result.title.length > 100 ? `${result.title.slice(0, 100)}…` : result.title,
    brand: brand.brand_name,
    tier: "legacy",
    asin: result.asin,
    amazon_url: `https://www.amazon.com/dp/${result.asin}`,
    price: result.price,
    price_raw: result.price_raw as number,
    rating: result.rating,
    review_count: result.reviewsTotal,
    monthly_sales: result.monthlyStr,
    bsr_rank: null,
    initials: brand.brand_name.slice(0, 2).toUpperCase(),
    key_features: [],
    strengths: [],
    weaknesses: [],
    recent_news: [],
    top_feature_summary: "",
    verified_by_rainforest: true,
    curated_brand: true,
    registry_brand: brand.brand_name,
  };
}

export type IdentityForDiscovery = Pick<IdentityCard, "category" | "subcategory">;

// Loops widenStep 0->2 (the EXACT existing ±30/40/50% legacy bands from
// lib/price-band.ts, unchanged), searching only brands not yet matched at
// each step, until >=5 brands are matched or all 3 steps are exhausted or
// the time budget runs out. Reuses search-time price_raw directly (no
// second type=product lookup — enrichCompetitorsWithRainforest already
// skips re-verifying anything tagged verified_by_rainforest:true, so a
// redundant lookup here would just double Rainforest cost for nothing).
export async function searchCuratedLegacyBrands(
  brands: LegacyBrandRow[],
  identity: IdentityForDiscovery,
  targetPriceRaw: number,
  categorySlug: CategorySlug,
  onBrandProgress?: (entries: BrandProgressEntry[]) => Promise<void> | void,
  // Testability hook only — production callers never pass this, always
  // getting the real CURATED_BRAND_SEARCH_TIME_BUDGET_MS. Lets offline
  // verification exercise the time-budget cutoff path deterministically
  // instead of waiting out a real 15s window.
  timeBudgetMsOverride?: number,
  // Motor type is priority #1 (Part 2.1) — when known, each brand is
  // searched motor-first ("{brand} {motor} {subcategory}") before falling
  // back to the plain query, so a brand's same-motor model is found
  // directly rather than relying on price/category filtering alone to
  // surface it.
  ourMotorLabel?: string | null
): Promise<CuratedBrandCandidate[]> {
  const subcategory = identity.subcategory || identity.category || "";
  const isProfessional = categorySlug.includes("professional");
  const timeBudgetMs = timeBudgetMsOverride ?? CURATED_BRAND_SEARCH_TIME_BUDGET_MS;
  const startTime = Date.now();

  const matched = new Map<string, CuratedBrandCandidate>();
  const progressByBrand = new Map<string, BrandProgressEntry>(
    brands.map(b => [b.brand_name, { brand: b.brand_name, status: "searching" as BrandProgressStatus }])
  );

  async function emitProgress() {
    await onBrandProgress?.(Array.from(progressByBrand.values()));
  }
  await emitProgress();

  widenLoop: for (let widenStep = 0; widenStep <= 2; widenStep++) {
    if (matched.size >= 5) break;

    if (Date.now() - startTime > timeBudgetMs) {
      progressByBrand.forEach(entry => {
        if (entry.status === "searching") {
          entry.status = "not_found";
          entry.reason = "Not searched — time budget reached";
        }
      });
      break widenLoop;
    }

    const unmatched = brands.filter(b => !matched.has(b.brand_name));
    if (unmatched.length === 0) break;

    const band = computePriceBand(targetPriceRaw, "legacy", widenStep);

    await mapWithConcurrency(unmatched, 3, async (brand) => {
      const alias = pickSearchAlias(brand, isProfessional);
      const queries = ourMotorLabel
        ? [`${alias} ${ourMotorLabel} ${subcategory}`.trim(), `${alias} ${subcategory}`.trim()]
        : [`${alias} ${subcategory}`.trim()];

      let inBand: CategorySearchResult[] = [];
      let matchedViaMotorQuery = false;
      for (let qi = 0; qi < queries.length; qi++) {
        const results = await searchAmazonCategory(queries[qi], 8);
        inBand = results.filter(r =>
          r.price_raw != null &&
          isWithinBand(r.price_raw, band) &&
          brandMatchesTitle(r.title, brand.brand_name, brand.aliases) &&
          competitorMatchesCategory(r.title, identity.category || "", identity.subcategory || undefined)
        );
        if (inBand.length > 0) {
          matchedViaMotorQuery = !!ourMotorLabel && qi === 0;
          break;
        }
      }

      const entry = progressByBrand.get(brand.brand_name)!;
      if (inBand.length > 0) {
        const best = inBand.reduce((a, b) =>
          Math.abs((a.price_raw as number) - targetPriceRaw) < Math.abs((b.price_raw as number) - targetPriceRaw) ? a : b
        );
        matched.set(brand.brand_name, toCandidate(best, brand));
        entry.status = "found";
        entry.price = best.price;
        entry.motorMatched = matchedViaMotorQuery;
        entry.reason = widenStep > 0 ? `Found within widened band (±${WIDEN_PCT_LABELS[widenStep]}%)` : null;
      } else if (widenStep === 2) {
        entry.status = "not_found";
        entry.reason = "No in-band product found";
      }
    });

    await emitProgress();
  }

  await emitProgress();
  return Array.from(matched.values());
}
