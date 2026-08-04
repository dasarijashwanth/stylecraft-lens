// lib/db/marketing-defaults.ts
// Org-wide singleton config for the Marketing Direction section's
// "Languages" field (GTM workbook export work) — same id=1 singleton-row
// shape as lib/db/competitor-matching-config.ts, not the versioned
// brand-voice-guides.ts pattern (overkill for one string value). Edited via
// the admin page at /dashboard/admin/marketing-defaults; read by
// lib/gtm-marketing-direction.ts to seed the Languages field with
// source: "category_default" rather than an AI guess.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb } from "@/lib/memoryDb";

export interface MarketingDefaultsRow {
  languages: string;
  updated_at: string;
}

const DEFAULT_LANGUAGES = "English (primary). Spanish (secondary, for retail/DTC market reach). French Canadian";

export async function getMarketingDefaults(): Promise<MarketingDefaultsRow> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("marketing_defaults").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    if (!data) return { languages: DEFAULT_LANGUAGES, updated_at: new Date().toISOString() };
    return { languages: data.languages, updated_at: data.updated_at };
  }

  const d = memoryDb.marketingDefaults;
  return { languages: d.languages, updated_at: d.updatedAt.toISOString() };
}

export async function updateMarketingDefaults(languages: string): Promise<MarketingDefaultsRow> {
  const trimmed = languages.trim();

  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("marketing_defaults")
      .update({ languages: trimmed, updated_at: new Date().toISOString() })
      .eq("id", 1)
      .select()
      .single();
    if (error) throw error;
    return { languages: data.languages, updated_at: data.updated_at };
  }

  memoryDb.marketingDefaults = { languages: trimmed, updatedAt: new Date() };
  const d = memoryDb.marketingDefaults;
  return { languages: d.languages, updated_at: d.updatedAt.toISOString() };
}
