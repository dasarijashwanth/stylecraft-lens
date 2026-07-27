// lib/db/motor-families.ts
// CRUD over motor_families — the admin-editable motor-type taxonomy
// competitor selection now matches on (lib/motor-taxonomy.ts), mirroring
// lib/db/legacy-brands.ts's exact dual-path CRUD style. Unlike deck
// templates, memoryDb is always pre-seeded with the 8 default families
// (see lib/memoryDb.ts's seedMotorFamilyDefaults) — real default
// configuration, not an empty admin-fills-it-in table.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockMotorFamily } from "@/lib/memoryDb";

export interface MotorFamilyRow {
  id: string;
  family_key: string;
  label: string;
  domain: string; // 'clipper_trimmer_shaver' | 'beauty'
  aliases: string[];
  modifier: boolean;
  adjacent_families: string[];
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mockToRow(f: MockMotorFamily): MotorFamilyRow {
  return {
    id: f.id,
    family_key: f.familyKey,
    label: f.label,
    domain: f.domain,
    aliases: f.aliases,
    modifier: f.modifier,
    adjacent_families: f.adjacentFamilies,
    enabled: f.enabled,
    sort_order: f.sortOrder,
    created_at: f.createdAt.toISOString(),
    updated_at: f.updatedAt.toISOString(),
  };
}

export async function listMotorFamilies(): Promise<MotorFamilyRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("motor_families").select("*").order("sort_order");
    if (error) throw error;
    return data || [];
  }
  return [...memoryDb.motorFamilies].sort((a, b) => a.sortOrder - b.sortOrder).map(mockToRow);
}

export async function addMotorFamily(input: {
  familyKey: string;
  label: string;
  domain: string;
  aliases?: string[];
  modifier?: boolean;
  adjacentFamilies?: string[];
}): Promise<MotorFamilyRow> {
  if (isSupabaseConfigured) {
    const { data: existing } = await supabaseAdmin
      .from("motor_families")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = (existing?.sort_order ?? -1) + 1;
    const { data, error } = await supabaseAdmin
      .from("motor_families")
      .insert({
        family_key: input.familyKey,
        label: input.label,
        domain: input.domain,
        aliases: input.aliases || [],
        modifier: input.modifier ?? false,
        adjacent_families: input.adjacentFamilies || [],
        sort_order: nextSort,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const now = new Date();
  const nextSort = memoryDb.motorFamilies.length ? Math.max(...memoryDb.motorFamilies.map(f => f.sortOrder)) + 1 : 0;
  const row: MockMotorFamily = {
    id: `mfam_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    familyKey: input.familyKey,
    label: input.label,
    domain: input.domain,
    aliases: input.aliases || [],
    modifier: input.modifier ?? false,
    adjacentFamilies: input.adjacentFamilies || [],
    enabled: true,
    sortOrder: nextSort,
    createdAt: now,
    updatedAt: now,
  };
  memoryDb.motorFamilies.push(row);
  return mockToRow(row);
}

export async function updateMotorFamily(
  id: string,
  patch: { label?: string; aliases?: string[]; adjacentFamilies?: string[]; enabled?: boolean; sortOrder?: number }
): Promise<MotorFamilyRow | null> {
  if (isSupabaseConfigured) {
    const dbPatch: any = { updated_at: new Date().toISOString() };
    if (patch.label !== undefined) dbPatch.label = patch.label;
    if (patch.aliases !== undefined) dbPatch.aliases = patch.aliases;
    if (patch.adjacentFamilies !== undefined) dbPatch.adjacent_families = patch.adjacentFamilies;
    if (patch.enabled !== undefined) dbPatch.enabled = patch.enabled;
    if (patch.sortOrder !== undefined) dbPatch.sort_order = patch.sortOrder;
    const { data, error } = await supabaseAdmin.from("motor_families").update(dbPatch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  const row = memoryDb.motorFamilies.find(f => f.id === id);
  if (!row) return null;
  if (patch.label !== undefined) row.label = patch.label;
  if (patch.aliases !== undefined) row.aliases = patch.aliases;
  if (patch.adjacentFamilies !== undefined) row.adjacentFamilies = patch.adjacentFamilies;
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.sortOrder !== undefined) row.sortOrder = patch.sortOrder;
  row.updatedAt = new Date();
  return mockToRow(row);
}

export async function deleteMotorFamily(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("motor_families").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  const idx = memoryDb.motorFamilies.findIndex(f => f.id === id);
  if (idx >= 0) memoryDb.motorFamilies.splice(idx, 1);
}

export async function reorderMotorFamilies(orderedIds: string[]): Promise<void> {
  if (isSupabaseConfigured) {
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await supabaseAdmin.from("motor_families").update({ sort_order: i, updated_at: new Date().toISOString() }).eq("id", orderedIds[i]);
      if (error) throw error;
    }
    return;
  }
  orderedIds.forEach((id, i) => {
    const row = memoryDb.motorFamilies.find(f => f.id === id);
    if (row) {
      row.sortOrder = i;
      row.updatedAt = new Date();
    }
  });
}
