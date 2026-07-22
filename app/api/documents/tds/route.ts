import { NextRequest, NextResponse } from "next/server";
import { getDocumentByProject, getDocumentFields } from "@/lib/db/documents";
import { getSnapshotById } from "@/lib/db/snapshots";
import { TDS_FIELD_SCHEMA } from "@/lib/tds-field-schema";
import { isRealAnswer, buildFillReport } from "@/lib/field-answer-state";

// Looks up a project's TDS document by project id — mirrors
// app/api/documents/gtm/route.ts. TDS has no regenerate endpoint anywhere
// in this API surface — that's how "no regenerate" is enforced.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  try {
    const document = await getDocumentByProject(projectId, "tds");
    if (!document) return NextResponse.json({ document: null, fields: [] });

    const fields = await getDocumentFields(document.id);
    const completedCount = fields.filter(f => isRealAnswer(f.answer)).length;

    const byId: Record<string, { answer?: string | null; source?: string | null }> = {};
    for (const f of fields) byId[f.field_id] = { answer: f.answer, source: f.source };
    const fillReport = buildFillReport(byId, TDS_FIELD_SCHEMA);

    const snapshot = document.snapshot_id ? await getSnapshotById(document.snapshot_id) : null;

    return NextResponse.json({
      document: {
        ...document,
        completedCount,
        totalFields: TDS_FIELD_SCHEMA.length,
        fillReport,
        snapshot_captured_at: snapshot?.captured_at ?? null,
        snapshot_source_url: snapshot?.source_url ?? null,
        snapshot_asin: snapshot?.asin ?? null,
      },
      fields,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load document" }, { status: 500 });
  }
}
