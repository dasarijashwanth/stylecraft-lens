// lib/db/competitor-matching-config.ts
// DEPRECATED — superseded by lib/db/scoring-profiles.ts's per-tool-type
// scoring_profiles table (this was a single global weight row with no
// per-tool-type concept at all). Kept, never deleted, per this repo's
// additive-only schema convention; no code path calls this module anymore
// once the scoring-profiles migration lands. Left here only as the
// original historical shape.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb } from "@/lib/memoryDb";

export interface CompetitorMatchingWeights {
  motor_weight: number;
  price_weight: number;
  feature_weight: number;
  updated_at: string;
}

const DEFAULT_WEIGHTS = { motor_weight: 0.45, price_weight: 0.35, feature_weight: 0.2 };

export async function getMatchingWeights(): Promise<CompetitorMatchingWeights> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("competitor_matching_config").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    if (!data) return { ...DEFAULT_WEIGHTS, updated_at: new Date().toISOString() };
    return data;
  }

  const c = memoryDb.competitorMatchingConfig;
  return { motor_weight: c.motorWeight, price_weight: c.priceWeight, feature_weight: c.featureWeight, updated_at: c.updatedAt.toISOString() };
}

export async function updateMatchingWeights(input: { motor: number; price: number; feature: number }): Promise<CompetitorMatchingWeights> {
  // No forced normalization — raw values are stored as entered (auditability);
  // normalization now happens at use-time in lib/competitor-scoring.ts's
  // computeCompositeScore. Superseded by scoring-profiles.ts's own
  // validation (reject all-zero) — this function is unused dead code path
  // but kept honest in case anything still calls it.
  const { motor, price, feature } = input;

  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("competitor_matching_config")
      .update({ motor_weight: motor, price_weight: price, feature_weight: feature, updated_at: new Date().toISOString() })
      .eq("id", 1)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  memoryDb.competitorMatchingConfig = { motorWeight: motor, priceWeight: price, featureWeight: feature, updatedAt: new Date() };
  const c = memoryDb.competitorMatchingConfig;
  return { motor_weight: c.motorWeight, price_weight: c.priceWeight, feature_weight: c.featureWeight, updated_at: c.updatedAt.toISOString() };
}
