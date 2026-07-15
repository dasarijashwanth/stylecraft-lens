import { NextResponse } from "next/server";
import { getGenerationState, retryFailedGeneration } from "@/lib/db/generation-state";

// The one primitive the phase-continue pattern was missing: today a failed
// pipeline has no way to actually retry (the client only reset its own local
// state). This flips status back to "running" without touching phase, so
// the client's next pipeline/continue call resumes exactly where generation
// stopped, safely (that route already re-reads the current phase every time).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const state = await getGenerationState(params.id);
    if (!state) return NextResponse.json({ error: "No generation pipeline found for this project" }, { status: 404 });
    if (state.status !== "failed") {
      return NextResponse.json({ error: "Pipeline is not in a failed state" }, { status: 400 });
    }

    const updated = await retryFailedGeneration(params.id);
    return NextResponse.json({ state: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to retry pipeline" }, { status: 500 });
  }
}
