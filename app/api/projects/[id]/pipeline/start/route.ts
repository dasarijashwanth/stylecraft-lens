import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { startGenerationState } from "@/lib/db/generation-state";

// Normally seeded server-side by app/api/projects/route.ts's POST handler
// itself, right after creation, for every project — this route is kept as
// a manual escape hatch (e.g. re-seeding a project whose row was somehow
// never created) rather than the primary trigger. A product URL/ASIN is no
// longer required: lib/project-generation-engine.ts's "pending"/"snapshot"
// phases already degrade gracefully with no anchor. Project creation itself
// stays a fast, synchronous insert — nothing here blocks on a scrape or AI call.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const project = await getProject(params.id, session.orgId) as any;
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const state = await startGenerationState(params.id);
    return NextResponse.json({ state });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to start pipeline" }, { status: 500 });
  }
}
