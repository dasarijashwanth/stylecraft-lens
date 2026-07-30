// lib/db/tool-types.ts
// CRUD over tool_types — migrates Tool Type from a fixed compile-time
// TypeScript union (lib/tool-type-taxonomy.ts) to the same admin/user-
// editable, DB-backed shape lib/db/motor-families.ts already uses.
// memoryDb is always pre-seeded with the 9 built-in types (see
// lib/memoryDb.ts's seedToolTypeDefaults) — real default configuration,
// not an empty admin-fills-it-in table. Custom types (added inline from the
// analyze/new-project forms) get `custom: true` but otherwise identical
// treatment — same aliases-driven strict matching, same enabled/sort_order
// mechanics.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockToolType } from "@/lib/memoryDb";

export interface ToolTypeRow {
  id: string;
  type_key: string;
  label: string;
  aliases: string[];
  family: string | null; // 'clipper_trimmer_shaver' | 'beauty' | null (either)
  // Which evidence-backed criterion dominates composite scoring for this
  // type — see lib/heat-tech-taxonomy.ts / lib/motor-taxonomy.ts.
  primary_criterion: "motor" | "heat_technology" | "none";
  enabled: boolean;
  custom: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mockToRow(t: MockToolType): ToolTypeRow {
  return {
    id: t.id,
    type_key: t.typeKey,
    label: t.label,
    aliases: t.aliases,
    family: t.family,
    primary_criterion: t.primaryCriterion,
    enabled: t.enabled,
    custom: t.custom,
    sort_order: t.sortOrder,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
  };
}

// A new custom type's sensible default criterion, when the caller doesn't
// explicitly specify one — clipper/trimmer/shaver-family types default to
// 'motor' (the common case for that industry), beauty-family types default
// to 'none' (safe default — heat_technology is a real, specific claim about
// the product that shouldn't be assumed without the user opting in).
function defaultPrimaryCriterion(family: string | null | undefined): "motor" | "heat_technology" | "none" {
  return family === "clipper_trimmer_shaver" ? "motor" : "none";
}

export async function listToolTypes(): Promise<ToolTypeRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("tool_types").select("*").order("sort_order");
    if (error) throw error;
    return data || [];
  }
  return [...memoryDb.toolTypes].sort((a, b) => a.sortOrder - b.sortOrder).map(mockToRow);
}

export async function addToolType(input: {
  typeKey: string;
  label: string;
  aliases?: string[];
  family?: string | null;
  primaryCriterion?: "motor" | "heat_technology" | "none";
  custom?: boolean;
}): Promise<ToolTypeRow> {
  const primaryCriterion = input.primaryCriterion ?? defaultPrimaryCriterion(input.family);

  if (isSupabaseConfigured) {
    const { data: existing } = await supabaseAdmin
      .from("tool_types")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = (existing?.sort_order ?? -1) + 1;
    const { data, error } = await supabaseAdmin
      .from("tool_types")
      .insert({
        type_key: input.typeKey,
        label: input.label,
        aliases: input.aliases || [],
        family: input.family ?? null,
        primary_criterion: primaryCriterion,
        custom: input.custom ?? true,
        sort_order: nextSort,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const now = new Date();
  const nextSort = memoryDb.toolTypes.length ? Math.max(...memoryDb.toolTypes.map(t => t.sortOrder)) + 1 : 0;
  const row: MockToolType = {
    id: `ttype_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    typeKey: input.typeKey,
    label: input.label,
    aliases: input.aliases || [],
    family: input.family ?? null,
    primaryCriterion,
    enabled: true,
    custom: input.custom ?? true,
    sortOrder: nextSort,
    createdAt: now,
    updatedAt: now,
  };
  memoryDb.toolTypes.push(row);
  return mockToRow(row);
}

export async function updateToolType(
  id: string,
  patch: { label?: string; aliases?: string[]; family?: string | null; primaryCriterion?: "motor" | "heat_technology" | "none"; enabled?: boolean; sortOrder?: number }
): Promise<ToolTypeRow | null> {
  if (isSupabaseConfigured) {
    const dbPatch: any = { updated_at: new Date().toISOString() };
    if (patch.label !== undefined) dbPatch.label = patch.label;
    if (patch.aliases !== undefined) dbPatch.aliases = patch.aliases;
    if (patch.family !== undefined) dbPatch.family = patch.family;
    if (patch.primaryCriterion !== undefined) dbPatch.primary_criterion = patch.primaryCriterion;
    if (patch.enabled !== undefined) dbPatch.enabled = patch.enabled;
    if (patch.sortOrder !== undefined) dbPatch.sort_order = patch.sortOrder;
    const { data, error } = await supabaseAdmin.from("tool_types").update(dbPatch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  const row = memoryDb.toolTypes.find(t => t.id === id);
  if (!row) return null;
  if (patch.label !== undefined) row.label = patch.label;
  if (patch.aliases !== undefined) row.aliases = patch.aliases;
  if (patch.family !== undefined) row.family = patch.family;
  if (patch.primaryCriterion !== undefined) row.primaryCriterion = patch.primaryCriterion;
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.sortOrder !== undefined) row.sortOrder = patch.sortOrder;
  row.updatedAt = new Date();
  return mockToRow(row);
}

export async function deleteToolType(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("tool_types").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  const idx = memoryDb.toolTypes.findIndex(t => t.id === id);
  if (idx >= 0) memoryDb.toolTypes.splice(idx, 1);
}

export async function reorderToolTypes(orderedIds: string[]): Promise<void> {
  if (isSupabaseConfigured) {
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await supabaseAdmin.from("tool_types").update({ sort_order: i, updated_at: new Date().toISOString() }).eq("id", orderedIds[i]);
      if (error) throw error;
    }
    return;
  }
  orderedIds.forEach((id, i) => {
    const row = memoryDb.toolTypes.find(t => t.id === id);
    if (row) {
      row.sortOrder = i;
      row.updatedAt = new Date();
    }
  });
}
