// lib/db/grooming-gate-rules.ts
// CRUD over grooming_gate_rules (the admin-editable allow/block category
// segments, required/disqualifying keywords, trimmer co-signal words,
// component disqualifiers, cross-domain use phrases, and confidence
// threshold that lib/grooming-industry-gate.ts's passesGroomingIndustryGate()
// checks candidates against) plus grooming_gate_incidents (the per-candidate
// rejection audit log surfaced on /dashboard/admin/competitor-matching).
// Mirrors lib/db/motor-families.ts's exact dual-path CRUD style. memoryDb is
// always pre-seeded with the ticket's own default rules (see
// lib/memoryDb.ts's seedGroomingGateRuleDefaults) — real default
// configuration, not an empty admin-fills-it-in table.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockGroomingGateRule, MockGroomingGateIncident } from "@/lib/memoryDb";

export interface GroomingGateRuleRow {
  id: string;
  rule_type: string;
  value: string;
  label: string | null;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mockRuleToRow(r: MockGroomingGateRule): GroomingGateRuleRow {
  return {
    id: r.id,
    rule_type: r.ruleType,
    value: r.value,
    label: r.label,
    enabled: r.enabled,
    sort_order: r.sortOrder,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

export async function listGroomingGateRules(): Promise<GroomingGateRuleRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("grooming_gate_rules").select("*").order("sort_order");
    if (error) throw error;
    return data || [];
  }
  return [...memoryDb.groomingGateRules].sort((a, b) => a.sortOrder - b.sortOrder).map(mockRuleToRow);
}

// The confidence_threshold rule_type is stored as a singleton row (value is
// its string-encoded number) rather than a 9th tiny config table — see the
// plan's own explicit trade-off note. Defaults to 0.4 if no row exists yet.
export async function getGroomingGateConfidenceThreshold(): Promise<number> {
  const rules = await listGroomingGateRules();
  const row = rules.find(r => r.rule_type === "confidence_threshold" && r.enabled);
  const parsed = row ? Number(row.value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0.4;
}

export async function addGroomingGateRule(input: {
  ruleType: string;
  value: string;
  label?: string | null;
}): Promise<GroomingGateRuleRow> {
  if (isSupabaseConfigured) {
    const { data: existing } = await supabaseAdmin
      .from("grooming_gate_rules")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = (existing?.sort_order ?? -1) + 1;
    const { data, error } = await supabaseAdmin
      .from("grooming_gate_rules")
      .insert({ rule_type: input.ruleType, value: input.value, label: input.label ?? null, sort_order: nextSort })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const now = new Date();
  const nextSort = memoryDb.groomingGateRules.length ? Math.max(...memoryDb.groomingGateRules.map(r => r.sortOrder)) + 1 : 0;
  const row: MockGroomingGateRule = {
    id: `ggrule_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    ruleType: input.ruleType,
    value: input.value,
    label: input.label ?? null,
    enabled: true,
    sortOrder: nextSort,
    createdAt: now,
    updatedAt: now,
  };
  memoryDb.groomingGateRules.push(row);
  return mockRuleToRow(row);
}

export async function updateGroomingGateRule(
  id: string,
  patch: { value?: string; label?: string | null; enabled?: boolean; sortOrder?: number }
): Promise<GroomingGateRuleRow | null> {
  if (isSupabaseConfigured) {
    const dbPatch: any = { updated_at: new Date().toISOString() };
    if (patch.value !== undefined) dbPatch.value = patch.value;
    if (patch.label !== undefined) dbPatch.label = patch.label;
    if (patch.enabled !== undefined) dbPatch.enabled = patch.enabled;
    if (patch.sortOrder !== undefined) dbPatch.sort_order = patch.sortOrder;
    const { data, error } = await supabaseAdmin.from("grooming_gate_rules").update(dbPatch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  const row = memoryDb.groomingGateRules.find(r => r.id === id);
  if (!row) return null;
  if (patch.value !== undefined) row.value = patch.value;
  if (patch.label !== undefined) row.label = patch.label;
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.sortOrder !== undefined) row.sortOrder = patch.sortOrder;
  row.updatedAt = new Date();
  return mockRuleToRow(row);
}

export async function deleteGroomingGateRule(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("grooming_gate_rules").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  const idx = memoryDb.groomingGateRules.findIndex(r => r.id === id);
  if (idx >= 0) memoryDb.groomingGateRules.splice(idx, 1);
}

export async function reorderGroomingGateRules(orderedIds: string[]): Promise<void> {
  if (isSupabaseConfigured) {
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await supabaseAdmin.from("grooming_gate_rules").update({ sort_order: i, updated_at: new Date().toISOString() }).eq("id", orderedIds[i]);
      if (error) throw error;
    }
    return;
  }
  orderedIds.forEach((id, i) => {
    const row = memoryDb.groomingGateRules.find(r => r.id === id);
    if (row) {
      row.sortOrder = i;
      row.updatedAt = new Date();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Anomaly log — grooming_gate_incidents. Logged from two places: the 1E
// post-selection sweep (lib/analysisEngine.ts's sweepGroomingGateContamination,
// phase: 'phase1'|'phase2', failed_rule populated) and a manual "wrong
// industry" Remove (phase: 'manual_removal', failed_rule: null — a human
// flagged it, the automated gate never actually tripped). Fire-and-forget
// from both call sites, mirroring lib/db/motor-families.ts's
// logMotorTechMiss/logBrandedMotorMiss (never awaited in the scoring/removal
// hot path — a logging hiccup must never block the real operation).
// ─────────────────────────────────────────────────────────────────────────

export interface GroomingGateIncidentRow {
  id: string;
  analysis_id: string | null;
  phase: string;
  candidate_name: string | null;
  candidate_asin: string | null;
  candidate_brand: string | null;
  category_path: string | null;
  failed_rule: string | null;
  detail: string | null;
  dismissed_at: string | null;
  created_at: string;
}

function mockIncidentToRow(i: MockGroomingGateIncident): GroomingGateIncidentRow {
  return {
    id: i.id,
    analysis_id: i.analysisId,
    phase: i.phase,
    candidate_name: i.candidateName,
    candidate_asin: i.candidateAsin,
    candidate_brand: i.candidateBrand,
    category_path: i.categoryPath,
    failed_rule: i.failedRule,
    detail: i.detail,
    dismissed_at: i.dismissedAt ? i.dismissedAt.toISOString() : null,
    created_at: i.createdAt.toISOString(),
  };
}

export async function logGroomingGateIncident(input: {
  analysisId?: string | null;
  phase: "phase1" | "phase2" | "manual_removal";
  candidateName?: string | null;
  candidateAsin?: string | null;
  candidateBrand?: string | null;
  categoryPath?: string | null;
  failedRule?: string | null;
  detail?: string | null;
}): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("grooming_gate_incidents").insert({
      analysis_id: input.analysisId ?? null,
      phase: input.phase,
      candidate_name: input.candidateName ?? null,
      candidate_asin: input.candidateAsin ?? null,
      candidate_brand: input.candidateBrand ?? null,
      category_path: input.categoryPath ?? null,
      failed_rule: input.failedRule ?? null,
      detail: input.detail ?? null,
    });
    if (error) throw error;
    return;
  }
  memoryDb.groomingGateIncidents.push({
    id: `ggincident_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    analysisId: input.analysisId ?? null,
    phase: input.phase,
    candidateName: input.candidateName ?? null,
    candidateAsin: input.candidateAsin ?? null,
    candidateBrand: input.candidateBrand ?? null,
    categoryPath: input.categoryPath ?? null,
    failedRule: input.failedRule ?? null,
    detail: input.detail ?? null,
    dismissedAt: null,
    createdAt: new Date(),
  });
}

// Newest-first, non-dismissed only — each row is candidate-specific (unlike
// motor-families' misses, which group repeated free-text terms), so no
// count-grouping is applied here.
export async function getGroomingGateIncidents(limit = 100): Promise<GroomingGateIncidentRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("grooming_gate_incidents")
      .select("*")
      .is("dismissed_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }
  return memoryDb.groomingGateIncidents
    .filter(i => !i.dismissedAt)
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map(mockIncidentToRow);
}

export async function dismissGroomingGateIncident(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("grooming_gate_incidents").update({ dismissed_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    return;
  }
  const row = memoryDb.groomingGateIncidents.find(i => i.id === id);
  if (row) row.dismissedAt = new Date();
}
