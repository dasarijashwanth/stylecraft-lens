import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getProjectReports } from "@/lib/db/reports";
import { getDocumentById, updateDocumentField, getTdsFieldsForProject, getDocumentFields, flattenDocumentFields } from "@/lib/db/documents";
import { getLatestOutput } from "@/lib/project-outputs";
import { generateSingleField, GtmSources } from "@/lib/gtm-generate";
import { GTM_FIELD_SCHEMA } from "@/lib/gtm-field-schema";
import { checkRateLimit } from "@/lib/rate-limit";

export const maxDuration = 45;

export async function POST(req: NextRequest, { params }: { params: { id: string; fieldId: string } }) {
  try {
    const session = await getAuthSession();

    // Security audit fix — a single real OpenAI call per request, callable
    // in a tight loop across every field of every project the caller owns;
    // was the app's largest unrated AI-spend surface (only "start an
    // analysis"/"create a project" were rate-limited before this).
    const rateLimit = await checkRateLimit({ eventType: "gtm_field_regenerate", userId: session.userId, maxAttempts: 60, windowMinutes: 60 });
    if (rateLimit.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: `Too many field regenerations — please wait ${rateLimit.retryAfterMinutes} minutes and try again.` }, { status: 429 });
    }

    const document = await getDocumentById(params.id);
    if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    // "internal"-kind fields (approved pricing, dieline, etc.) are genuine
    // human decisions — nothing to regenerate from AI/web search. Reject
    // before doing any other work (the UI also hides the Regenerate button
    // for these — this is the server-side guard, not just a UI nicety).
    const schemaField = GTM_FIELD_SCHEMA.find(f => f.id === params.fieldId);
    if (schemaField?.kind === "internal") {
      return NextResponse.json({ error: "This field is set by your team, not AI-generated — edit it directly instead." }, { status: 400 });
    }

    const project = await getProject(document.project_id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const [salesKit, tds, reports, existingFields] = await Promise.all([
      getLatestOutput(document.project_id, "sales_kit"),
      getTdsFieldsForProject(document.project_id),
      getProjectReports(document.project_id, session.userId),
      getDocumentFields(document.id),
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
        gtmTemplateOverride: (project as any).gtmTemplateOverride,
      },
      salesKit,
      tds,
      activeReport: latestReport
        ? { competitive_analysis: latestReport.competitive_analysis, pricing_analysis: latestReport.pricing_analysis, content_form: latestReport.content_form }
        : null,
      // Expert Tip's grounding basis when regenerated in isolation (see
      // lib/gtm-features-and-tip.ts's applyFeaturesAndExpertTip).
      existingFieldAnswers: flattenDocumentFields(existingFields),
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
