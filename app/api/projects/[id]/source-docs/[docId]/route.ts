import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getSourceDocById, deactivateVersion } from "@/lib/db/uploaded-source-docs";

// lib/db/uploaded-source-docs.ts has no org/user awareness of its own —
// ownership is checked here via the parent project, same pattern as the
// [docId]/facts sibling route.
async function assertOwnership(projectId: string, docId: string, orgId: string) {
  const project = await getProject(projectId, orgId);
  if (!project) return null;
  const doc = await getSourceDocById(docId);
  if (!doc || doc.project_id !== projectId) return null;
  return { project, doc };
}

// "Remove" for a slot — deactivates the currently-active version so the
// Sources tab shows "No {type} uploaded yet" again, WITHOUT deleting the
// file/row itself (append-only versioning, same non-destructive precedent
// as replacing a doc via a new upload never deleting the old version).
export async function DELETE(req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  try {
    const session = await getAuthSession();
    const ctx = await assertOwnership(params.id, params.docId, session.orgId);
    if (!ctx) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (!ctx.doc.is_active) return NextResponse.json({ error: "This version is already inactive" }, { status: 400 });

    await deactivateVersion(params.docId);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to remove document" }, { status: 500 });
  }
}
