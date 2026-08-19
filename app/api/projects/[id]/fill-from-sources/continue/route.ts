import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getDocumentFillState } from "@/lib/db/document-fill-state";
import { runNextFillStep } from "@/lib/document-fill-engine";

export const maxDuration = 60; // was 45 - lib/document-fill-engine.ts now gates its own phases against a 48s budget, but the route should still allow the full Vercel Hobby ceiling as margin.

// Automatic Source-Doc Fact Extraction & Cross-Document Fill — resumes the
// fill chain one step per call, exactly like app/api/projects/[id]/pipeline/
// continue resumes project generation. Polled by ProjectDetailPage (mounted
// once per project — survives tab switches, so navigating away from Sources
// never interrupts the chain) whenever document_fill_state.status ===
// "running" for this project; also what a browser reopening the project
// later resumes from, since there's no background-job service driving this
// (see lib/document-fill-engine.ts's runNextFillStep for that reasoning).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const project = await getProject(params.id, session.orgId) as any;
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const state = await runNextFillStep(params.id, session.orgId, session.userId, session.email);
    return NextResponse.json({ state });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to continue the fill chain" }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const project = await getProject(params.id, session.orgId) as any;
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const state = await getDocumentFillState(params.id);
    return NextResponse.json({ state });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to read fill state" }, { status: 500 });
  }
}
