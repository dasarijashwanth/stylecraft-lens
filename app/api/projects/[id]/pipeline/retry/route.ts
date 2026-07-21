import { NextResponse } from "next/server";
import { retryFailedGeneration, reclaimStaleRunningState } from "@/lib/db/generation-state";

// The one primitive the phase-continue pattern was missing: today a failed
// pipeline has no way to actually retry (the client only reset its own local
// state). This flips status back to "running" without touching phase, so
// the client's next pipeline/continue call resumes exactly where generation
// stopped, safely (that route already re-reads the current phase every time).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    // Reclaim a stuck "running" state (a hard platform kill mid-step, never
    // a catchable exception) before the failed-state check below — this way
    // clicking Retry on a card stuck at "running" forever both reclaims AND
    // retries in one click, instead of 400ing with no path forward.
    const state = await reclaimStaleRunningState(params.id);
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
