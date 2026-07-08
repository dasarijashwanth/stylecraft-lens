import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { startGenerationState } from "@/lib/db/generation-state";

// Called once right after a project is created with a product URL/ASIN —
// inserts the pipeline state row so the project detail page knows to
// mount ProjectGenerationProgress and start driving
// pipeline/continue. Project creation itself stays a fast, synchronous
// insert (see app/api/projects/route.ts) — nothing here blocks on a
// scrape or AI call.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const project = await getProject(params.id, session.orgId) as any;
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (!project.productUrl && !project.asin) {
      return NextResponse.json({ error: "Project has no product URL or ASIN" }, { status: 400 });
    }

    const state = await startGenerationState(params.id);
    return NextResponse.json({ state });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to start pipeline" }, { status: 500 });
  }
}
