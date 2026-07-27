// lib/db/competitor-matching-config.ts
// Singleton config row for the composite-score weights
// (lib/competitor-scoring.ts's computeCompositeScore) — admin-editable at
// /dashboard/admin/competitor-matching without a deploy. No generic
// settings/config table existed anywhere in this app before this; a
// dedicated small table (rather than a KV blob) matches this codebase's
// existing preference for explicit typed columns over schemaless config.
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

// Normalizes to sum 1.0 defensively — an admin typo (e.g. weights summing to
// 0.9) must never silently under-weight every candidate's composite score.
function normalize(motor: number, price: number, feature: number): { motor: number; price: number; feature: number } {
  const sum = motor + price + feature;
  if (!sum || !isFinite(sum)) return DEFAULT_WEIGHTS as any;
  return { motor: motor / sum, price: price / sum, feature: feature / sum };
}

export async function updateMatchingWeights(input: { motor: number; price: number; feature: number }): Promise<CompetitorMatchingWeights> {
  const { motor, price, feature } = normalize(input.motor, input.price, input.feature);

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
