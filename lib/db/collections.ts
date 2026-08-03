// lib/db/collections.ts
// CRUD over collections — admin-editable narrative kernels (origin story,
// logo meaning, voice notes) for a named product line ("Homie", "360
// Jeezy"). GTM's collection-kernel adaptation deriver (lib/gtm-features-
// and-tip.ts) reads these to ADAPT a stored kernel into a new product's
// Product Name Origin / name-ties-to-story fields rather than inventing or
// copying verbatim. Same Supabase+memoryDb dual-path style, and same
// "always pre-seeded real default configuration" precedent as
// lib/db/brand-name-hints.ts (see lib/memoryDb.ts's seedCollectionDefaults).
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockCollection } from "@/lib/memoryDb";

export interface CollectionRow {
  id: string;
  name: string;
  narrative_kernel: string;
  logo_meaning: string;
  voice_notes: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mockToRow(c: MockCollection): CollectionRow {
  return {
    id: c.id,
    name: c.name,
    narrative_kernel: c.narrativeKernel,
    logo_meaning: c.logoMeaning,
    voice_notes: c.voiceNotes,
    enabled: c.enabled,
    sort_order: c.sortOrder,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

// Enabled-only, sort_order ascending — exactly the list the collection-
// kernel adaptation deriver walks to find a case-insensitive name match.
export async function listEnabledCollections(): Promise<CollectionRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("collections").select("*").eq("enabled", true).order("sort_order");
    if (error) throw error;
    return data || [];
  }
  return memoryDb.collections.filter(c => c.enabled).sort((a, b) => a.sortOrder - b.sortOrder).map(mockToRow);
}

// All rows (enabled + disabled), for the admin Settings page.
export async function listAllCollections(): Promise<CollectionRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("collections").select("*").order("sort_order");
    if (error) throw error;
    return data || [];
  }
  return [...memoryDb.collections].sort((a, b) => a.sortOrder - b.sortOrder).map(mockToRow);
}

export async function getCollection(id: string): Promise<CollectionRow | null> {
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin.from("collections").select("*").eq("id", id).maybeSingle();
    return data || null;
  }
  const row = memoryDb.collections.find(c => c.id === id);
  return row ? mockToRow(row) : null;
}

// Case/whitespace-insensitive name match — used by the collection-kernel
// adaptation deriver to resolve a catalog product's free-text `collection`
// column against a stored kernel.
export async function findCollectionByName(name: string): Promise<CollectionRow | null> {
  const target = name.trim().toLowerCase();
  const all = await listEnabledCollections();
  return all.find(c => c.name.trim().toLowerCase() === target) || null;
}

export interface CollectionInput {
  name: string;
  narrativeKernel?: string;
  logoMeaning?: string;
  voiceNotes?: string;
}

export async function addCollection(input: CollectionInput): Promise<CollectionRow> {
  if (isSupabaseConfigured) {
    const { data: existing } = await supabaseAdmin
      .from("collections")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = (existing?.sort_order ?? -1) + 1;
    const { data, error } = await supabaseAdmin
      .from("collections")
      .insert({
        name: input.name,
        narrative_kernel: input.narrativeKernel || "",
        logo_meaning: input.logoMeaning || "",
        voice_notes: input.voiceNotes || "",
        sort_order: nextSort,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const now = new Date();
  const nextSort = memoryDb.collections.length ? Math.max(...memoryDb.collections.map(c => c.sortOrder)) + 1 : 0;
  const row: MockCollection = {
    id: `collection_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    name: input.name,
    narrativeKernel: input.narrativeKernel || "",
    logoMeaning: input.logoMeaning || "",
    voiceNotes: input.voiceNotes || "",
    enabled: true,
    sortOrder: nextSort,
    createdAt: now,
    updatedAt: now,
  };
  memoryDb.collections.push(row);
  return mockToRow(row);
}

export async function updateCollection(
  id: string,
  patch: Partial<CollectionInput> & { enabled?: boolean; sortOrder?: number }
): Promise<CollectionRow | null> {
  if (isSupabaseConfigured) {
    const dbPatch: any = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.narrativeKernel !== undefined) dbPatch.narrative_kernel = patch.narrativeKernel;
    if (patch.logoMeaning !== undefined) dbPatch.logo_meaning = patch.logoMeaning;
    if (patch.voiceNotes !== undefined) dbPatch.voice_notes = patch.voiceNotes;
    if (patch.enabled !== undefined) dbPatch.enabled = patch.enabled;
    if (patch.sortOrder !== undefined) dbPatch.sort_order = patch.sortOrder;
    const { data, error } = await supabaseAdmin.from("collections").update(dbPatch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  const row = memoryDb.collections.find(c => c.id === id);
  if (!row) return null;
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.narrativeKernel !== undefined) row.narrativeKernel = patch.narrativeKernel;
  if (patch.logoMeaning !== undefined) row.logoMeaning = patch.logoMeaning;
  if (patch.voiceNotes !== undefined) row.voiceNotes = patch.voiceNotes;
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.sortOrder !== undefined) row.sortOrder = patch.sortOrder;
  row.updatedAt = new Date();
  return mockToRow(row);
}

export async function deleteCollection(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("collections").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  const idx = memoryDb.collections.findIndex(c => c.id === id);
  if (idx >= 0) memoryDb.collections.splice(idx, 1);
}
