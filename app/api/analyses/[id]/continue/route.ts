import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis } from "@/lib/db/analyses";
import { runAnalysisStep } from "@/lib/analysisEngine";

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
