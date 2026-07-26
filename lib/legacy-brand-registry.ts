// lib/legacy-brand-registry.ts
// Maps a product's Identity Card to one of the 4 curated legacy-brand
// registry categories (lib/db/legacy-brands.ts), so Phase 1 competitor
// discovery knows which curated brand list to search (see
// lib/legacy-brand-discovery.ts). This SUPERSEDES lib/known-brands-by-
// category.ts's non-binding hint only when a real category match exists —
// that file stays in place as the fallback for any category outside all 4
// registry lists (e.g. a genuinely unrelated/custom product).
import type { IdentityCard } from "./product-identification";
import { getCategoryBySlug, listBrandsForCategory, LegacyBrandRow } from "./db/legacy-brands";

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

// Pure, sync — resolves to one of the 4 registry categories, or null when
// nothing matches (mirrors getKnownBrandsHint's existing "no match -> null
// -> no hint" convention; never forces a default category onto an
// unrelated product). "both" defaults to the pro/professional list, per
// the spec's explicit "if ambiguous, default to the pro list" rule.
export function resolveRegistryCategorySlug(identity: IdentityForResolution): CategorySlug | null {
  const text = `${identity.category || ""} ${identity.subcategory || ""}`.toLowerCase();
  const isPro = identity.targetUser !== "consumer";

  if (textMatchesAny(text, CLIPPER_TRIMMER_SHAVER_KEYS)) {
    return isPro ? "legacy_professional_clippers" : "legacy_retail_clippers";
  }
  if (textMatchesAny(text, BEAUTY_KEYS)) {
    return isPro ? "professional_beauty" : "retail_beauty";
  }
  return null;
}

export interface ResolvedLegacyRegistry {
  categorySlug: CategorySlug;
  categoryName: string;
  brands: LegacyBrandRow[];
}

// Async wrapper — resolves the category, then reads its real (possibly
// admin-edited) name + enabled brands in priority order. Returns null both
// when the identity doesn't match any registry category AND when a
// category matches but has zero enabled brands (either way, Phase 1 should
// fall back to today's unmodified AI-judgment flow).
export async function resolveLegacyBrandsForIdentity(identity: IdentityForResolution): Promise<ResolvedLegacyRegistry | null> {
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
