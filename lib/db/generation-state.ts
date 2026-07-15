// lib/db/generation-state.ts
// Backs the resumable project-creation pipeline (capture snapshot ->
// generate TDS -> generate GTM). One row per project, upserted — same
// dual-path (Supabase/memoryDb) style as the rest of lib/db/*.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb } from "@/lib/memoryDb";

export type GenerationPhase = "pending" | "snapshot" | "tds" | "gtm";
export type GenerationStatus = "pending" | "running" | "complete" | "failed";

export interface GenerationStateRow {
  project_id: string;
  phase: GenerationPhase;
  status: GenerationStatus;
  error_message: string | null;
  updated_at: string;
}

export async function getGenerationState(projectId: string): Promise<GenerationStateRow | null> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("project_generation_state")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  const row = memoryDb.projectGenerationState.find(s => s.projectId === projectId);
  if (!row) return null;
  return { project_id: row.projectId, phase: row.phase as GenerationPhase, status: row.status as GenerationStatus, error_message: row.errorMessage, updated_at: row.updatedAt.toISOString() };
}

// `opts.phase` lets a caller seed the pipeline past phases it already knows
// are done — e.g. the backfill script starting a project that already has a
// TDS document straight at "tds" instead of redoing snapshot capture.
export async function startGenerationState(projectId: string, opts?: { phase?: GenerationPhase }): Promise<GenerationStateRow> {
  const now = new Date().toISOString();
  const phase = opts?.phase ?? "pending";
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("project_generation_state")
      .upsert({ project_id: projectId, phase, status: "pending", error_message: null, updated_at: now }, { onConflict: "project_id" })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const idx = memoryDb.projectGenerationState.findIndex(s => s.projectId === projectId);
  const row = { projectId, phase, status: "pending", errorMessage: null, updatedAt: new Date() };
  if (idx >= 0) memoryDb.projectGenerationState[idx] = row;
  else memoryDb.projectGenerationState.push(row);
  return { project_id: projectId, phase, status: "pending", error_message: null, updated_at: row.updatedAt.toISOString() };
}

// The one primitive the existing phase-continue pattern was missing: a way
// to actually retry after `status` has settled to "failed". Deliberately
// does NOT touch `phase` — /continue re-reads it and resumes exactly where
// generation stopped, it just needed permission to run again.
export async function retryFailedGeneration(projectId: string): Promise<GenerationStateRow | null> {
  const state = await getGenerationState(projectId);
  if (!state || state.status !== "failed") return state;

  const now = new Date().toISOString();
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("project_generation_state")
      .update({ status: "running", error_message: null, updated_at: now })
      .eq("project_id", projectId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const row = memoryDb.projectGenerationState.find(s => s.projectId === projectId);
  if (row) {
    row.status = "running";
    row.errorMessage = null;
    row.updatedAt = new Date();
  }
  return getGenerationState(projectId);
}

export async function updateGenerationState(
  projectId: string,
  update: { phase?: GenerationPhase; status: GenerationStatus; errorMessage?: string | null }
): Promise<void> {
  const now = new Date().toISOString();
  if (isSupabaseConfigured) {
    const patch: any = { status: update.status, updated_at: now };
    if (update.phase) patch.phase = update.phase;
    if (update.errorMessage !== undefined) patch.error_message = update.errorMessage;
    const { error } = await supabaseAdmin.from("project_generation_state").update(patch).eq("project_id", projectId);
    if (error) throw error;
    return;
  }

  const row = memoryDb.projectGenerationState.find(s => s.projectId === projectId);
  if (row) {
    row.status = update.status;
    if (update.phase) row.phase = update.phase;
    if (update.errorMessage !== undefined) row.errorMessage = update.errorMessage;
    row.updatedAt = new Date();
  }
}
