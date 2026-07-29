// lib/db/branded-motor-names.ts
// CRUD over branded_motor_names — a brand's own proprietary marketing name
// for a motor (e.g. "IN3" -> the vector family), kept in its own table
// rather than folded into motor_families.aliases because aliases there are
// a single GLOBAL namespace matched regardless of brand (see
// lib/motor-taxonomy.ts's matchBrandedMotorName for why that would be
// wrong). Mirrors lib/db/motor-families.ts's exact dual-path CRUD style —
// starts empty (admin-filled, real usage data), not pre-seeded.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockBrandedMotorName } from "@/lib/memoryDb";

export interface BrandedMotorNameRow {
  id: string;
  brand_name: string;
  branded_term: string;
  family_key: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mockToRow(m: MockBrandedMotorName): BrandedMotorNameRow {
  return {
    id: m.id,
    brand_name: m.brandName,
    branded_term: m.brandedTerm,
    family_key: m.familyKey,
    enabled: m.enabled,
    sort_order: m.sortOrder,
    created_at: m.createdAt.toISOString(),
    updated_at: m.updatedAt.toISOString(),
  };
}

export async function listBrandedMotorNames(): Promise<BrandedMotorNameRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("branded_motor_names").select("*").order("sort_order");
    if (error) throw error;
    return data || [];
  }
  return [...memoryDb.brandedMotorNames].sort((a, b) => a.sortOrder - b.sortOrder).map(mockToRow);
}

export async function addBrandedMotorName(input: {
  brandName: string;
  brandedTerm: string;
  familyKey: string;
}): Promise<BrandedMotorNameRow> {
  if (isSupabaseConfigured) {
    const { data: existing } = await supabaseAdmin
      .from("branded_motor_names")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = (existing?.sort_order ?? -1) + 1;
    const { data, error } = await supabaseAdmin
      .from("branded_motor_names")
      .insert({ brand_name: input.brandName, branded_term: input.brandedTerm, family_key: input.familyKey, sort_order: nextSort })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const now = new Date();
  const nextSort = memoryDb.brandedMotorNames.length ? Math.max(...memoryDb.brandedMotorNames.map(f => f.sortOrder)) + 1 : 0;
  const row: MockBrandedMotorName = {
    id: `bmotor_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    brandName: input.brandName,
    brandedTerm: input.brandedTerm,
    familyKey: input.familyKey,
    enabled: true,
    sortOrder: nextSort,
    createdAt: now,
    updatedAt: now,
  };
  memoryDb.brandedMotorNames.push(row);
  return mockToRow(row);
}

export async function updateBrandedMotorName(
  id: string,
  patch: { brandName?: string; brandedTerm?: string; familyKey?: string; enabled?: boolean }
): Promise<BrandedMotorNameRow | null> {
  if (isSupabaseConfigured) {
    const dbPatch: any = { updated_at: new Date().toISOString() };
    if (patch.brandName !== undefined) dbPatch.brand_name = patch.brandName;
    if (patch.brandedTerm !== undefined) dbPatch.branded_term = patch.brandedTerm;
    if (patch.familyKey !== undefined) dbPatch.family_key = patch.familyKey;
    if (patch.enabled !== undefined) dbPatch.enabled = patch.enabled;
    const { data, error } = await supabaseAdmin.from("branded_motor_names").update(dbPatch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  const row = memoryDb.brandedMotorNames.find(f => f.id === id);
  if (!row) return null;
  if (patch.brandName !== undefined) row.brandName = patch.brandName;
  if (patch.brandedTerm !== undefined) row.brandedTerm = patch.brandedTerm;
  if (patch.familyKey !== undefined) row.familyKey = patch.familyKey;
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  row.updatedAt = new Date();
  return mockToRow(row);
}

export async function deleteBrandedMotorName(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("branded_motor_names").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  const idx = memoryDb.brandedMotorNames.findIndex(f => f.id === id);
  if (idx >= 0) memoryDb.brandedMotorNames.splice(idx, 1);
}
