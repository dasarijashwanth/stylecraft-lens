// lib/legacy-brand-discovery.ts
// Brand-targeted discovery for the curated legacy-brand registry
// (lib/db/legacy-brands.ts) — replaces open-ended AI brand judgment for
// Phase 1's legacy competitor slots with a deterministic, priority-ordered
// search per enabled brand, gated by the SAME price-band rules already
// used everywhere else (lib/price-band.ts, unchanged).
//
// Each brand is searched on TWO sources concurrently: its own official
// website FIRST-in-spirit (lib/brand-site-discovery.ts — a brand's product
// that isn't sold on Amazon at all can still become a real competitor) and
// Amazon (this file's own widen-step loop, unchanged). Both run at once
// (not stacked) so brand-site discovery never slows down or blocks the
// existing Amazon path; results are merged per brand into one hybrid
// candidate (buildHybridCandidate) carrying a `sources` record of which
// source(s) actually contributed.
import { searchAmazonCategory, CategorySearchResult } from "./rainforest";
import { computePriceBand, isWithinBand } from "./price-band";
import { assertToolType, getToolTypeLabel } from "./tool-type-taxonomy";
import { discoverBrandSiteCandidates, BrandSiteResult, BRAND_SITE_PASS_TIME_BUDGET_MS } from "./brand-site-discovery";
import type { IdentityCard } from "./product-identification";
import type { LegacyBrandRow } from "./db/legacy-brands";
import type { CategorySlug, ResolvedLegacyBrand } from "./legacy-brand-registry";
import type { ToolTypeRow } from "./db/tool-types";

// Hard ceiling on the Amazon widen-loop leg specifically — inserted BEFORE
// Phase 1's existing AI call, which itself has no time-budget gate on its
// OpenAI leg. Raised from 15s to 20s: the brand-site pass now runs
// CONCURRENTLY (its own independent BRAND_SITE_PASS_TIME_BUDGET_MS budget,
// ~12s), so total wall time for this whole module is ~max(12s, 20s) ≈ 20s,
// not a sum — still comfortably inside Vercel's 60s ceiling alongside the
// rest of Phase 1's work (see lib/analysisEngine.ts's ROUTE_TIME_BUDGET_MS).
export const CURATED_BRAND_SEARCH_TIME_BUDGET_MS = 20_000;

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
  // Which source(s) actually produced this brand's final candidate —
  // additive field, set once both the brand-site and Amazon passes
  // resolve and are merged. Absent for a live "searching" entry.
  source?: "brand_site" | "amazon" | "both" | null;
}

export interface CompetitorSourceRecord {
  brand_site: { url: string; price: string | null; price_raw: number | null; retrieved_at: string } | null;
  amazon: { asin: string; url: string; price: string | null; price_raw: number | null; rating: string | null; review_count: string | null; bsr_rank: string | null; monthly_sales: string | null; retrieved_at: string } | null;
}

