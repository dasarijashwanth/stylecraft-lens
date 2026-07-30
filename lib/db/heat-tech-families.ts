// lib/db/heat-tech-families.ts
// CRUD over heat_tech_families — a full parallel to lib/db/motor-families.ts
// for the new Heat/Plate Technology criterion (motorless styling tools:
// flat iron/curling iron/hot brush), minus the motor-specific
// modifier/adjacent_families concepts (not needed here — match tiers are
// exact/different/unverified only, see lib/heat-tech-taxonomy.ts). Same
// dual-path Supabase/memoryDb CRUD convention. memoryDb is always
// pre-seeded with the 4 default families (see lib/memoryDb.ts's
// seedHeatTechFamilyDefaults) — real default configuration, not an empty
// admin-fills-it-in table.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockHeatTechFamily } from "@/lib/memoryDb";

export interface HeatTechFamilyRow {
  id: string;
  family_key: string;
  label: string;
  aliases: string[];
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mockToRow(f: MockHeatTechFamily): HeatTechFamilyRow {
  return {
    id: f.id,
    family_key: f.familyKey,
    label: f.label,
    aliases: f.aliases,
    enabled: f.enabled,
    sort_order: f.sortOrder,
    created_at: f.createdAt.toISOString(),
    updated_at: f.updatedAt.toISOString(),
  };
}

export async function listHeatTechFamilies(): Promise<HeatTechFamilyRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("heat_tech_families").select("*").order("sort_order");
    if (error) throw error;
    return data || [];
  }
  return [...memoryDb.heatTechFamilies].sort((a, b) => a.sortOrder - b.sortOrder).map(mockToRow);
}

export async function addHeatTechFamily(input: { familyKey: string; label: string; aliases?: string[] }): Promise<HeatTechFamilyRow> {
  if (isSupabaseConfigured) {
    const { data: existing } = await supabaseAdmin
      .from("heat_tech_families")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = (existing?.sort_order ?? -1) + 1;
    const { data, error } = await supabaseAdmin
      .from("heat_tech_families")
      .insert({ family_key: input.familyKey, label: input.label, aliases: input.aliases || [], sort_order: nextSort })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const now = new Date();
  const nextSort = memoryDb.heatTechFamilies.length ? Math.max(...memoryDb.heatTechFamilies.map(f => f.sortOrder)) + 1 : 0;
  const row: MockHeatTechFamily = {
    id: `htfam_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    familyKey: input.familyKey,
    label: input.label,
    aliases: input.aliases || [],
    enabled: true,
    sortOrder: nextSort,
    createdAt: now,
    updatedAt: now,
  };
  memoryDb.heatTechFamilies.push(row);
  return mockToRow(row);
}

export async function updateHeatTechFamily(
  id: string,
  patch: { label?: string; aliases?: string[]; enabled?: boolean; sortOrder?: number }
): Promise<HeatTechFamilyRow | null> {
  if (isSupabaseConfigured) {
    const dbPatch: any = { updated_at: new Date().toISOString() };
    if (patch.label !== undefined) dbPatch.label = patch.label;
    if (patch.aliases !== undefined) dbPatch.aliases = patch.aliases;
    if (patch.enabled !== undefined) dbPatch.enabled = patch.enabled;
    if (patch.sortOrder !== undefined) dbPatch.sort_order = patch.sortOrder;
    const { data, error } = await supabaseAdmin.from("heat_tech_families").update(dbPatch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  const row = memoryDb.heatTechFamilies.find(f => f.id === id);
  if (!row) return null;
  if (patch.label !== undefined) row.label = patch.label;
  if (patch.aliases !== undefined) row.aliases = patch.aliases;
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.sortOrder !== undefined) row.sortOrder = patch.sortOrder;
  row.updatedAt = new Date();
  return mockToRow(row);
}

export async function deleteHeatTechFamily(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("heat_tech_families").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  const idx = memoryDb.heatTechFamilies.findIndex(f => f.id === id);
  if (idx >= 0) memoryDb.heatTechFamilies.splice(idx, 1);
}
