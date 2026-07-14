// Durable replacement for the old "client polls POST /api/analyses/:id/
// continue" architecture (app/api/analyses/[id]/continue/route.ts,
// components/analyze/ProgressPanel.tsx's fetchJsonWithRetry loop — the
// literal source of the reported "Connection dropped — retrying (1)…").
//
// runAnalysisStep (lib/analysisEngine.ts) is reused entirely unchanged: it
// already re-reads the analysis row fresh on every call, runs exactly one
// phase (identify -> established competitors -> emerging competitors ->
// synthesis), and persists that phase's result before returning — i.e. it
// is already shaped exactly like a single durable step. Each call here is
// wrapped in its own step.run(), so Inngest checkpoints it individually and
// no single HTTP request has to hold open the whole multi-phase pipeline;
// Inngest's own infrastructure (not any one Vercel function) is what waits
// between phases and retries a step that failed to respond in time.
import { inngest } from "../client";
import { runAnalysisStep, AnalysisStepResult } from "@/lib/analysisEngine";
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { markTaskRunning, markTaskDone, markTaskFailed, ensureTasks, getTasksForJob, deriveJobStatus } from "@/lib/db/analysis-tasks";
import { resolveCacheKey } from "@/lib/product-cache-key";
import { fetchProductDataWorker, fetchReviewsWorker, fetchNewsWorker, fetchFeaturesWorker } from "./phase4-workers";

// Mirrors lib/analysisEngine.ts's own phase numbering (0=identify,
// 1=established, 2=emerging, 3=synthesis) — kept distinct from the ticket's
// "phase1..phase4" language so there's one unambiguous source of truth for
// what a given `analyses.phase` value means.
const PHASE_TASK_TYPES: Record<number, string> = {
  0: "identify_product",
  1: "discover_established",
  2: "discover_emerging",
  3: "synthesize",
};

function taskKeyForPhase(phase: number): string {
  return `phase:${phase}:${PHASE_TASK_TYPES[phase] ?? "unknown"}`;
}

// Phase 0-3 (identify -> established -> emerging -> synthesis) is strictly
// sequential — a failure there genuinely stalls the whole pipeline before
// phase4 fan-out ever starts, so `analyses.status === "failed"` always
// means job_status "failed" regardless of any phase4 task rows. Once the
// sequential backbone completes, though, phase4's per-competitor tasks
// ARE genuinely independent — one competitor's news search timing out
// doesn't affect another's reviews, so `deriveJobStatus`'s done/failed
// task-count heuristic is the right signal for whether the job is fully
// "complete" or should settle as "partial_complete".
async function recomputeJobStatus(jobId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { data } = await supabaseAdmin.from("analyses").select("status").eq("id", jobId).single();

  if (data?.status === "failed") {
    await supabaseAdmin.from("analyses").update({ job_status: "failed" }).eq("id", jobId);
    return;
  }
  if (data?.status !== "complete") {
    await supabaseAdmin.from("analyses").update({ job_status: "running" }).eq("id", jobId);
    return;
  }

  const phase4Tasks = await getTasksForJob(jobId);
  const jobStatus = deriveJobStatus(phase4Tasks.filter(t => t.task_key.startsWith("phase4:")));
  // deriveJobStatus returns "running" on an empty list (no phase4 tasks —
  // e.g. an analysis with zero competitors) — that's not meaningful here
  // since the sequential backbone already reported "complete".
  await supabaseAdmin
    .from("analyses")
    .update({ job_status: jobStatus === "running" ? "complete" : jobStatus })
    .eq("id", jobId);
}

// A single durable step: figure out which phase is about to run (before
// calling, so the checkpoint's task_key(s) match what actually executes),
// mark it running, call runAnalysisStep exactly once, mark the result.
//
// Phase 1 is a special case: lib/analysisEngine.ts now runs established +
// emerging discovery CONCURRENTLY inside that one call (previously two
// sequential DB-phase steps) since neither's real AI prompt ever actually
// depended on the other's output — this saves ~35-40s of wall-clock time.
// Both task_key rows still get checkpointed together here so the UI's two
// distinct rows ("Researching large brand competitors" / "...indie &
// emerging...") both flip running -> done/failed in lockstep, matching
// what's actually happening under the hood.
async function runOnePhaseStep(jobId: string): Promise<AnalysisStepResult> {
  const before = await supabaseAdmin.from("analyses").select("phase, status, pending_question").eq("id", jobId).single();
  if (before.error) throw before.error;
  const phase = before.data.phase as number;

  // Already terminal or paused on a question — nothing to checkpoint,
  // runAnalysisStep itself no-ops correctly in both cases.
  if (before.data.status === "complete" || before.data.status === "failed" || before.data.pending_question) {
    return runAnalysisStep(jobId);
  }

  const taskKeys = phase === 1 ? ["phase:1:discover_established", "phase:2:discover_emerging"] : [taskKeyForPhase(phase)];
  const taskTypes = phase === 1 ? ["discover_established", "discover_emerging"] : [PHASE_TASK_TYPES[phase] ?? "unknown"];

  await Promise.all(taskKeys.map((k, i) => markTaskRunning(jobId, k, taskTypes[i])));
  const start = Date.now();
  try {
    const result = await runAnalysisStep(jobId);
    if (result.status === "failed") {
      await Promise.all(taskKeys.map(k => markTaskFailed(jobId, k, result.error || "Unknown error", { latencyMs: Date.now() - start })));
    } else {
      await Promise.all(taskKeys.map(k => markTaskDone(jobId, k, { phase: result.phase, totalSearches: result.totalSearches }, { latencyMs: Date.now() - start })));
    }
    // total_searches is otherwise never persisted (updateAnalysisPhase
    // intentionally doesn't write it — see lib/db/analyses.ts:106-107) —
    // a durable job needs it to survive across separate step invocations,
    // unlike the old client-accumulated-in-memory total.
    if (result.totalSearches) {
      const current = await supabaseAdmin.from("analyses").select("total_searches").eq("id", jobId).single();
      await supabaseAdmin
        .from("analyses")
        .update({ total_searches: (current.data?.total_searches ?? 0) + result.totalSearches })
        .eq("id", jobId);
    }
    return result;
  } catch (err: any) {
    await Promise.all(taskKeys.map(k => markTaskFailed(jobId, k, err?.message || "Unknown error", { latencyMs: Date.now() - start })));
    throw err;
  }
}

