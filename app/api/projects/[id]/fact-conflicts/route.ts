import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { findFactConflicts } from "@/lib/db/extracted-facts";

// Automatic Source-Doc Fact Extraction & Cross-Document Fill, Part 2 — the
// NEW cross-document conflict view (no such thing existed before this
// feature; the existing per-file extraction preview panel only ever shows
// one file's facts at a time). Read-only; resolving a conflict is just a
// normal PATCH to the existing .../source-docs/[docId]/facts route
// (confirmFact) targeting whichever candidate's source_doc_id the user
// picked — a confirmed fact already wins the merge everywhere, so no new
// propagation endpoint is needed here.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const project = await getProject(params.id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const conflicts = await findFactConflicts(params.id);
    return NextResponse.json({ conflicts });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load fact conflicts" }, { status: 500 });
  }
}
