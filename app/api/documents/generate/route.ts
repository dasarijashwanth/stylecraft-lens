import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getProjectReports } from "@/lib/db/reports";
import { getOrCreateDocument, getDocumentFields, saveDocumentFields, getTdsFieldsForProject } from "@/lib/db/documents";
import { getLatestOutput } from "@/lib/project-outputs";
import { GTM_FIELD_SCHEMA } from "@/lib/gtm-field-schema";
import { generateAllFields, GtmSources } from "@/lib/gtm-generate";
import { isRealAnswer } from "@/lib/field-answer-state";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    const { projectId, docType } = await req.json() as { projectId: string; docType: string };

    if (docType !== "gtm") {
      return NextResponse.json({ error: `Unsupported docType "${docType}" — only "gtm" is implemented` }, { status: 400 });
    }
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const project = await getProject(projectId, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const [salesKit, tds, reports] = await Promise.all([
      getLatestOutput(projectId, "sales_kit"),
      getTdsFieldsForProject(projectId),
      getProjectReports(projectId, session.userId),
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
        ? {
            competitive_analysis: latestReport.competitive_analysis,
            pricing_analysis: latestReport.pricing_analysis,
            content_form: latestReport.content_form,
          }
        : null,
    };

    const fields = await generateAllFields(project.productName, sources, projectId);

    const document = await getOrCreateDocument(projectId, "gtm");
    await saveDocumentFields(document.id, GTM_FIELD_SCHEMA, fields, session.userId);

    const savedFields = await getDocumentFields(document.id);
    const completedCount = savedFields.filter(f => isRealAnswer(f.answer)).length;

    return NextResponse.json({
      document: { ...document, completedCount, totalFields: GTM_FIELD_SCHEMA.length },
      fields: savedFields,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to generate document" }, { status: 500 });
  }
}
