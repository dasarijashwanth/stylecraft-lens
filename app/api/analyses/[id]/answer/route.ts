import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis, mergeAnalysisContext } from "@/lib/db/analyses";

// Free-text -> one of the 3 tiers lib/our-product-position.ts's
// percentileForManualTier expects — accepts "flagship"/"premium", "entry"/
// "budget", defaulting anything else (including plain "mid") to "mid" (the
// neutral middle, never a guess toward either extreme).
function normalizeLineupTierAnswer(answer: string): "flagship" | "mid" | "entry" {
  const lower = answer.toLowerCase();
  if (/(flagship|premium|top)/.test(lower)) return "flagship";
  if (/(entry|budget|basic|starter)/.test(lower)) return "entry";
  return "mid";
}

// Answers a paused question — Product Identification (see
// lib/product-identification.ts's needsUserInput gate), a missing target
// price, a missing motor type, or a missing lineup tier (see
// lib/analysisEngine.ts's resolveDiscoveryTargetPrice/resolveOurMotorType/
// resolveOurLineupTier gates in Phase 1/2). Merges the answer into the
// matching context field and clears pending_question — phase stays where
// it is, so the next POST .../continue simply re-attempts whatever paused,
// which now trusts the user-supplied value directly rather than pausing
// again. `pending_question.field` defaults to "category" for old paused
// questions that predate this field (never explicitly set). "motorType"
// merges into motorTech — the SAME context field the analyze/project-new
// forms' existing "Motor technology" select already populates, so
// resolveOurMotorType's existing motorTech-matching step picks it up with
// no new context field needed.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const { answer } = await request.json() as { answer: string };
    if (!answer || !answer.trim()) {
      return NextResponse.json({ error: "ANSWER_REQUIRED", message: "An answer is required" }, { status: 400 });
    }

    const existing = await getAnalysis(params.id);
    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Analysis not found" }, { status: 404 });
    }
    if (existing.user_id !== session.userId) {
      return NextResponse.json({ error: "FORBIDDEN", message: "Not your analysis" }, { status: 403 });
    }

    const pausedField = existing.pending_question?.field;
    const field =
      pausedField === "pricePoint" ? "pricePoint" :
      pausedField === "motorType" ? "motorTech" :
      pausedField === "lineupTier" ? "lineupTier" :
      "category";
    const value = field === "lineupTier" ? normalizeLineupTierAnswer(answer.trim()) : answer.trim();
    await mergeAnalysisContext(params.id, { [field]: value });
    const analysis = await getAnalysis(params.id);
    return NextResponse.json({ analysis });
  } catch (error: any) {
    return NextResponse.json({ error: "SERVER_ERROR", message: error.message }, { status: 500 });
  }
}
