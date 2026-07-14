import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis, mergeAnalysisContext } from "@/lib/db/analyses";

// Answers a paused Product Identification question (see
// lib/product-identification.ts's needsUserInput gate). Merges the
// answer into context.category and clears pending_question — phase stays
// where it is, so the next POST .../continue retries identification,
// which now trusts the user-supplied category directly rather than
// pausing again.
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

    await mergeAnalysisContext(params.id, { category: answer.trim() });
    const analysis = await getAnalysis(params.id);
    return NextResponse.json({ analysis });
  } catch (error: any) {
    return NextResponse.json({ error: "SERVER_ERROR", message: error.message }, { status: 500 });
  }
}
