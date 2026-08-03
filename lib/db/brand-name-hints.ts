// lib/db/brand-name-hints.ts
// CRUD over brand_name_hints — the admin-editable name-prefix -> brand map
// GTM's Manufacturer auto-detect cascade (lib/gtm-tier6-inference.ts) falls
// back to when a project has no catalog record to read `brand` from
// directly. Same Supabase+memoryDb dual-path style, and same "always
// pre-seeded real default configuration" precedent as lib/db/legacy-brands.ts
// (see lib/memoryDb.ts's seedBrandNameHintDefaults).
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockBrandNameHint } from "@/lib/memoryDb";

export interface BrandNameHintRow {
  id: string;
  brand: string;
  name_prefixes: string[];
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Guards against name_prefixes coming back absent on a row added before
// this column existed — same discipline as legacy-brands.ts's
// normalizeBrandRow.
function normalizeRow(row: any): BrandNameHintRow {
  return { ...row, name_prefixes: row.name_prefixes || [] };
}

function mockToRow(h: MockBrandNameHint): BrandNameHintRow {
  return {
    id: h.id,
    brand: h.brand,
    name_prefixes: h.namePrefixes,
    enabled: h.enabled,
    sort_order: h.sortOrder,
    created_at: h.createdAt.toISOString(),
    updated_at: h.updatedAt.toISOString(),
  };
}

// Enabled-only, sort_order ascending — exactly the list the Manufacturer
// cascade walks.
export async function listEnabledBrandNameHints(): Promise<BrandNameHintRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("brand_name_hints").select("*").eq("enabled", true).order("sort_order");
    if (error) throw error;
    return (data || []).map(normalizeRow);
  }
  return memoryDb.brandNameHints.filter(h => h.enabled).sort((a, b) => a.sortOrder - b.sortOrder).map(mockToRow);
}

// All rows (enabled + disabled), for the admin Settings page.
export async function listAllBrandNameHints(): Promise<BrandNameHintRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("brand_name_hints").select("*").order("sort_order");
    if (error) throw error;
    return (data || []).map(normalizeRow);
  }
  return [...memoryDb.brandNameHints].sort((a, b) => a.sortOrder - b.sortOrder).map(mockToRow);
}

export async function addBrandNameHint(input: { brand: string; namePrefixes?: string[] }): Promise<BrandNameHintRow> {
  if (isSupabaseConfigured) {
    const { data: existing } = await supabaseAdmin
      .from("brand_name_hints")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = (existing?.sort_order ?? -1) + 1;
    const { data, error } = await supabaseAdmin
      .from("brand_name_hints")
      .insert({ brand: input.brand, name_prefixes: input.namePrefixes || [], sort_order: nextSort })
      .select()
      .single();
    if (error) throw error;
    return normalizeRow(data);
  }

  const now = new Date();
  const nextSort = memoryDb.brandNameHints.length ? Math.max(...memoryDb.brandNameHints.map(h => h.sortOrder)) + 1 : 0;
  const row: MockBrandNameHint = {
    id: `bhint_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    brand: input.brand,
    namePrefixes: input.namePrefixes || [],
    enabled: true,
    sortOrder: nextSort,
    createdAt: now,
    updatedAt: now,
  };
  memoryDb.brandNameHints.push(row);
  return mockToRow(row);
}

export async function updateBrandNameHint(
  id: string,
  patch: { brand?: string; namePrefixes?: string[]; enabled?: boolean; sortOrder?: number }
): Promise<BrandNameHintRow | null> {
  if (isSupabaseConfigured) {
    const dbPatch: any = { updated_at: new Date().toISOString() };
    if (patch.brand !== undefined) dbPatch.brand = patch.brand;
    if (patch.namePrefixes !== undefined) dbPatch.name_prefixes = patch.namePrefixes;
    if (patch.enabled !== undefined) dbPatch.enabled = patch.enabled;
    if (patch.sortOrder !== undefined) dbPatch.sort_order = patch.sortOrder;
    const { data, error } = await supabaseAdmin.from("brand_name_hints").update(dbPatch).eq("id", id).select().single();
    if (error) throw error;
    return normalizeRow(data);
  }

  const row = memoryDb.brandNameHints.find(h => h.id === id);
  if (!row) return null;
  if (patch.brand !== undefined) row.brand = patch.brand;
  if (patch.namePrefixes !== undefined) row.namePrefixes = patch.namePrefixes;
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.sortOrder !== undefined) row.sortOrder = patch.sortOrder;
  row.updatedAt = new Date();
  return mockToRow(row);
}

export async function deleteBrandNameHint(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("brand_name_hints").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  const idx = memoryDb.brandNameHints.findIndex(h => h.id === id);
  if (idx >= 0) memoryDb.brandNameHints.splice(idx, 1);
}