interface CompetitorFanoutTarget {
  cacheKey: string;
  asin: string | null;
  productName: string;
  brand: string | null;
}

// phase1_result/phase2_result (established/emerging competitors) are both
// available the moment phase 2 finishes — well before synthesis runs — so
// every competitor's four phase4 tasks (product data, reviews, news,
// features) can be dispatched in parallel with synthesis instead of
// waiting for it, unlike the old behavior where CompetitorCard fetches
// only ever started after the whole phase0-3 pipeline (including
// synthesis) had finished.
async function loadCompetitorsForFanout(jobId: string): Promise<CompetitorFanoutTarget[]> {
  if (!isSupabaseConfigured) return [];
  const { data } = await supabaseAdmin.from("analyses").select("phase1_result, phase2_result").eq("id", jobId).single();
  const all = [...(data?.phase1_result?.competitors ?? []), ...(data?.phase2_result?.competitors ?? [])];
  return all
    .filter((c: any) => c?.name)
    .map((c: any) => {
      const isValidAsin = /^[A-Z0-9]{10}$/i.test(c.asin ?? "");
      const asin = isValidAsin ? String(c.asin).toUpperCase() : null;
      return {
        cacheKey: resolveCacheKey(asin ?? "", c.name),
        asin,
        productName: c.name,
        brand: c.brand ?? null,
      };
    });
}

export const analyzeProduct = inngest.createFunction(
  { id: "analyze-product", retries: 2, triggers: { event: "analysis/job.created" } },
  async ({ event, step }) => {
    const jobId: string = event.data.jobId;

    // Hard safety cap — the real terminal condition is `phase` reaching 3
    // (established + emerging discovery both persisted, ready to fan out),
    // this just prevents a genuinely stuck job from looping forever if
    // something upstream never advances `phase`.
    const MAX_SEQUENTIAL_ITERATIONS = 8;
    let reachedFanoutPoint = false;

    for (let i = 0; i < MAX_SEQUENTIAL_ITERATIONS; i++) {
      const result: AnalysisStepResult = await step.run(`run-phase-${i}`, () => runOnePhaseStep(jobId));

      if (result.pendingQuestion) {
        // Durable pause: the browser can close entirely and this run
        // resumes the instant POST /api/analyses/:id/answer fires
        // "analysis/answer.provided" — no client-side polling loop has to
        // stay alive to keep the pipeline "waiting."
        await step.waitForEvent(`wait-for-answer-${i}`, {
          event: "analysis/answer.provided",
          timeout: "24h",
          if: `async.data.jobId == "${jobId}"`,
        });
        continue;
      }

      if (result.status === "failed") break;
      if (result.phase >= 3) { reachedFanoutPoint = true; break; }
    }

    if (reachedFanoutPoint) {
      const competitors = await step.run("load-competitors-for-fanout", () => loadCompetitorsForFanout(jobId));

      await step.run("register-phase4-tasks", () =>
        ensureTasks(
          jobId,
          competitors.flatMap(c => [
            { taskKey: `phase4:${c.cacheKey}:fetch_product_data`, taskType: "fetch_product_data" },
            { taskKey: `phase4:${c.cacheKey}:fetch_reviews`, taskType: "fetch_reviews" },
            { taskKey: `phase4:${c.cacheKey}:fetch_news`, taskType: "fetch_news" },
            { taskKey: `phase4:${c.cacheKey}:fetch_key_features`, taskType: "fetch_key_features" },
          ])
        )
      );

      // Synthesis and every competitor's four phase4 tasks run together —
      // none of them depend on each other's output, only on the already-
      // persisted phase1_result/phase2_result.
      await Promise.all([
        step.run("run-synthesis", () => runOnePhaseStep(jobId)),
        ...competitors.flatMap((c) => {
          const base = { jobId, cacheKey: c.cacheKey, asin: c.asin, productName: c.productName, brand: c.brand };
          return [
            step.invoke(`phase4-${c.cacheKey}-product`, {
              function: fetchProductDataWorker,
              data: { ...base, taskKey: `phase4:${c.cacheKey}:fetch_product_data` },
            }),
            step.invoke(`phase4-${c.cacheKey}-reviews`, {
              function: fetchReviewsWorker,
              data: { ...base, taskKey: `phase4:${c.cacheKey}:fetch_reviews` },
            }),
            step.invoke(`phase4-${c.cacheKey}-news`, {
              function: fetchNewsWorker,
              data: { ...base, taskKey: `phase4:${c.cacheKey}:fetch_news` },
            }),
            step.invoke(`phase4-${c.cacheKey}-features`, {
              function: fetchFeaturesWorker,
              data: { ...base, taskKey: `phase4:${c.cacheKey}:fetch_key_features` },
            }),
          ];
        }),
      ]);
    }

    await step.run("recompute-job-status", () => recomputeJobStatus(jobId));
  }
);