export interface CuratedBrandCandidate {
  name: string;
  brand: string;
  tier: "legacy";
  asin: string;
  amazon_url: string;
  price: string;
  price_raw: number | null;
  rating: string;
  review_count: string;
  monthly_sales: string | null;
  bsr_rank: string | null;
  initials: string;
  key_features: never[];
  strengths: never[];
  weaknesses: never[];
  recent_news: never[];
  top_feature_summary: string;
  verified_by_rainforest: true;
  curated_brand: true;
  registry_brand: string;
  // Populated only when this brand came through a "both" target-market
  // merge (lib/legacy-brand-registry.ts's resolveLegacyBrandsForIdentity)
  // — which list(s) it was found on, surfaced in provenance/"Why this
  // competitor" text. Absent for the plain pro/consumer single-list case.
  registry_source_lists?: ("pro" | "retail")[] | null;
  // Real listing/page text (brand-site scrape, when one contributed) —
  // folded in here so extractCompetitorMotorType (lib/motor-extraction.ts)
  // and matchesDifferentiator (lib/differentiator-match.ts), both already
  // called generically by selectByCompositeScore, find real evidence
  // without any new motor-matching logic in this file.
  description?: string;
  // Which source(s) actually produced this candidate, and what each one
  // independently found — brand-site specs/price are authoritative for
  // motor/technical data; Amazon supplies live rating/reviews/BSR when a
  // listing exists. `amazon: null` is fully supported (a real product that
  // simply isn't sold on Amazon at all).
  sources: CompetitorSourceRecord;
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

// Merges a brand's Amazon result (if any) and brand-site result (if any)
// into one hybrid candidate. Returns null only when NEITHER source found
// anything — a brand with zero results from either source simply
// contributes no candidate, exactly like today's "not_found" outcome.
function buildHybridCandidate(brand: LegacyBrandRow | ResolvedLegacyBrand, site: BrandSiteResult | null, amazon: CategorySearchResult | null): CuratedBrandCandidate | null {
  if (!site && !amazon) return null;

  // When both a brand-site MSRP and a live Amazon price exist, use the
  // LOWER of the two for the candidate's displayed/scored price (per the
  // "record both, band-check the lower" rule) — otherwise whichever one
  // resolved. selectByCompositeScore downstream still does the real
  // price-band gating against this resolved price; this file no longer
  // needs its own separate band check for the brand-site leg.
  let price: string | null = null;
  let price_raw: number | null = null;
  if (site?.price_raw != null && amazon?.price_raw != null) {
    if (amazon.price_raw <= site.price_raw) { price = amazon.price; price_raw = amazon.price_raw; }
    else { price = site.price; price_raw = site.price_raw; }
  } else if (amazon?.price_raw != null) {
    price = amazon.price; price_raw = amazon.price_raw;
  } else if (site?.price_raw != null) {
    price = site.price; price_raw = site.price_raw;
  }

  const rawName = amazon?.title || site?.title || brand.brand_name;
  const name = rawName.length > 100 ? `${rawName.slice(0, 100)}…` : rawName;

  return {
    name,
    brand: brand.brand_name,
    tier: "legacy",
    asin: amazon?.asin || "",
    amazon_url: amazon ? `https://www.amazon.com/dp/${amazon.asin}` : "",
    price: price || "—",
    price_raw,
    rating: amazon?.rating || "—",
    review_count: amazon?.reviewsTotal || "—",
    monthly_sales: amazon?.monthlyStr || null,
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
    registry_source_lists: (brand as ResolvedLegacyBrand).sourceLists ?? null,
    description: site?.description || "",
    sources: {
      brand_site: site ? { url: site.url, price: site.price, price_raw: site.price_raw, retrieved_at: site.retrieved_at } : null,
      amazon: amazon ? {
        asin: amazon.asin, url: `https://www.amazon.com/dp/${amazon.asin}`, price: amazon.price, price_raw: amazon.price_raw,
        rating: amazon.rating, review_count: amazon.reviewsTotal, bsr_rank: null, monthly_sales: amazon.monthlyStr,
        retrieved_at: new Date().toISOString(),
      } : null,
    },
  };
}

export type IdentityForDiscovery = Pick<IdentityCard, "category" | "subcategory" | "toolType">;

// Loops widenStep 0->2 (the EXACT existing ±30/40/50% legacy bands from
// lib/price-band.ts, unchanged), searching only brands not yet matched at
// each step, until >=5 brands are matched or all 3 steps are exhausted or
// the time budget runs out. Reuses search-time price_raw directly (no
// second type=product lookup — enrichCompetitorsWithRainforest already
// skips re-verifying anything tagged verified_by_rainforest:true, so a
// redundant lookup here would just double Rainforest cost for nothing).
export async function searchCuratedLegacyBrands(
  brands: ResolvedLegacyBrand[],
  identity: IdentityForDiscovery,
  targetPriceRaw: number,
  categorySlug: CategorySlug,
  toolTypes: ToolTypeRow[],
  onBrandProgress?: (entries: BrandProgressEntry[]) => Promise<void> | void,
  // Testability hook only — production callers never pass this, always
  // getting the real CURATED_BRAND_SEARCH_TIME_BUDGET_MS. Lets offline
  // verification exercise the time-budget cutoff path deterministically
  // instead of waiting out a real 20s window.
  timeBudgetMsOverride?: number,
  // Motor type is priority #1 — when known, each brand is searched
  // motor-first ("{brand} {motor} {subcategory}") before falling back to
  // the plain query, so a brand's same-motor model is found directly
  // rather than relying on price/category filtering alone to surface it.
  // Also threaded into the brand-site pass's own query.
  ourMotorLabel?: string | null,
  // Testability hook for the brand-site pass's independent budget, same
  // reasoning as timeBudgetMsOverride above.
  brandSiteTimeBudgetMsOverride?: number
): Promise<CuratedBrandCandidate[]> {
  const subcategory = identity.subcategory || identity.category || "";
  const isProfessional = categorySlug.includes("professional");
  const timeBudgetMs = timeBudgetMsOverride ?? CURATED_BRAND_SEARCH_TIME_BUDGET_MS;
  const startTime = Date.now();

  const amazonMatched = new Map<string, CategorySearchResult>();
  const progressByBrand = new Map<string, BrandProgressEntry>(
    brands.map(b => [b.brand_name, { brand: b.brand_name, status: "searching" as BrandProgressStatus }])
  );

  async function emitProgress() {
    await onBrandProgress?.(Array.from(progressByBrand.values()));
  }
  await emitProgress();

  // The brand-site pass runs CONCURRENTLY with the Amazon widen loop
  // below (Promise.all at the bottom), not before/after it — brand-site
  // discovery is a one-shot "find the official page" per brand, it
  // doesn't need to repeat per price-widen-step the way Amazon search does.
  const brandSitePromise = identity.toolType && identity.toolType !== "combo"
    ? discoverBrandSiteCandidates(brands, { toolType: identity.toolType, toolTypes, motorLabel: ourMotorLabel }, brandSiteTimeBudgetMsOverride ?? BRAND_SITE_PASS_TIME_BUDGET_MS)
    : Promise.resolve(new Map<string, BrandSiteResult>());

  const amazonWidenLoopPromise = (async () => {
    widenLoop: for (let widenStep = 0; widenStep <= 2; widenStep++) {
      if (amazonMatched.size >= 5) break;

      if (Date.now() - startTime > timeBudgetMs) {
        progressByBrand.forEach(entry => {
          if (entry.status === "searching") {
            entry.status = "not_found";
            entry.reason = "Not searched — time budget reached";
          }
        });
        break widenLoop;
      }

      const unmatched = brands.filter(b => !amazonMatched.has(b.brand_name));
      if (unmatched.length === 0) break;

      const band = computePriceBand(targetPriceRaw, "legacy", widenStep);

      await mapWithConcurrency(unmatched, 3, async (brand) => {
        const alias = pickSearchAlias(brand, isProfessional);
        // Tool-type word is explicit in the query (not left to whatever the
        // free-text subcategory happens to say) — "Wahl professional
        // trimmer" rather than relying on subcategory text alone, which the
        // original contamination bug showed can be ambiguous/combined
        // ("Hair Clippers & Trimmers"). Motor-first query still tried first
        // when known, each variant now carrying the tool-type word too.
        const toolTypeWord = identity.toolType && identity.toolType !== "combo" ? getToolTypeLabel(identity.toolType, toolTypes).toLowerCase() : "";
        const queries = ourMotorLabel
          ? [`${alias} ${ourMotorLabel} ${toolTypeWord} ${subcategory}`.trim(), `${alias} ${toolTypeWord} ${subcategory}`.trim()]
          : [`${alias} ${toolTypeWord} ${subcategory}`.trim()];

        let inBand: CategorySearchResult[] = [];
        let matchedViaMotorQuery = false;
        for (let qi = 0; qi < queries.length; qi++) {
          const results = await searchAmazonCategory(queries[qi], 8);
          inBand = results.filter(r => {
            if (r.price_raw == null || !isWithinBand(r.price_raw, band)) return false;
            if (!brandMatchesTitle(r.title, brand.brand_name, brand.aliases)) return false;
            // No identity.toolType (legacy analysis pre-dating this field)
            // — nothing strict to validate against, don't block.
            if (identity.toolType && !assertToolType(r.title, identity.toolType, toolTypes).ok) return false;
            return true;
          });
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
          amazonMatched.set(brand.brand_name, best);
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
  })();

  const [brandSiteResults] = await Promise.all([brandSitePromise, amazonWidenLoopPromise]);

  // Merge per brand and emit one final, source-labeled progress update —
  // the Amazon leg's own per-widen-step live emissions above are unchanged;
  // this is the pass that folds in what the concurrent brand-site pass
  // found, which the Amazon loop had no visibility into while it ran.
  const candidates: CuratedBrandCandidate[] = [];
  for (const brand of brands) {
    const site = brandSiteResults.get(brand.brand_name) || null;
    const amazon = amazonMatched.get(brand.brand_name) || null;
    const candidate = buildHybridCandidate(brand, site, amazon);
    const entry = progressByBrand.get(brand.brand_name)!;

    if (candidate) {
      candidates.push(candidate);
      entry.status = "found";
      entry.price = candidate.price === "—" ? entry.price ?? null : candidate.price;
      entry.source = site && amazon ? "both" : site ? "brand_site" : "amazon";
    } else if (entry.status !== "found") {
      entry.status = "not_found";
      entry.reason = entry.reason || "No match found on brand site or Amazon";
    }
  }

  await emitProgress();
  return candidates;
}
