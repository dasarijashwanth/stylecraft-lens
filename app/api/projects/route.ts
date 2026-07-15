import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { NewProjectSchema } from "@/lib/validations";
import { createProject, getUserProjects } from "@/lib/db/projects";
import { startGenerationState } from "@/lib/db/generation-state";

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
    try {
      await startGenerationState(project.id);
    } catch (err) {
      console.error("Failed to start generation pipeline for new project:", err);
    }

    return NextResponse.json({ project }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
