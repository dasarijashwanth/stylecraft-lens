// lib/db/document-fill-state.ts
// Backs the resumable "extract facts -> fill GTM -> fill Content Form"
// chain (Automatic Source-Doc Fact Extraction & Cross-Document Fill) — one
// row per project, same dual-path (Supabase/memoryDb) style and the same
// "one phase per request, checkpointed, self-healing on a stuck run" shape
// as lib/db/generation-state.ts backs the project-creation pipeline. No
// background-job service involved (this app tried Inngest for a similar
// always-running chain and reverted it) — a closed tab just means the chain
// resumes the next time any tab of this project reopens.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb } from "@/lib/memoryDb";

export type FillStatus = "idle" | "running" | "complete" | "failed";
export type FillStep = "gtm" | "content_form";

export interface DocumentFillStateRow {
  project_id: string;
  status: FillStatus;
  steps: FillStep[];
  current_step_index: number;
  triggered_by_doc_id: string | null;
  triggered_by_file_name: string | null;
  results: Record<string, any>;
  started_at: string | null;
  updated_at: string;
}

function mockToRow(r: any): DocumentFillStateRow {
  return {
    project_id: r.projectId,
    status: r.status,
    steps: r.steps,
    current_step_index: r.currentStepIndex,
    triggered_by_doc_id: r.triggeredByDocId,
    triggered_by_file_name: r.triggeredByFileName,
    results: r.results,
    started_at: r.startedAt ? r.startedAt.toISOString() : null,
    updated_at: r.updatedAt.toISOString(),
  };
}

export async function getDocumentFillState(projectId: string): Promise<DocumentFillStateRow | null> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("document_fill_state").select("*").eq("project_id", projectId).maybeSingle();
    if (error) throw error;
    return data;
  }
  const row = memoryDb.documentFillStates.find(s => s.projectId === projectId);
  return row ? mockToRow(row) : null;
}

// Starts (or restarts) the chain for a project — the trigger for both the
// automatic upload-driven flow and a manual "Fill blanks from sources"
// click. `steps` is always the full ["gtm","content_form"] list today (both
// documents always exist or get created on demand by their own refill
// routes) — kept as a parameter rather than a hardcoded constant so a future
// caller could narrow it (e.g. re-run just one step) without a schema change.
export async function startDocumentFillState(
  projectId: string,
  steps: FillStep[],
  triggeredBy?: { docId?: string | null; fileName?: string | null }
): Promise<DocumentFillStateRow> {
  const now = new Date().toISOString();
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("document_fill_state")
      .upsert({
        project_id: projectId, status: "running", steps, current_step_index: 0,
        triggered_by_doc_id: triggeredBy?.docId ?? null, triggered_by_file_name: triggeredBy?.fileName ?? null,
        results: {}, started_at: now, updated_at: now,
      }, { onConflict: "project_id" })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const idx = memoryDb.documentFillStates.findIndex(s => s.projectId === projectId);
  const row = {
    projectId, status: "running", steps, currentStepIndex: 0,
    triggeredByDocId: triggeredBy?.docId ?? null, triggeredByFileName: triggeredBy?.fileName ?? null,
    results: {}, startedAt: new Date(), updatedAt: new Date(),
  };
  if (idx >= 0) memoryDb.documentFillStates[idx] = row;
  else memoryDb.documentFillStates.push(row);
  return mockToRow(row);
}

export async function updateDocumentFillState(
  projectId: string,
  update: { status?: FillStatus; currentStepIndex?: number; resultsPatch?: Record<string, any> }
): Promise<void> {
  const now = new Date().toISOString();
  if (isSupabaseConfigured) {
    const existing = await getDocumentFillState(projectId);
    const patch: any = { updated_at: now };
    if (update.status) patch.status = update.status;
    if (update.currentStepIndex !== undefined) patch.current_step_index = update.currentStepIndex;
    if (update.resultsPatch) patch.results = { ...(existing?.results || {}), ...update.resultsPatch };
    const { error } = await supabaseAdmin.from("document_fill_state").update(patch).eq("project_id", projectId);
    if (error) throw error;
    return;
  }

  const row = memoryDb.documentFillStates.find(s => s.projectId === projectId);
  if (row) {
    if (update.status) row.status = update.status;
    if (update.currentStepIndex !== undefined) row.currentStepIndex = update.currentStepIndex;
    if (update.resultsPatch) row.results = { ...row.results, ...update.resultsPatch };
    row.updatedAt = new Date();
  }
}

// Same self-heal reasoning as lib/db/generation-state.ts's
// reclaimStaleRunningState — a hard platform kill mid-step isn't a catchable
// exception, so a row can get stuck at status:"running" forever. Called
// lazily wherever fill state is read (never a proactive cron/sweep, per this
// app's own no-queue-infra convention).
export const STALE_RUNNING_THRESHOLD_MS = 120_000;

export async function reclaimStaleRunningFillState(projectId: string): Promise<DocumentFillStateRow | null> {
  const state = await getDocumentFillState(projectId);
  if (!state || state.status !== "running") return state;

  const staleMs = Date.now() - new Date(state.updated_at).getTime();
  if (staleMs < STALE_RUNNING_THRESHOLD_MS) return state;

  await updateDocumentFillState(projectId, { status: "failed" });
  return getDocumentFillState(projectId);
}
