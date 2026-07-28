import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis, cancelAnalysis } from "@/lib/db/analyses";

// User-initiated stop (the "Cancel" button in components/analyze/ProgressPanel.tsx).
// Marks the analysis "cancelled" so any stray/in-flight .../continue call
// no-ops instead of running a further phase (see the terminal-status guard
// in lib/analysisEngine.ts's runAnalysisStep) — the client itself only
// stops ASKING for more phases, it can't reach into and kill work already
// dispatched to the server.
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
    if (existing.status === "complete" || existing.status === "failed" || existing.status === "cancelled") {
      // Already terminal — nothing to cancel, not an error.
      return NextResponse.json({ ok: true, status: existing.status });
    }

    await cancelAnalysis(id);
    return NextResponse.json({ ok: true, status: "cancelled" });
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
