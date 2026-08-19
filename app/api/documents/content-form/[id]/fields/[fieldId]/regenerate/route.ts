import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getProjectReports } from "@/lib/db/reports";
import { getDocumentById, updateDocumentField, getTdsFieldsForProject, getDocumentByProject, getDocumentFields, flattenDocumentFields } from "@/lib/db/documents";
import { getLatestOutput } from "@/lib/project-outputs";
import { GtmSources } from "@/lib/gtm-generate";
import { regenerateContentFormField, isContentFormFieldRegeneratable } from "@/lib/content-form-generate";
import { listCatalogProducts } from "@/lib/db/catalog-products";
import { matchCatalogProductByName } from "@/lib/our-product-position";
import { resolveBrandForProduct, getActiveVoiceGuide, buildVoiceBlock } from "@/lib/brand-voice";
import { getUploadedTdsContext, buildTdsGroundingBlock } from "@/lib/gtm-uploaded-tds";
import { getReferenceLinksContext, buildReferenceLinksPromptBlock } from "@/lib/gtm-reference-links";
import { checkRateLimit } from "@/lib/rate-limit";

// Was 45 — generateContentForm's 4 groups can each take up to ~60s worst
// case (30s primary call + a possible 30s retry, lib/content-form-generate.ts),
// so 45 risked Vercel killing this request before a slow-but-legitimate
// regenerate ever got a chance to return.
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string; fieldId: string } }) {
  try {
    const session = await getAuthSession();

    // Security audit fix — same reasoning as the GTM field-regenerate sibling.
    const rateLimit = await checkRateLimit({ eventType: "content_form_field_regenerate", userId: session.userId, maxAttempts: 60, windowMinutes: 60 });
    if (rateLimit.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: `Too many field regenerations — please wait ${rateLimit.retryAfterMinutes} minutes and try again.` }, { status: 429 });
    }

    const document = await getDocumentById(params.id);
    if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    if (!isContentFormFieldRegeneratable(params.fieldId)) {
      return NextResponse.json({ error: "This field cannot be regenerated." }, { status: 400 });
    }

    const project = await getProject(document.project_id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const [salesKit, tds, reports, catalogProducts, gtmDocument] = await Promise.all([
      getLatestOutput(document.project_id, "sales_kit"),
      getTdsFieldsForProject(document.project_id),
      getProjectReports(document.project_id, session.userId),
      listCatalogProducts(),
      getDocumentByProject(document.project_id, "gtm"),
    ]);
    const latestReport = reports?.[0];
    const gtmFieldsFlat = gtmDocument ? flattenDocumentFields(await getDocumentFields(gtmDocument.id)) : {};

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
      },
      salesKit,
      tds,
      activeReport: latestReport
        ? { competitive_analysis: latestReport.competitive_analysis, pricing_analysis: latestReport.pricing_analysis, content_form: latestReport.content_form }
        : null,
    };

    const matchedProduct = matchCatalogProductByName(project.productName, catalogProducts);
    const brand = await resolveBrandForProduct(project.productName);
    const voiceBlock = buildVoiceBlock(await getActiveVoiceGuide(brand));
    const uploadedTdsContext = await getUploadedTdsContext(document.project_id);
    const referenceLinksContext = await getReferenceLinksContext((project as any).referenceUrls);
    // Reference Links count as real web presence — see gtm-generate.ts's
    // isPreLaunch comment for why.
    const isPreLaunch = !(project as any).productUrl && !(project as any).asin && !referenceLinksContext.hasLinks;
    const tdsGroundingBlock = buildTdsGroundingBlock(uploadedTdsContext, isPreLaunch)
      + (referenceLinksContext.hasLinks ? `\n\nREFERENCE SOURCES:\n${buildReferenceLinksPromptBlock(referenceLinksContext)}` : "");

    const result = await regenerateContentFormField(params.fieldId, sources, gtmFieldsFlat, matchedProduct, voiceBlock, tdsGroundingBlock);
    if (!result) return NextResponse.json({ error: "No grounded facts available yet — generate Product Knowledge first." }, { status: 400 });

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
