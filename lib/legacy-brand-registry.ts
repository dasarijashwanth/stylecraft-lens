// lib/legacy-brand-registry.ts
// Maps a product's Identity Card to one of the 4 curated legacy-brand
// registry categories (lib/db/legacy-brands.ts), so Phase 1 competitor
// discovery knows which curated brand list to search (see
// lib/legacy-brand-discovery.ts). This SUPERSEDES lib/known-brands-by-
// category.ts's non-binding hint only when a real category match exists —
// that file stays in place as the fallback for any category outside all 4
// registry lists (e.g. a genuinely unrelated/custom product).
import type { IdentityCard } from "./product-identification";
import { getCategoryBySlug, listBrandsForCategory, getEnabledLegacyBrandsForCategory, LegacyBrandRow } from "./db/legacy-brands";
// lib/legacy-brand-discovery.ts imports `CategorySlug` back from this file,
// but as `import type` only (erased at compile time) — so this runtime
// import of normalizeBrandToken does NOT create an actual module cycle.
import { normalizeBrandToken } from "./legacy-brand-discovery";

export type CategorySlug =
  | "legacy_professional_clippers"
  | "legacy_retail_clippers"
  | "professional_beauty"
  | "retail_beauty";

// Keyword families built from lib/category-synonyms.ts's vocabulary
// (which already treats "shaver" as its own key) — deliberately NOT
// lib/analysisEngine.ts's getCategoryFallbackCompetitors buckets (which
// excludes shaver on purpose, for a different reason) and NEVER
// context.industry, which only has 2 substring-overlapping values
// ("grooming-barbering"/"haircare-styling") — a hard-won existing lesson
// in this codebase (see that function's own header comment).
const CLIPPER_TRIMMER_SHAVER_KEYS = ["clipper", "trimmer", "shaver", "razor", "barber"];
const BEAUTY_KEYS = ["dryer", "blow dryer", "styler", "straighten", "flat iron", "hair iron", "curling iron", "curler", "wand", "brush", "haircare"];

function textMatchesAny(text: string, keys: string[]): boolean {
  return keys.some(k => text.includes(k));
}

type IdentityForResolution = Pick<IdentityCard, "category" | "subcategory" | "targetUser">;

type RegistryFamily = "clipper_trimmer_shaver" | "beauty";

// Shared by resolveRegistryCategorySlug (pro/retail single-slug case) and
// resolveFamilySlugPair (both-list-merge case) below — factored out so the
// two keyword-family checks live in exactly one place.
function resolveFamily(identity: Pick<IdentityForResolution, "category" | "subcategory">): RegistryFamily | null {
  const text = `${identity.category || ""} ${identity.subcategory || ""}`.toLowerCase();
  if (textMatchesAny(text, CLIPPER_TRIMMER_SHAVER_KEYS)) return "clipper_trimmer_shaver";
  if (textMatchesAny(text, BEAUTY_KEYS)) return "beauty";
  return null;
}

// Pure, sync — resolves to one of the 4 registry categories, or null when
// nothing matches (mirrors getKnownBrandsHint's existing "no match -> null
// -> no hint" convention; never forces a default category onto an
// unrelated product). "both" defaults to the pro/professional list, per
// the spec's explicit "if ambiguous, default to the pro list" rule — this
// single-slug resolution is UNCHANGED by the "both" merge below (still
// used as-is by lib/motor-taxonomy.ts's isMotorizedCategory, which only
// needs a non-null/null check, not the merged brand list itself).
export function resolveRegistryCategorySlug(identity: IdentityForResolution): CategorySlug | null {
  const family = resolveFamily(identity);
  const isPro = identity.targetUser !== "consumer";
  if (family === "clipper_trimmer_shaver") return isPro ? "legacy_professional_clippers" : "legacy_retail_clippers";
  if (family === "beauty") return isPro ? "professional_beauty" : "retail_beauty";
  return null;
}

const FAMILY_SLUG_PAIRS: Record<RegistryFamily, { pro: CategorySlug; retail: CategorySlug }> = {
  clipper_trimmer_shaver: { pro: "legacy_professional_clippers", retail: "legacy_retail_clippers" },
  beauty: { pro: "professional_beauty", retail: "retail_beauty" },
};

export interface ResolvedLegacyBrand extends LegacyBrandRow {
  // Populated ONLY for a "both" target-market resolution — which list(s)
  // this brand appeared on. A brand present on both lists (e.g. Wahl often
  // is) is deduped to a single entry tagged with both, never duplicated.
  // Absent for the plain pro/consumer single-list case.
  sourceLists?: ("pro" | "retail")[];
}

export interface ResolvedLegacyRegistry {
  categorySlug: CategorySlug;
  categoryName: string;
  brands: ResolvedLegacyBrand[];
}

// Async wrapper — resolves the category, then reads its real (possibly
// admin-edited) name + enabled brands in priority order. Returns null both
// when the identity doesn't match any registry category AND when a
// category matches but has zero enabled brands (either way, Phase 1 should
// fall back to today's unmodified AI-judgment flow).
//
// "both" is a distinct path: rather than picking one list by default (the
// single-slug resolveRegistryCategorySlug's pro-default), it fetches BOTH
// the pro and retail lists for the matched keyword family and merges them,
// deduping any brand that appears on both by its normalized name — so e.g.
// Wahl (present on both the professional and retail clipper lists) surfaces
// exactly once, tagged with both source lists instead of twice or dropped.
export async function resolveLegacyBrandsForIdentity(identity: IdentityForResolution): Promise<ResolvedLegacyRegistry | null> {
  if (identity.targetUser === "both") {
    const family = resolveFamily(identity);
    if (!family) return null;
    const pair = FAMILY_SLUG_PAIRS[family];

    const [proCategory, retailCategory, proBrands, retailBrands] = await Promise.all([
      getCategoryBySlug(pair.pro),
      getCategoryBySlug(pair.retail),
      getEnabledLegacyBrandsForCategory(pair.pro),
      getEnabledLegacyBrandsForCategory(pair.retail),
    ]);

    const merged = new Map<string, ResolvedLegacyBrand>();
    const mergeIn = (brands: LegacyBrandRow[], list: "pro" | "retail") => {
      for (const b of brands) {
        const key = normalizeBrandToken(b.brand_name);
        const existing = merged.get(key);
        if (existing) {
          if (!existing.sourceLists!.includes(list)) existing.sourceLists!.push(list);
        } else {
          merged.set(key, { ...b, sourceLists: [list] });
        }
      }
    };
    mergeIn(proBrands, "pro");
    mergeIn(retailBrands, "retail");

    const brands = Array.from(merged.values()).sort((a, b) => a.sort_order - b.sort_order);
    if (brands.length === 0) return null;

    // categorySlug/categoryName represent the pro list for display/
    // provenance labeling purposes only — sourceLists on each brand is what
    // actually communicates which list(s) it came from.
    return { categorySlug: pair.pro, categoryName: proCategory?.name || retailCategory?.name || "", brands };
  }

  const slug = resolveRegistryCategorySlug(identity);
  if (!slug) return null;

  const category = await getCategoryBySlug(slug);
  if (!category) return null;

  const brands = (await listBrandsForCategory(category.id))
    .filter(b => b.enabled)
    .sort((a, b) => a.sort_order - b.sort_order);
  if (brands.length === 0) return null;

  return { categorySlug: slug, categoryName: category.name, brands };
}
