import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { runProjectGenerationStep } from "@/lib/project-generation-engine";

// Runs exactly one phase of the project-creation pipeline and returns
// immediately — mirrors app/api/analyses/[id]/continue/route.ts exactly.
// The client calls this repeatedly until status is "complete"/"failed"
// (see components/projects/ProjectGenerationProgress.tsx).
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const result = await runProjectGenerationStep(params.id, session.orgId, session.userId);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to continue pipeline" }, { status: 500 });
  }
}
