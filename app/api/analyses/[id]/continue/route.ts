import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis } from "@/lib/db/analyses";
import { runAnalysisStep } from "@/lib/analysisEngine";
import { checkRateLimit } from "@/lib/rate-limit";

// Runs exactly one phase of the analysis pipeline and returns immediately.
// The client calls this repeatedly (once per phase) until status is
// "complete"/"failed" — see components/analyze/ProgressPanel.tsx. Each call
// is a short, independent request, so it stays well under Vercel's
// serverless duration cap regardless of plan.
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getAuthSession();
    const { id } = params;

    const existing = await getAnalysis(id);
    if (!existing) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Analysis not found" },
        { status: 404 }
      );
    }
    if (existing.user_id !== session.userId) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "Not your analysis" },
        { status: 403 }
      );
    }

    // Security audit fix — this route had no rate limit or concurrency
    // guard at all: runAnalysisStep only short-circuits on a terminal
    // status, so N concurrent POSTs to the SAME analysis id each
    // independently re-ran the same phase's real Rainforest/OpenAI/web-
    // search calls, multiplying spend per analysis with no bound from the
    // separate "starting an analysis" rate limit. A tight per-resource
    // burst guard (keyed by analysis id, not just user) stops that
    // multiplication while a normal sequential polling loop — which
    // naturally paces itself, since each call takes real seconds to
    // resolve a phase — never comes close to it; a looser per-user cap
    // bounds sustained abuse spread across many analyses.
    const burstGuard = await checkRateLimit({ eventType: "analysis_continue", userId: `${session.userId}:${id}`, maxAttempts: 1, windowMinutes: 0.05 });
    if (burstGuard.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "This analysis is already being processed — try again in a few seconds." }, { status: 429 });
    }
    const hourlyGuard = await checkRateLimit({ eventType: "analysis_continue", userId: session.userId, maxAttempts: 200, windowMinutes: 60 });
    if (hourlyGuard.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: `Too many pipeline requests — please wait ${hourlyGuard.retryAfterMinutes} minutes and try again.` }, { status: 429 });
    }

    const step = await runAnalysisStep(id);
    const analysis = await getAnalysis(id);

    return NextResponse.json({ analysis, step });
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
