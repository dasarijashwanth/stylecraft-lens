import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { runProjectGenerationStep } from "@/lib/project-generation-engine";

// Runs exactly one phase of the project-creation pipeline and returns
// immediately — mirrors app/api/analyses/[id]/continue/route.ts exactly.
// The client calls this repeatedly until status is "complete"/"failed"
// (see components/projects/ProjectGenerationProgress.tsx).
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    // Checked HERE, before calling into the shared engine — that function's
    // own internal ownership check (lib/project-generation-engine.ts) runs
    // after an early-return for status "complete"/"failed", which let a
    // caller read another org's pipeline state/error message for a project
    // in either of those states. The engine function itself is also called
    // by trusted service-role scripts (scripts/backfill-gtm.ts etc.) with
    // no real "requesting user" to check against, so the fix belongs at
    // this route boundary, not inside the shared function.
    const project = await getProject(params.id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const result = await runProjectGenerationStep(params.id, session.orgId, session.userId);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to continue pipeline" }, { status: 500 });
  }
}
