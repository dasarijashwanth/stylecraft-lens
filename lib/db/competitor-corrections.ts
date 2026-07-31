// lib/db/competitor-corrections.ts
// CRUD over competitor_corrections (Section 33 of supabase_schema.sql) —
// records WHY a user manually replaced a wrongly-selected competitor's
// ASIN (lib/analysisEngine.ts's replaceCompetitor), and feeds that history
// back into future discovery runs as a blocklist/preference signal (see
// getActiveCorrectionsForToolType's callers in lib/analysisEngine.ts).
// Same dual-path Supabase/memoryDb CRUD convention as lib/db/legacy-brands.ts.
// Real usage data — memoryDb starts empty, never pre-seeded.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockCompetitorCorrection } from "@/lib/memoryDb";

// Kept as a plain string (not a literal union) at the DB-row boundary —
// matches this codebase's convention of validating literal reason values
// at the API/zod boundary (lib/validations.ts), not the CRUD layer.
export type CorrectionReason = "wrong_product" | "wrong_model" | "wrong_motor" | "better_competitor" | "discontinued" | "other";

export interface CompetitorCorrectionRow {
  id: string;
  analysis_id: string | null;
  project_id: string | null;
  tool_type: string;
  motor_family: string | null;
  heat_tech_family: string | null;
  price_band: string | null;
  old_asin: string;
  old_title: string | null;
  new_asin: string;
  new_title: string | null;
  reason: string;
  note: string | null;
  user_id: string | null;
  expired_at: string | null;
  created_at: string;
}

function mockToRow(m: MockCompetitorCorrection): CompetitorCorrectionRow {
  return {
    id: m.id,
    analysis_id: m.analysisId,
    project_id: m.projectId,
    tool_type: m.toolType,
    motor_family: m.motorFamily ?? null,
    heat_tech_family: m.heatTechFamily ?? null,
    price_band: m.priceBand ?? null,
    old_asin: m.oldAsin,
    old_title: m.oldTitle ?? null,
    new_asin: m.newAsin,
    new_title: m.newTitle ?? null,
    reason: m.reason,
    note: m.note ?? null,
    user_id: m.userId ?? null,
    expired_at: m.expiredAt ? m.expiredAt.toISOString() : null,
    created_at: m.createdAt.toISOString(),
  };
}

export async function recordCorrection(input: {
  analysisId: string | null;
  projectId: string | null;
  toolType: string;
  motorFamily?: string | null;
  heatTechFamily?: string | null;
  priceBand?: string | null;
  oldAsin: string;
  oldTitle?: string | null;
  newAsin: string;
  newTitle?: string | null;
  reason: CorrectionReason;
  note?: string | null;
  userId?: string | null;
}): Promise<CompetitorCorrectionRow> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("competitor_corrections")
      .insert({
        analysis_id: input.analysisId,
        project_id: input.projectId,
        tool_type: input.toolType,
        motor_family: input.motorFamily ?? null,
        heat_tech_family: input.heatTechFamily ?? null,
        price_band: input.priceBand ?? null,
        old_asin: input.oldAsin,
        old_title: input.oldTitle ?? null,
        new_asin: input.newAsin,
        new_title: input.newTitle ?? null,
        reason: input.reason,
        note: input.note ?? null,
        user_id: input.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const now = new Date();
  const row: MockCompetitorCorrection = {
    id: `ccorr_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    analysisId: input.analysisId,
    projectId: input.projectId,
    toolType: input.toolType,
    motorFamily: input.motorFamily ?? null,
    heatTechFamily: input.heatTechFamily ?? null,
    priceBand: input.priceBand ?? null,
    oldAsin: input.oldAsin,
    oldTitle: input.oldTitle ?? null,
    newAsin: input.newAsin,
    newTitle: input.newTitle ?? null,
    reason: input.reason,
    note: input.note ?? null,
    userId: input.userId ?? null,
    expiredAt: null,
    createdAt: now,
  };
  memoryDb.competitorCorrections.push(row);
  return mockToRow(row);
}

// Admin view — every correction, including expired ones (inspectability is
// the whole point; expiry never deletes). Newest first.
export async function listAllCorrections(): Promise<CompetitorCorrectionRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("competitor_corrections").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }
  return [...memoryDb.competitorCorrections].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(mockToRow);
}

// The discovery-time read — only NON-expired corrections for this exact
// tool type. Fetched once per analysis run (same "cheap re-read, never
// module-level state" precedent as listMotorFamilies/listToolTypes),
// filtered/aggregated by the caller (lib/analysisEngine.ts) into
// blocklist/penalty/preference sets.
export async function getActiveCorrectionsForToolType(toolType: string): Promise<CompetitorCorrectionRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("competitor_corrections")
      .select("*")
      .eq("tool_type", toolType)
      .is("expired_at", null)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }
  return memoryDb.competitorCorrections
    .filter(c => c.toolType === toolType && !c.expiredAt)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(mockToRow);
}

// Admin "Expire" action — soft-disable, never deletes (the row stays in
// listAllCorrections' audit trail forever, just stops counting toward the
// blocklist/penalty/preference computation above).
export async function expireCorrection(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("competitor_corrections").update({ expired_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    return;
  }
  const row = memoryDb.competitorCorrections.find(c => c.id === id);
  if (row) row.expiredAt = new Date();
}

// Reverses expireCorrection — an admin re-enabling a rule they turned off.
export async function reactivateCorrection(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("competitor_corrections").update({ expired_at: null }).eq("id", id);
    if (error) throw error;
    return;
  }
  const row = memoryDb.competitorCorrections.find(c => c.id === id);
  if (row) row.expiredAt = null;
}
