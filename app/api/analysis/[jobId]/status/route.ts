import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis } from "@/lib/db/analyses";
import { getTasksForJob, summarizeTasks } from "@/lib/db/analysis-tasks";

// Polled every ~2.5s by components/analyze/ProgressPanel.tsx — deliberately
// a plain DB read (analyses + analysis_tasks), not a call into Inngest's own
// API, so it stays cheap under many concurrently open tabs. This is the
// entire replacement for the old "POST /continue and hope the response
// arrives before the function times out" round trip; the job itself keeps
// running via Inngest regardless of whether anyone is polling.
const PHASE_LABELS = [
  "Identifying the product",
  "Researching large brand competitors",
  "Researching indie & emerging competitors",
  "Synthesizing market analysis & strategic recommendations",
];

export async function GET(request: Request, { params }: { params: { jobId: string } }) {
  try {
    await getAuthSession();
    const { jobId } = params;

    const analysis: any = await getAnalysis(jobId);
    if (!analysis) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Analysis not found" }, { status: 404 });
    }

    const tasks = await getTasksForJob(jobId);
    const summary = summarizeTasks(tasks);
    const phase4Tasks = tasks.filter(t => t.task_key.startsWith("phase4:"));

    // Derived live from the task list on every poll rather than trusting
    // the DB-persisted job_status column — that column is only written
    // once, by the orchestrator's final "recompute-job-status" step, which
    // itself only runs after synthesis AND every phase4 task settles. The
    // legacy `status` column can flip to "complete" the moment synthesis
    // finishes even while phase4's per-competitor tasks are still
    // genuinely in flight (they run in parallel, not after synthesis), so
    // a stale job_status read would report "complete" too early.
    let status: "running" | "partial_complete" | "complete" | "failed";
    if (analysis.status === "failed") {
      status = "failed";
    } else if (analysis.status !== "complete") {
      status = "running";
    } else {
      const inFlight = phase4Tasks.some(t => t.status === "running" || t.status === "pending");
      const anyFailed = phase4Tasks.some(t => t.status === "failed");
      status = inFlight ? "running" : anyFailed ? "partial_complete" : "complete";
    }

    const currentPhase = Math.min(analysis.phase ?? 0, PHASE_LABELS.length - 1);

    const sections: Record<string, string> = {};
    const taskDetails: Record<string, { status: string; error: string | null; errorClass: string | null; provider: string | null; attempts: number }> = {};
    for (const t of tasks) {
      sections[t.task_key] = t.status;
      taskDetails[t.task_key] = { status: t.status, error: t.error, errorClass: t.error_class, provider: t.provider, attempts: t.attempts };
    }

    return NextResponse.json({
      jobId,
      status,
      phase: {
        current: currentPhase + 1,
        total: PHASE_LABELS.length,
        label: PHASE_LABELS[currentPhase],
      },
      tasks: summary,
      sections,
      taskDetails,
      totalSearches: analysis.total_searches ?? 0,
      pendingQuestion: analysis.pending_question ?? null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: "SERVER_ERROR", message: error.message }, { status: 500 });
  }
}
