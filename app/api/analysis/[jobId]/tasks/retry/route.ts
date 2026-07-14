import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis } from "@/lib/db/analyses";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { getFailedTaskKeys, resetTasksForRetry, sweepStaleTasks } from "@/lib/db/analysis-tasks";
import { inngest } from "@/lib/inngest/client";

// Re-enqueues ONLY the failed task(s) — omitting taskKeys resolves to "all
// currently failed" (backs the "Retry all failed" button). For the
// sequential phase0-3 pipeline, a "retry" is: reset the failed
// analysis_tasks row + the job's own status back to "running" (so
// runAnalysisStep doesn't short-circuit on an already-failed record), then
// re-send the same job-created event — the orchestrator's loop picks up
// exactly where it left off since runAnalysisStep always resumes from
// whatever phase/status is currently persisted. Nothing already `done` is
// re-executed.
export async function POST(request: Request, { params }: { params: { jobId: string } }) {
  try {
    await getAuthSession();
    const { jobId } = params;

    const analysis = await getAnalysis(jobId);
    if (!analysis) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Analysis not found" }, { status: 404 });
    }

    let body: { taskKeys?: string[] } = {};
    try {
      body = await request.json();
    } catch {
      // empty body is valid — falls through to "retry all failed"
    }

    // Catches a task abandoned by a killed function invocation (see
    // lib/db/analysis-tasks.ts's sweepStaleTasks) before deciding what
    // "all failed" means — otherwise a stuck-but-not-yet-swept task
    // wouldn't be included in a "Retry all failed" click.
    await sweepStaleTasks(jobId);

    const taskKeys = body.taskKeys && body.taskKeys.length > 0 ? body.taskKeys : await getFailedTaskKeys(jobId);
    if (taskKeys.length === 0) {
      return NextResponse.json({ accepted: [] }, { status: 202 });
    }

    await resetTasksForRetry(jobId, taskKeys);

    if (isSupabaseConfigured) {
      await supabaseAdmin
        .from("analyses")
        .update({ status: "running", error_message: null, job_status: "running" })
        .eq("id", jobId)
        .eq("status", "failed");
    }

    await inngest.send({ name: "analysis/job.created", data: { jobId } });

    return NextResponse.json({ accepted: taskKeys }, { status: 202 });
  } catch (error: any) {
    return NextResponse.json({ error: "SERVER_ERROR", message: error.message }, { status: 500 });
  }
}
