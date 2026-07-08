import { NextRequest, NextResponse } from "next/server";
import { getDocumentByProject, getDocumentFields } from "@/lib/db/documents";
import { GTM_FIELD_SCHEMA } from "@/lib/gtm-field-schema";

// Looks up a project's GTM document by project id — the UI only knows the
// project it's on, not the document's own id, until one exists.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  try {
    const document = await getDocumentByProject(projectId, "gtm");
    if (!document) return NextResponse.json({ document: null, fields: [] });

    const fields = await getDocumentFields(document.id);
    const completedCount = fields.filter(f => f.answer && f.answer.toUpperCase() !== "N/A").length;

    return NextResponse.json({
      document: { ...document, completedCount, totalFields: GTM_FIELD_SCHEMA.length },
      fields,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load document" }, { status: 500 });
  }
}
