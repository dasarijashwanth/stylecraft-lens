import { NextRequest, NextResponse } from "next/server";
import { getDocumentByProject, getDocumentFields } from "@/lib/db/documents";
import { GTM_FIELD_SCHEMA } from "@/lib/gtm-field-schema";
import { isRealAnswer, buildFillReport } from "@/lib/field-answer-state";

// Looks up a project's GTM document by project id — the UI only knows the
// project it's on, not the document's own id, until one exists.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  try {
    const document = await getDocumentByProject(projectId, "gtm");
    if (!document) return NextResponse.json({ document: null, fields: [] });

    const fields = await getDocumentFields(document.id);
    const completedCount = fields.filter(f => isRealAnswer(f.answer)).length;

    // Computed fresh on every read, not frozen at generation time — so a
    // manual edit or a later cross-fill reconciliation is reflected
    // immediately without needing to regenerate.
    const byId: Record<string, { answer?: string | null; source?: string | null }> = {};
    for (const f of fields) byId[f.field_id] = { answer: f.answer, source: f.source };
    const fillReport = buildFillReport(byId, GTM_FIELD_SCHEMA);

    return NextResponse.json({
      document: { ...document, completedCount, totalFields: GTM_FIELD_SCHEMA.length, fillReport },
      fields,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load document" }, { status: 500 });
  }
}
