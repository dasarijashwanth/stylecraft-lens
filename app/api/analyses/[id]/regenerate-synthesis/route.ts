import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis } from "@/lib/db/analyses";
import { resetPhase3ForRegeneration } from "@/lib/db/analyses";

// Manually re-opens Phase 3 (synthesis) after a competitor swap left
// possibly-stale strategy text (see lib/analysisEngine.ts's
// phase3MentionsCompetitor / phase3_result.synthesis_possibly_stale). No
// new state-machine code — resets phase/status back to what a fresh
// analysis looks like right as it reaches Phase 3, so the client's
// existing POST .../continue polling loop re-runs the exact same
// synthesis branch runAnalysisStep already has.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const existing = await getAnalysis(params.id);
    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Analysis not found" }, { status: 404 });
    }
    if (existing.user_id !== session.userId) {
      return NextResponse.json({ error: "FORBIDDEN", message: "Not your analysis" }, { status: 403 });
    }
    if (!existing.phase1_result || !existing.phase2_result) {
      return NextResponse.json({ error: "VALIDATION_FAILED", message: "This analysis hasn't reached synthesis yet" }, { status: 400 });
    }

    await resetPhase3ForRegeneration(params.id);
    return NextResponse.json({ analysisId: params.id, phase: 3, status: "running" });
  } catch (error: any) {
    return NextResponse.json({ error: "SERVER_ERROR", message: error.message }, { status: 500 });
  }
}
