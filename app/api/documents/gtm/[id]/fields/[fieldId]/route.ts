import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getDocumentById, updateDocumentField, updateDocumentFieldMeta, revertDocumentField } from "@/lib/db/documents";

// lib/db/documents.ts has no org/user awareness of its own — ownership is
// checked here via the document's parent project, same pattern as the
// GTM document GET routes and the regenerate/export-csv siblings.
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

// Restores the field's previous value from its history — a manual revert
// action, distinct from the AI regeneration endpoint.
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
