// lib/db/scoring-profiles.ts
// CRUD over scoring_profiles — per-tool-type composite-scoring weight
// profiles, replacing the old singleton lib/db/competitor-matching-config.ts
// (kept, unused, for history). Same dual-path Supabase/memoryDb CRUD
// convention as lib/db/motor-families.ts/lib/db/tool-types.ts. memoryDb is
// always pre-seeded with the global default row plus one row per built-in
// motorized/heat-tech tool type (see lib/memoryDb.ts's
// seedScoringProfileDefaults) — real default configuration, not an empty
// admin-fills-it-in table.
//
// Weights are stored EXACTLY as entered (no forced sum-to-1) — free-form
// relative-importance numbers; normalization happens at use-time in
// lib/competitor-scoring.ts's computeCompositeScore.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockScoringProfile } from "@/lib/memoryDb";

export interface ScoringProfileRow {
  id: string;
  type_key: string | null;
  motor_weight: number;
  price_weight: number;
  feature_weight: number;
  updated_at: string;
}

function mockToRow(p: MockScoringProfile): ScoringProfileRow {
  return {
    id: p.id,
    type_key: p.typeKey,
    motor_weight: p.motorWeight,
    price_weight: p.priceWeight,
    feature_weight: p.featureWeight,
    updated_at: p.updatedAt.toISOString(),
  };
}

export async function listScoringProfiles(): Promise<ScoringProfileRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("scoring_profiles").select("*");
    if (error) throw error;
    return data || [];
  }
  return memoryDb.scoringProfiles.map(mockToRow);
}

// Row where type_key = X, else the type_key IS NULL global-default row,
// else a hardcoded fallback (should never hit in practice — the default
// row is always seeded).
export async function getScoringProfileForToolType(typeKey: string | null | undefined): Promise<{ motor: number; price: number; feature: number }> {
  const profiles = await listScoringProfiles();
  const own = typeKey ? profiles.find(p => p.type_key === typeKey) : undefined;
  const fallback = own || profiles.find(p => p.type_key === null);
  if (!fallback) return { motor: 45, price: 35, feature: 20 };
  return { motor: Number(fallback.motor_weight), price: Number(fallback.price_weight), feature: Number(fallback.feature_weight) };
}

// Upserts the profile for a given type_key (or the global default when
// typeKey is null) — used by both the admin Settings editor and the
// analyze/new-project forms' "Save to profile" action.
export async function upsertScoringProfile(typeKey: string | null, weights: { motor: number; price: number; feature: number }): Promise<ScoringProfileRow> {
  if (weights.motor < 0 || weights.price < 0 || weights.feature < 0 || weights.motor + weights.price + weights.feature <= 0) {
    throw Object.assign(new Error("At least one criterion must be > 0"), { status: 400 });
  }

  if (isSupabaseConfigured) {
    if (typeKey === null) {
      const { data, error } = await supabaseAdmin
        .from("scoring_profiles")
        .update({ motor_weight: weights.motor, price_weight: weights.price, feature_weight: weights.feature, updated_at: new Date().toISOString() })
        .is("type_key", null)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await supabaseAdmin
      .from("scoring_profiles")
      .upsert(
        { type_key: typeKey, motor_weight: weights.motor, price_weight: weights.price, feature_weight: weights.feature, updated_at: new Date().toISOString() },
        { onConflict: "type_key" }
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const existing = memoryDb.scoringProfiles.find(p => p.typeKey === typeKey);
  if (existing) {
    existing.motorWeight = weights.motor;
    existing.priceWeight = weights.price;
    existing.featureWeight = weights.feature;
    existing.updatedAt = new Date();
    return mockToRow(existing);
  }
  const row: MockScoringProfile = {
    id: `sprof_${typeKey ?? "default"}_${Date.now()}`,
    typeKey,
    motorWeight: weights.motor,
    priceWeight: weights.price,
    featureWeight: weights.feature,
    updatedAt: new Date(),
  };
  memoryDb.scoringProfiles.push(row);
  return mockToRow(row);
}

// "Reset to default" — deletes the type-specific override row so
// resolution falls back to the global default. A no-op (throws) for the
// global default row itself, which can never be deleted.
export async function deleteScoringProfile(typeKey: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("scoring_profiles").delete().eq("type_key", typeKey);
    if (error) throw error;
    return;
  }
  const idx = memoryDb.scoringProfiles.findIndex(p => p.typeKey === typeKey);
  if (idx >= 0) memoryDb.scoringProfiles.splice(idx, 1);
}
