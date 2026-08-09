import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getDocumentByProject, getDocumentFields } from "@/lib/db/documents";
import { GTM_FIELD_SCHEMA, visibleGtmSchema, resolveGtmFamily } from "@/lib/gtm-field-schema";
import { isRealAnswer, buildFillReport } from "@/lib/field-answer-state";
import { listToolTypes } from "@/lib/db/tool-types";

// Looks up a project's GTM document by project id — the UI only knows the
// project it's on, not the document's own id, until one exists. Ownership
// is checked via the PROJECT (lib/db/documents.ts itself has no org/user
// awareness), same pattern as the regenerate/export-csv siblings below.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  try {
    const session = await getAuthSession();
    const project = await getProject(projectId, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const document = await getDocumentByProject(projectId, "gtm");
    if (!document) return NextResponse.json({ document: null, fields: [] });

    const fields = await getDocumentFields(document.id);

    // Computed fresh on every read, not frozen at generation time — so a
    // manual edit or a later cross-fill reconciliation is reflected
    // immediately without needing to regenerate.
    const byId: Record<string, { answer?: string | null; source?: string | null; sourceDetail?: any }> = {};
    for (const f of fields) byId[f.field_id] = { answer: f.answer, source: f.source, sourceDetail: f.source_detail };
    // Excludes an empty legacyOptional field (e.g. Axis Shield when a
    // product has none) from the denominator, same as the UI's own
    // completion display — see lib/gtm-field-schema.ts's visibleGtmSchema.
    const toolTypes = await listToolTypes();
    const family = resolveGtmFamily({ toolType: (project as any).toolType, gtmTemplateOverride: (project as any).gtmTemplateOverride }, toolTypes);
    const visibleSchema = visibleGtmSchema(GTM_FIELD_SCHEMA, byId, family);
    const completedCount = fields.filter(f => isRealAnswer(f.answer)).length;
    const fillReport = buildFillReport(byId, visibleSchema);

    return NextResponse.json({
      document: { ...document, completedCount, totalFields: visibleSchema.length, fillReport },
      fields,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load document" }, { status: 500 });
  }
}
