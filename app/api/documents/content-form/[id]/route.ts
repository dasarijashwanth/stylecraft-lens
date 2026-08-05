import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getDocumentById, getDocumentFields } from "@/lib/db/documents";
import { CONTENT_FORM_SCHEMA } from "@/lib/content-form-field-schema";
import { isRealAnswer, buildFillReport } from "@/lib/field-answer-state";

// Reads only `params.id` — same latent Next.js route-handler-cache risk
// confirmed and fixed in app/api/projects/[id]/pipeline/route.ts.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const document = await getDocumentById(params.id);
    if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    // lib/db/documents.ts has no org/user awareness of its own — ownership
    // is checked via the parent project, same pattern as the GTM sibling.
    const project = await getProject(document.project_id, session.orgId);
    if (!project) return NextResponse.json({ error: "Document not found" }, { status: 404 });

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
