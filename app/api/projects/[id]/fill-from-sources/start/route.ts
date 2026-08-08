import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { startDocumentFillState, type FillStep } from "@/lib/db/document-fill-state";
import { runNextFillStep } from "@/lib/document-fill-engine";

export const maxDuration = 45;

// Automatic Source-Doc Fact Extraction & Cross-Document Fill — starts the
// resumable "fill GTM -> fill Content Form" chain and immediately performs
// its FIRST step in this same request (so the client sees real progress
// right away instead of an empty "running" state). Called automatically by
// lib/upload-source-doc-client.ts right after facts extraction succeeds
// (fire-and-forget — the uploader's own UI never waits on this), and by the
// manual "Fill blanks from sources" buttons (which re-initialize the chain
// on click). Subsequent steps are driven by .../continue, polled from
// ProjectDetailPage (mounted once per project, survives tab switches).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const project = await getProject(params.id, session.orgId) as any;
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const steps: FillStep[] = ["gtm", "content_form"];
    await startDocumentFillState(params.id, steps, {
      docId: typeof body?.triggeredByDocId === "string" ? body.triggeredByDocId : null,
      fileName: typeof body?.triggeredByFileName === "string" ? body.triggeredByFileName : null,
    });

    const state = await runNextFillStep(params.id, session.orgId, session.userId, session.email);
    return NextResponse.json({ state });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to start the fill chain" }, { status: 500 });
  }
}
