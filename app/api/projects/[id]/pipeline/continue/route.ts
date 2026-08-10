import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { runProjectGenerationStep } from "@/lib/project-generation-engine";
import { checkRateLimit } from "@/lib/rate-limit";

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

    // Security audit fix — same reasoning as app/api/analyses/[id]/continue/
    // route.ts's fix: a tight per-resource burst guard stops concurrent
    // requests against the SAME project from multiplying one phase's real
    // AI/scrape spend, and a looser per-user cap bounds sustained abuse
    // spread across many projects.
    const burstGuard = await checkRateLimit({ eventType: "pipeline_continue", userId: `${session.userId}:${params.id}`, maxAttempts: 1, windowMinutes: 0.05 });
    if (burstGuard.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "This project's pipeline is already being processed — try again in a few seconds." }, { status: 429 });
    }
    const hourlyGuard = await checkRateLimit({ eventType: "pipeline_continue", userId: session.userId, maxAttempts: 200, windowMinutes: 60 });
    if (hourlyGuard.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: `Too many pipeline requests — please wait ${hourlyGuard.retryAfterMinutes} minutes and try again.` }, { status: 429 });
    }

    const result = await runProjectGenerationStep(params.id, session.orgId, session.userId);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to continue pipeline" }, { status: 500 });
  }
}
