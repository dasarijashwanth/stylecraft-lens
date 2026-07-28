// lib/db/feature-flags.ts
// Keyed config rows gating optional pipeline/UI behavior — same dual-path
// (Supabase/memoryDb) CRUD shape as lib/db/competitor-matching-config.ts.
// Keyed by flag_name (not a single fixed-id row) since more flags may
// follow tds_enabled later. getFeatureFlag falls back to an env var when
// no row exists at all (a fresh DB that hasn't run supabase_schema.sql's
// Section 20 yet still behaves correctly) — see lib/feature-flags.ts for
// the named per-flag wrappers real callers should use instead of this
// string-keyed layer directly.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb } from "@/lib/memoryDb";

export interface FeatureFlagRow {
  flag_name: string;
  enabled: boolean;
  updated_at: string;
}

// Env var fallback used ONLY when no DB row exists for this flag at all —
// once a row exists (seeded by supabase_schema.sql, or written once via
// setFeatureFlag), the DB value is authoritative and the env var is never
// consulted again for that flag.
const ENV_DEFAULTS: Record<string, string | undefined> = {
  tds_enabled: process.env.TDS_ENABLED,
};

export async function getFeatureFlag(flagName: string): Promise<boolean> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("feature_flags").select("*").eq("flag_name", flagName).maybeSingle();
    if (error) throw error;
    if (data) return data.enabled;
  } else {
    const row = memoryDb.featureFlags.find(f => f.flagName === flagName);
    if (row) return row.enabled;
  }

  // No row anywhere — fall back to the env var default (defaults to
  // enabled unless explicitly set to "false").
  return ENV_DEFAULTS[flagName] !== "false";
}

export async function setFeatureFlag(flagName: string, enabled: boolean): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin
      .from("feature_flags")
      .upsert({ flag_name: flagName, enabled, updated_at: new Date().toISOString() }, { onConflict: "flag_name" });
    if (error) throw error;
    return;
  }

  const row = memoryDb.featureFlags.find(f => f.flagName === flagName);
  if (row) {
    row.enabled = enabled;
    row.updatedAt = new Date();
  } else {
    memoryDb.featureFlags.push({ flagName, enabled, updatedAt: new Date() });
  }
}

export async function listFeatureFlags(): Promise<FeatureFlagRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("feature_flags").select("*").order("flag_name");
    if (error) throw error;
    return data || [];
  }

  return memoryDb.featureFlags
    .map(f => ({ flag_name: f.flagName, enabled: f.enabled, updated_at: f.updatedAt.toISOString() }))
    .sort((a, b) => a.flag_name.localeCompare(b.flag_name));
}
