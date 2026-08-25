import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getProjectReports } from "@/lib/db/reports";
import { getOrCreateDocument, getDocumentFields, saveDocumentFields, getTdsFieldsForProject, setDocumentVoiceGuide, setDocumentSourceDocVersions } from "@/lib/db/documents";
import { getLatestOutput } from "@/lib/project-outputs";
import { GTM_FIELD_SCHEMA, visibleGtmSchema, resolveGtmFamily } from "@/lib/gtm-field-schema";
import { generateAllFields, GtmSources } from "@/lib/gtm-generate";
import { isRealAnswer } from "@/lib/field-answer-state";
import { resolveBrandForProduct, getActiveVoiceGuide } from "@/lib/brand-voice";
import { getUploadedTdsContext } from "@/lib/gtm-uploaded-tds";
import { listToolTypes } from "@/lib/db/tool-types";

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
        toolType: (project as any).toolType,
        motorFamily: (project as any).motorFamily,
        motorBrandedName: (project as any).motorBrandedName,
        motorTech: project.motorTech,
        keyDiff: project.keyDiff,
        pricePoint: project.pricePoint,
        companyContext: project.companyContext,
        targetMarket: project.targetMarket,
        productUrl: (project as any).productUrl,
        asin: (project as any).asin,
        referenceUrls: (project as any).referenceUrls,
        predecessorRef: (project as any).predecessorRef,
        orgId: session.orgId,
        gtmTemplateOverride: (project as any).gtmTemplateOverride,
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

    // Records which brand voice guide version this generation actually
    // used (lib/brand-voice.ts) — cached, so this doesn't repeat the DB
    // fetch generateAllFields already made internally.
    const brand = await resolveBrandForProduct(project.productName);
    const voiceGuide = await getActiveVoiceGuide(brand);
    await setDocumentVoiceGuide(document.id, voiceGuide.id, voiceGuide.version);

    // Uploaded TDS Ingestion — records which active source-doc version(s)
    // this generation actually used, so a later replacement can show an
    // "out of date sources" banner.
    const uploadedTdsContext = await getUploadedTdsContext(projectId);
    if (uploadedTdsContext.docsUsed.length > 0) {
      const versions: Record<string, { id: string; version: number }> = {};
      for (const d of uploadedTdsContext.docsUsed) versions[d.docType] = { id: d.id, version: d.version };
      await setDocumentSourceDocVersions(document.id, versions);
    }

    const savedFields = await getDocumentFields(document.id);
    const byId: Record<string, { answer?: string | null }> = {};
    for (const f of savedFields) byId[f.field_id] = { answer: f.answer };
    const toolTypes = await listToolTypes();
    const family = resolveGtmFamily({ toolType: (project as any).toolType, gtmTemplateOverride: (project as any).gtmTemplateOverride }, toolTypes);
    const visibleSchema = visibleGtmSchema(GTM_FIELD_SCHEMA, byId, family);
    const completedCount = savedFields.filter(f => isRealAnswer(f.answer)).length;

    return NextResponse.json({
      document: { ...document, completedCount, totalFields: visibleSchema.length },
      fields: savedFields,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to generate document" }, { status: 500 });
  }
}
