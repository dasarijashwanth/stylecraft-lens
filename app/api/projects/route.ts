import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { NewProjectSchema } from "@/lib/validations";
import { createProject, getUserProjects } from "@/lib/db/projects";
import { startGenerationState } from "@/lib/db/generation-state";
import { logCall } from "@/lib/obs";

export async function GET(request: Request) {
  try {
    const session = await getAuthSession();
    const projects = await getUserProjects(session.orgId);
    return NextResponse.json({ projects });
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthSession();
    const body = await request.json();

    const validation = NewProjectSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "Validation failed", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const project = await createProject(session.userId, session.orgId, validation.data);

    // Auto-generate GTM (and TDS along the way) for every project, no click
    // required — server-side and atomic with creation, so it doesn't depend
    // on the client's own fetch surviving navigation the way the old
    // fire-and-forget call from projects/new/page.tsx did. A product
    // URL/ASIN is no longer required — lib/project-generation-engine.ts
    // degrades gracefully with no anchor. Never fails project creation
    // itself over a state-row hiccup.
    const startT0 = Date.now();
    try {
      await startGenerationState(project.id);
    } catch (err) {
      // One cheap retry — a transient Supabase blip is the most likely cause
      // and a second attempt costs nothing. If it fails again, log it
      // structurally (was a silent console.error) so it's visible via
      // `vercel logs` instead of vanishing — the pipeline GET route's
      // self-heal (see app/api/projects/[id]/pipeline/route.ts) is the
      // safety net for a project that ends up with no state row at all.
      try {
        await startGenerationState(project.id);
      } catch (err2: any) {
        logCall("generation-pipeline", {
          op: "start_failed", projectId: project.id, outcome: "error",
          errorMessage: err2.message || "Failed to start generation pipeline", elapsedMs: Date.now() - startT0,
        });
      }
    }

    return NextResponse.json({ project }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
