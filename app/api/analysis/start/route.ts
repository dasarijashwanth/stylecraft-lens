import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { AnalysisFormSchema } from "@/lib/validations";
import { createAnalysis } from "@/lib/db/analyses";
import { inngest } from "@/lib/inngest/client";

// Replaces POST /api/analyses (kept for the legacy GET list handler) as the
// entry point for the Inngest-driven pipeline: creates the job row and
// enqueues it, then returns immediately. No AI/external work runs in this
// request — lib/inngest/functions/analyze-product.ts does all of that,
// immune to this route's own execution limit since it's driven by
// Inngest's infrastructure calling app/api/inngest/route.ts one step at a
// time, not by this request staying open.
export async function POST(request: Request) {
  try {
    const session = await getAuthSession();
    const body = await request.json();

    const validation = AnalysisFormSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "Validation failed", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const data = validation.data;
    const { projectId } = body;

    const created = await createAnalysis(session.userId, session.orgId, projectId || undefined, data);

    await inngest.send({ name: "analysis/job.created", data: { jobId: created.id } });

    return NextResponse.json({ jobId: created.id, status: "running" }, { status: 202 });
  } catch (error: any) {
    return NextResponse.json({ error: "SERVER_ERROR", message: error.message }, { status: 500 });
  }
}
