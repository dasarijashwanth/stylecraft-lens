// lib/db/brand-voice-guides.ts
// CRUD over brand_voice_guides — versioned, brand-scoped voice/tone/
// terminology guides injected into every AI call that produces user-facing
// prose (see lib/brand-voice.ts). "Versioned" here follows the same
// precedent as lib/db/deck-templates.ts/lib/db/gtm-workbook-templates.ts:
// an edit is a new ROW (version = previous max for that brand + 1), and
// activating one deactivates the rest — but scoped PER BRAND (StyleCraft
// and Gamma+ each have their own concurrently-active guide), not globally.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockBrandVoiceGuide } from "@/lib/memoryDb";

export interface BrandVoiceGuideRow {
  id: string;
  brand: string;
  content: string;
  version: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function mockToRow(g: MockBrandVoiceGuide): BrandVoiceGuideRow {
  return {
    id: g.id,
    brand: g.brand,
    content: g.content,
    version: g.version,
    is_active: g.isActive,
    created_by: g.createdBy,
    created_at: g.createdAt.toISOString(),
    updated_at: g.updatedAt.toISOString(),
  };
}

// All versions for one brand, newest first — the admin page's per-brand
// history list.
export async function listVersionsForBrand(brand: string): Promise<BrandVoiceGuideRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("brand_voice_guides").select("*").eq("brand", brand).order("version", { ascending: false });
    if (error) throw error;
    return data || [];
  }
  return memoryDb.brandVoiceGuides
    .filter(g => g.brand === brand)
    .sort((a, b) => b.version - a.version)
    .map(mockToRow);
}

// Every version of every brand — the admin page's top-level list groups
// these by brand client-side.
export async function listAllGuides(): Promise<BrandVoiceGuideRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("brand_voice_guides").select("*").order("brand").order("version", { ascending: false });
    if (error) throw error;
    return data || [];
  }
  return [...memoryDb.brandVoiceGuides].sort((a, b) => a.brand.localeCompare(b.brand) || b.version - a.version).map(mockToRow);
}

// The single active guide for a brand — null when that brand has none
// (Gamma+, until a real guide is provided), which lib/brand-voice.ts reads
// as the "no brand voice guide on file" signal.
export async function getActiveGuideRow(brand: string): Promise<BrandVoiceGuideRow | null> {
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin.from("brand_voice_guides").select("*").eq("brand", brand).eq("is_active", true).maybeSingle();
    return data;
  }
  const row = memoryDb.brandVoiceGuides.find(g => g.brand === brand && g.isActive);
  return row ? mockToRow(row) : null;
}

export async function getGuideById(id: string): Promise<BrandVoiceGuideRow | null> {
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin.from("brand_voice_guides").select("*").eq("id", id).maybeSingle();
    return data;
  }
  const row = memoryDb.brandVoiceGuides.find(g => g.id === id);
  return row ? mockToRow(row) : null;
}

export async function createNewVersion(input: { brand: string; content: string; createdBy?: string | null }): Promise<BrandVoiceGuideRow> {
  if (isSupabaseConfigured) {
    const { data: existing } = await supabaseAdmin
      .from("brand_voice_guides")
      .select("version")
      .eq("brand", input.brand)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (existing?.version ?? 0) + 1;
    const { data, error } = await supabaseAdmin
      .from("brand_voice_guides")
      .insert({ brand: input.brand, content: input.content, version: nextVersion, is_active: false, created_by: input.createdBy ?? null })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const now = new Date();
  const nextVersion = memoryDb.brandVoiceGuides.filter(g => g.brand === input.brand).reduce((max, g) => Math.max(max, g.version), 0) + 1;
  const row: MockBrandVoiceGuide = {
    id: `bvg_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    brand: input.brand,
    content: input.content,
    version: nextVersion,
    isActive: false,
    createdBy: input.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  };
  memoryDb.brandVoiceGuides.push(row);
  return mockToRow(row);
}

// Deactivates every OTHER version for the SAME brand, then activates this
// one — scoped per-brand (unlike setActiveDeckTemplate's global clear),
// since StyleCraft and Gamma+ each need their own active guide at once.
export async function activateVersion(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { data: target, error: fetchError } = await supabaseAdmin.from("brand_voice_guides").select("brand").eq("id", id).maybeSingle();
    if (fetchError) throw fetchError;
    if (!target) return;
    const { error: clearError } = await supabaseAdmin.from("brand_voice_guides").update({ is_active: false }).eq("brand", target.brand).eq("is_active", true);
    if (clearError) throw clearError;
    const { error: setError } = await supabaseAdmin.from("brand_voice_guides").update({ is_active: true, updated_at: new Date().toISOString() }).eq("id", id);
    if (setError) throw setError;
    return;
  }

  const target = memoryDb.brandVoiceGuides.find(g => g.id === id);
  if (!target) return;
  for (const g of memoryDb.brandVoiceGuides) {
    if (g.brand === target.brand) g.isActive = false;
  }
  target.isActive = true;
  target.updatedAt = new Date();
}
