import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getDocumentByProject, getDocumentFields } from "@/lib/db/documents";
import { CONTENT_FORM_SCHEMA } from "@/lib/content-form-field-schema";
import { isRealAnswer, buildFillReport } from "@/lib/field-answer-state";

// Looks up a project's Content Form document by project id — same pattern
// as app/api/documents/gtm/route.ts (the UI only knows the project it's
// on, not the document's own id, until one exists).
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  try {
    const session = await getAuthSession();
    const project = await getProject(projectId, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const document = await getDocumentByProject(projectId, "content_form");
    if (!document) return NextResponse.json({ document: null, fields: [] });

    const fields = await getDocumentFields(document.id);

    const byId: Record<string, { answer?: string | null; source?: string | null; sourceDetail?: any }> = {};
    for (const f of fields) byId[f.field_id] = { answer: f.answer, source: f.source, sourceDetail: f.source_detail };
    const completedCount = fields.filter(f => isRealAnswer(f.answer)).length;
    const fillReport = buildFillReport(byId, CONTENT_FORM_SCHEMA);

    return NextResponse.json({
      document: { ...document, completedCount, totalFields: CONTENT_FORM_SCHEMA.length, fillReport },
      fields,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load document" }, { status: 500 });
  }
}
