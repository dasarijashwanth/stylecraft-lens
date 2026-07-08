import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getProjectReports } from "@/lib/db/reports";
import { getDocumentById, updateDocumentField, getTdsFieldsForProject } from "@/lib/db/documents";
import { getLatestOutput } from "@/lib/project-outputs";
import { generateSingleField, GtmSources } from "@/lib/gtm-generate";

export const maxDuration = 45;

export async function POST(req: NextRequest, { params }: { params: { id: string; fieldId: string } }) {
  try {
    const session = await getAuthSession();
    const document = await getDocumentById(params.id);
    if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const project = await getProject(document.project_id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const [salesKit, tds, reports] = await Promise.all([
      getLatestOutput(document.project_id, "sales_kit"),
      getTdsFieldsForProject(document.project_id),
      getProjectReports(document.project_id, session.userId),
    ]);
    const latestReport = reports?.[0];

    const sources: GtmSources = {
      project: {
        productName: project.productName,
        description: project.description,
        category: project.category,
        motorTech: project.motorTech,
        keyDiff: project.keyDiff,
        pricePoint: project.pricePoint,
        companyContext: project.companyContext,
      },
      salesKit,
      tds,
      activeReport: latestReport
        ? { competitive_analysis: latestReport.competitive_analysis, pricing_analysis: latestReport.pricing_analysis, content_form: latestReport.content_form }
        : null,
    };

    const result = await generateSingleField(params.fieldId, sources, document.project_id);
    const field = await updateDocumentField(document.id, params.fieldId, result.answer, session.userId, {
      source: result.source,
      sourceDetail: result.sourceDetail,
      flagged: result.flagged,
    });

    return NextResponse.json({ field });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to regenerate field" }, { status: 500 });
  }
}
