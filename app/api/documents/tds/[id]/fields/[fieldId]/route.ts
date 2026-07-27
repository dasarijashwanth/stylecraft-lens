import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getDocumentById, updateDocumentField, updateDocumentFieldMeta, revertDocumentField } from "@/lib/db/documents";

// Mirrors app/api/documents/gtm/[id]/fields/[fieldId]/route.ts, including
// its ownership check. Deliberately NO sibling regenerate/route.ts next to
// this one — TDS fields are a live snapshot, editable by hand, never
// AI-regenerated one at a time.
async function assertOwnsDocument(documentId: string, orgId: string) {
  const document = await getDocumentById(documentId);
  if (!document) throw Object.assign(new Error("Document not found"), { status: 404 });
  const project = await getProject(document.project_id, orgId);
  if (!project) throw Object.assign(new Error("Document not found"), { status: 404 });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; fieldId: string } }) {
  try {
    const session = await getAuthSession();
    await assertOwnsDocument(params.id, session.orgId);
    const body = await req.json() as { answer?: string; owner?: string; notes?: string };

    const field = body.answer !== undefined
      ? await updateDocumentField(params.id, params.fieldId, body.answer, session.userId)
      : await updateDocumentFieldMeta(params.id, params.fieldId, { owner: body.owner, notes: body.notes }, session.userId);

    return NextResponse.json({ field });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to save field" }, { status: err.status || 500 });
  }
}

// Restores the field's previous value from its history.
export async function DELETE(req: NextRequest, { params }: { params: { id: string; fieldId: string } }) {
  try {
    const session = await getAuthSession();
    await assertOwnsDocument(params.id, session.orgId);
    const field = await revertDocumentField(params.id, params.fieldId, session.userId);
    return NextResponse.json({ field });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to revert field" }, { status: err.status || 400 });
  }
}
