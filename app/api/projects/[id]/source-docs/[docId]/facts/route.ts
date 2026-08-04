import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getSourceDocById } from "@/lib/db/uploaded-source-docs";
import { listFactsForDoc, confirmFact } from "@/lib/db/extracted-facts";

// lib/db/uploaded-source-docs.ts/lib/db/extracted-facts.ts have no org/user
// awareness of their own — ownership is checked here via the parent
// project, same pattern as every other project-scoped route in this app.
async function assertOwnership(projectId: string, docId: string, orgId: string) {
  const project = await getProject(projectId, orgId);
  if (!project) return null;
  const doc = await getSourceDocById(docId);
  if (!doc || doc.project_id !== projectId) return null;
  return { project, doc };
}

export async function GET(req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  try {
    const session = await getAuthSession();
    const ctx = await assertOwnership(params.id, params.docId, session.orgId);
    if (!ctx) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const facts = await listFactsForDoc(params.docId);
    return NextResponse.json({ facts });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load extracted facts" }, { status: 500 });
  }
}

// A user's inline correction/addition in the extraction preview panel —
// always confirmed_by_user: true, highest authority in the fill ladder's
// merge regardless of which doc type it's attached to.
export async function PATCH(req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  try {
    const session = await getAuthSession();
    const ctx = await assertOwnership(params.id, params.docId, session.orgId);
    if (!ctx) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const { fieldId, value, rawText, sourceLocation } = await req.json();
    if (!fieldId || typeof fieldId !== "string") return NextResponse.json({ error: "fieldId is required" }, { status: 400 });
    if (!value || typeof value !== "string" || !value.trim()) return NextResponse.json({ error: "value is required" }, { status: 400 });

    await confirmFact(params.docId, params.id, fieldId, { value: value.trim(), rawText: rawText ?? null, sourceLocation: sourceLocation ?? null });
    const facts = await listFactsForDoc(params.docId);
    return NextResponse.json({ facts });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to save correction" }, { status: 500 });
  }
}
