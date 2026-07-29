// lib/db/legacy-brands.ts
// CRUD over brand_categories/legacy_brands — the curated, admin-editable
// registry that competitor discovery's Phase 1 (legacy/established
// competitors) now searches directly (lib/legacy-brand-discovery.ts) in
// priority order instead of relying purely on AI judgment. Same
// Supabase+memoryDb dual-path style as lib/db/deck-templates.ts. Unlike
// deck templates, the memoryDb path here is always pre-seeded with the 4
// default categories (see lib/memoryDb.ts's seedBrandRegistryDefaults) —
// this is real default configuration, not an empty admin-fills-it-in table.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockBrandCategory, MockLegacyBrand } from "@/lib/memoryDb";

export interface BrandCategoryRow {
  id: string;
  slug: string;
  name: string;
  product_types: string[];
  audience: string | null;
  created_at: string;
}

export interface LegacyBrandRow {
  id: string;
  category_id: string;
  brand_name: string;
  aliases: string[];
  // Brand's own official website domain(s) (e.g. "wahlpro.com") — searched
  // FIRST by lib/brand-site-discovery.ts, before Amazon, so a legacy pro
  // product that isn't on Amazon at all can still become a competitor.
  // Admin-editable at /dashboard/admin/legacy-brands, same as aliases.
  official_domains: string[];
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mockCategoryToRow(c: MockBrandCategory): BrandCategoryRow {
  return { id: c.id, slug: c.slug, name: c.name, product_types: c.productTypes, audience: c.audience, created_at: c.createdAt.toISOString() };
}

function mockBrandToRow(b: MockLegacyBrand): LegacyBrandRow {
  return { id: b.id, category_id: b.categoryId, brand_name: b.brandName, aliases: b.aliases, official_domains: b.officialDomains, enabled: b.enabled, sort_order: b.sortOrder, created_at: b.createdAt.toISOString(), updated_at: b.updatedAt.toISOString() };
}

export async function listCategories(): Promise<BrandCategoryRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("brand_categories").select("*").order("name");
    if (error) throw error;
    return data || [];
  }
  return [...memoryDb.brandCategories].sort((a, b) => a.name.localeCompare(b.name)).map(mockCategoryToRow);
}

export async function getCategoryBySlug(slug: string): Promise<BrandCategoryRow | null> {
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin.from("brand_categories").select("*").eq("slug", slug).maybeSingle();
    return data;
  }
  const row = memoryDb.brandCategories.find(c => c.slug === slug);
  return row ? mockCategoryToRow(row) : null;
}

export async function listBrandsForCategory(categoryId: string): Promise<LegacyBrandRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("legacy_brands").select("*").eq("category_id", categoryId).order("sort_order");
    if (error) throw error;
    return data || [];
  }
  return memoryDb.legacyBrands
    .filter(b => b.categoryId === categoryId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(mockBrandToRow);
}

// Priority-ordered, enabled-only — exactly the list
// lib/legacy-brand-discovery.ts searches. Resolves by category SLUG (not
// id) since that's what lib/legacy-brand-registry.ts's pure resolver
// returns from the product's Identity Card.
export async function getEnabledLegacyBrandsForCategory(slug: string): Promise<LegacyBrandRow[]> {
  const category = await getCategoryBySlug(slug);
  if (!category) return [];
  const brands = await listBrandsForCategory(category.id);
  return brands.filter(b => b.enabled).sort((a, b) => a.sort_order - b.sort_order);
}

export async function addBrand(categoryId: string, input: { brandName: string; aliases?: string[]; officialDomains?: string[] }): Promise<LegacyBrandRow> {
  if (isSupabaseConfigured) {
    const { data: existing } = await supabaseAdmin
      .from("legacy_brands")
      .select("sort_order")
      .eq("category_id", categoryId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = (existing?.sort_order ?? -1) + 1;
    const { data, error } = await supabaseAdmin
      .from("legacy_brands")
      .insert({ category_id: categoryId, brand_name: input.brandName, aliases: input.aliases || [], official_domains: input.officialDomains || [], sort_order: nextSort })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const now = new Date();
  const existingForCat = memoryDb.legacyBrands.filter(b => b.categoryId === categoryId);
  const nextSort = existingForCat.length ? Math.max(...existingForCat.map(b => b.sortOrder)) + 1 : 0;
  const row: MockLegacyBrand = {
    id: `lbrand_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    categoryId,
    brandName: input.brandName,
    aliases: input.aliases || [],
    officialDomains: input.officialDomains || [],
    enabled: true,
    sortOrder: nextSort,
    createdAt: now,
    updatedAt: now,
  };
  memoryDb.legacyBrands.push(row);
  return mockBrandToRow(row);
}

export async function updateBrand(
  brandId: string,
  patch: { brandName?: string; aliases?: string[]; officialDomains?: string[]; enabled?: boolean; sortOrder?: number }
): Promise<LegacyBrandRow | null> {
  if (isSupabaseConfigured) {
    const dbPatch: any = { updated_at: new Date().toISOString() };
    if (patch.brandName !== undefined) dbPatch.brand_name = patch.brandName;
    if (patch.aliases !== undefined) dbPatch.aliases = patch.aliases;
    if (patch.officialDomains !== undefined) dbPatch.official_domains = patch.officialDomains;
    if (patch.enabled !== undefined) dbPatch.enabled = patch.enabled;
    if (patch.sortOrder !== undefined) dbPatch.sort_order = patch.sortOrder;
    const { data, error } = await supabaseAdmin.from("legacy_brands").update(dbPatch).eq("id", brandId).select().single();
    if (error) throw error;
    return data;
  }

  const row = memoryDb.legacyBrands.find(b => b.id === brandId);
  if (!row) return null;
  if (patch.brandName !== undefined) row.brandName = patch.brandName;
  if (patch.aliases !== undefined) row.aliases = patch.aliases;
  if (patch.officialDomains !== undefined) row.officialDomains = patch.officialDomains;
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.sortOrder !== undefined) row.sortOrder = patch.sortOrder;
  row.updatedAt = new Date();
  return mockBrandToRow(row);
}

export async function deleteBrand(brandId: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("legacy_brands").delete().eq("id", brandId);
    if (error) throw error;
    return;
  }
  const idx = memoryDb.legacyBrands.findIndex(b => b.id === brandId);
  if (idx >= 0) memoryDb.legacyBrands.splice(idx, 1);
}

// orderedIds: brand ids in the new desired priority order — index becomes
// the new sort_order. Sequential per-row updates (no multi-row
// upsert-by-position via supabase-js), same low-concurrency-tolerant style
// already used by lib/db/deck-templates.ts's setActiveDeckTemplate (a rare,
// admin-only action, not a hot path).
export async function reorderBrands(categoryId: string, orderedIds: string[]): Promise<void> {
  if (isSupabaseConfigured) {
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await supabaseAdmin
        .from("legacy_brands")
        .update({ sort_order: i, updated_at: new Date().toISOString() })
        .eq("id", orderedIds[i])
        .eq("category_id", categoryId);
      if (error) throw error;
    }
    return;
  }

  orderedIds.forEach((id, i) => {
    const row = memoryDb.legacyBrands.find(b => b.id === id && b.categoryId === categoryId);
    if (row) {
      row.sortOrder = i;
      row.updatedAt = new Date();
    }
  });
}
