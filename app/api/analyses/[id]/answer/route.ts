import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis, mergeAnalysisContext } from "@/lib/db/analyses";

// Answers a paused question — either Product Identification (see
// lib/product-identification.ts's needsUserInput gate) or, now, a missing
// target price (see lib/analysisEngine.ts's resolveDiscoveryTargetPrice
// gate before Phase 1 competitor discovery). Merges the answer into the
// matching context field and clears pending_question — phase stays where
// it is, so the next POST .../continue simply re-attempts whatever paused,
// which now trusts the user-supplied value directly rather than pausing
// again. `pending_question.field` defaults to "category" for old paused
// questions that predate this field (never explicitly set).
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

    const field = existing.pending_question?.field === "pricePoint" ? "pricePoint" : "category";
    await mergeAnalysisContext(params.id, { [field]: answer.trim() });
    const analysis = await getAnalysis(params.id);
    return NextResponse.json({ analysis });
  } catch (error: any) {
    return NextResponse.json({ error: "SERVER_ERROR", message: error.message }, { status: 500 });
  }
}
