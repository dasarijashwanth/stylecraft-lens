// Per-task checkpointing for the Inngest-driven analysis pipeline
// (supabase_schema.sql's analysis_tasks table). This is Supabase-only —
// durable multi-step background jobs need a datastore every step
// invocation (a separate HTTP request/process) can see, which the
// process-local memoryDb fallback used elsewhere in lib/db/*.ts cannot
// provide. Inngest itself is only wired up when isSupabaseConfigured.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";

export type TaskStatus = "pending" | "running" | "done" | "failed";
export type ErrorClass = "timeout" | "rate_limited" | "provider_down" | "validation" | "unknown";

export interface AnalysisTaskRow {
  id: string;
  job_id: string;
  task_key: string;
  task_type: string;
  status: TaskStatus;
  attempts: number;
  max_attempts: number;
  provider: string | null;
  error_class: ErrorClass | null;
  error: string | null;
  latency_ms: number | null;
  result: any;
  updated_at: string;
  completed_at: string | null;
}

// Idempotent — call at the start of a job to pre-register every task this
// run will need before any of them execute, so the status endpoint can
// show "pending" counts even before Inngest gets around to running them.
export async function ensureTasks(jobId: string, tasks: { taskKey: string; taskType: string }[]): Promise<void> {
  if (!isSupabaseConfigured || tasks.length === 0) return;
  const { error } = await supabaseAdmin
    .from("analysis_tasks")
    .upsert(
      tasks.map(t => ({ job_id: jobId, task_key: t.taskKey, task_type: t.taskType })),
      { onConflict: "job_id,task_key", ignoreDuplicates: true }
    );
  if (error) throw error;
}

export async function getTask(jobId: string, taskKey: string): Promise<AnalysisTaskRow | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabaseAdmin
    .from("analysis_tasks")
    .select("*")
    .eq("job_id", jobId)
    .eq("task_key", taskKey)
    .maybeSingle();
  if (error) throw error;
  return data as AnalysisTaskRow | null;
}

export async function getTasksForJob(jobId: string): Promise<AnalysisTaskRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabaseAdmin
    .from("analysis_tasks")
    .select("*")
    .eq("job_id", jobId);
  if (error) throw error;
  return (data ?? []) as AnalysisTaskRow[];
}

export async function markTaskRunning(jobId: string, taskKey: string, taskType: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const existing = await getTask(jobId, taskKey);
  const { error } = await supabaseAdmin
    .from("analysis_tasks")
    .upsert(
      {
        job_id: jobId,
        task_key: taskKey,
        task_type: taskType,
        status: "running",
        attempts: (existing?.attempts ?? 0) + 1,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "job_id,task_key" }
    );
  if (error) throw error;
}

export async function markTaskDone(jobId: string, taskKey: string, result: any, opts?: { provider?: string; latencyMs?: number }): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await supabaseAdmin
    .from("analysis_tasks")
    .update({
      status: "done",
      result: result ?? null,
      provider: opts?.provider ?? null,
      latency_ms: opts?.latencyMs ?? null,
      error: null,
      error_class: null,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .eq("task_key", taskKey);
  if (error) throw error;
}

export async function markTaskFailed(
  jobId: string,
  taskKey: string,
  error: string,
  opts?: { provider?: string; errorClass?: ErrorClass; latencyMs?: number }
): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error: dbError } = await supabaseAdmin
    .from("analysis_tasks")
    .update({
      status: "failed",
      error,
      error_class: opts?.errorClass ?? "unknown",
      provider: opts?.provider ?? null,
      latency_ms: opts?.latencyMs ?? null,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .eq("task_key", taskKey);
  if (dbError) throw dbError;
}

// Resets a task back to pending with a fresh attempt counter — the
// section-level "Retry" button's effect. Does NOT re-run anything itself;
// the caller must still fire the Inngest event that dispatches to the
// underlying task runner.
export async function resetTasksForRetry(jobId: string, taskKeys: string[]): Promise<void> {
  if (!isSupabaseConfigured || taskKeys.length === 0) return;
  const { error } = await supabaseAdmin
    .from("analysis_tasks")
    .update({ status: "pending", attempts: 0, error: null, error_class: null, updated_at: new Date().toISOString() })
    .eq("job_id", jobId)
    .in("task_key", taskKeys);
  if (error) throw error;
}

export async function getFailedTaskKeys(jobId: string): Promise<string[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabaseAdmin
    .from("analysis_tasks")
    .select("task_key")
    .eq("job_id", jobId)
    .eq("status", "failed");
  if (error) throw error;
  return (data ?? []).map((r: any) => r.task_key);
}

// A task stuck "running" past this long almost certainly means the
// underlying Vercel function invocation was killed mid-flight (hit its own
// maxDuration) before any catch block could ever mark it done/failed —
// confirmed live: a stuck synthesize task sat at "running" for 40+ minutes
// with no error ever recorded, since a hard platform kill never lets error-
// handling code run at all. Every task type in this app runs inside a
// function capped at 60s (app/api/inngest/route.ts's maxDuration), so
// anything still "running" well past that genuinely died, not just slow.
const STALE_RUNNING_MS = 90_000;

// Self-healing safety net: called on every status-poll and retry request,
// so a task abandoned by a killed function invocation gets flipped to
// "failed" (and therefore retryable / correctly reported to the UI)
// automatically, rather than staying stuck "running" forever with nothing
// to ever notice it died.
export async function sweepStaleTasks(jobId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  const { error } = await supabaseAdmin
    .from("analysis_tasks")
    .update({
      status: "failed",
      error: "Task stopped responding, likely killed by a platform timeout mid-run — retry to resume.",
      error_class: "timeout",
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .eq("status", "running")
    .lt("updated_at", cutoff);
  if (error) throw error;
}

export interface JobTaskSummary {
  done: number;
  running: number;
  failed: number;
  pending: number;
}

export function summarizeTasks(tasks: AnalysisTaskRow[]): JobTaskSummary {
  const summary: JobTaskSummary = { done: 0, running: 0, failed: 0, pending: 0 };
  for (const t of tasks) summary[t.status] += 1;
  return summary;
}

// Job-level status derived from its tasks — partial_complete is a valid
// terminal state (some sections never resolved after every retry, but the
// job isn't "running" anymore and the rest of the analysis is usable).
export function deriveJobStatus(tasks: AnalysisTaskRow[]): "running" | "partial_complete" | "complete" | "failed" {
  if (tasks.length === 0) return "running";
  const summary = summarizeTasks(tasks);
  if (summary.running > 0 || summary.pending > 0) return "running";
  if (summary.failed === 0) return "complete";
  if (summary.done > 0) return "partial_complete";
  return "failed";
}
