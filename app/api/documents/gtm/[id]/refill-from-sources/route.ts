import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getDocumentById, getDocumentFields, updateDocumentField, setDocumentSourceDocVersions, getTdsFieldsForProject } from "@/lib/db/documents";
import { getProjectReports } from "@/lib/db/reports";
import { getLatestOutput } from "@/lib/project-outputs";
import { GTM_FIELD_SCHEMA } from "@/lib/gtm-field-schema";
import { deriveFieldsFromSources } from "@/lib/gtm-derive";
import { getUploadedTdsContext, applyUploadedTdsFacts } from "@/lib/gtm-uploaded-tds";
import type { GtmSources } from "@/lib/gtm-generate";

export const maxDuration = 30;

// Uploaded TDS Ingestion, Part 5 — re-runs the deterministic + uploaded-TDS
// tiers for GROUNDED/spec fields only, writing only whatever actually
// changed (history preserved via the existing updateDocumentField path).
// Deliberately does NOT auto-regenerate narrative/written fields — those
// keep their own per-field regenerate button as the manual path; a field
// already sourced from something more authoritative than an upload
// (manual_edit/project_record/active_report) is never touched. This is a
// disclosed MVP scope narrowing, not a silent gap — same "flag/update,
// never auto-rewrite everything" discipline as this app's Brand Voice
// "Voice check" batch action.
const UNTOUCHABLE_SOURCES = new Set(["manual_edit", "project_record", "active_report"]);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const document = await getDocumentById(params.id);
    if (!document || document.doc_type !== "gtm") return NextResponse.json({ error: "Document not found" }, { status: 404 });

    // lib/db/documents.ts has no org/user awareness of its own — ownership
    // is checked via the parent project, same pattern as every other
    // project-scoped route in this codebase.
    const project = await getProject(document.project_id, session.orgId) as any;
    if (!project) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const fields = await getDocumentFields(document.id);
    const fieldsById = new Map(fields.map(f => [f.field_id, f]));

    const [salesKit, tds, reports] = await Promise.all([
      getLatestOutput(project.id, "sales_kit"),
      getTdsFieldsForProject(project.id),
      getProjectReports(project.id, session.userId),
    ]);
    const latestReport = reports?.[0];
    const sources: GtmSources = {
      project: {
        productName: project.productName,
        description: project.description,
        category: project.category,
        toolType: project.toolType,
        motorFamily: project.motorFamily,
        motorBrandedName: project.motorBrandedName,
        motorTech: project.motorTech,
        keyDiff: project.keyDiff,
        pricePoint: project.pricePoint,
        companyContext: project.companyContext,
        targetMarket: project.targetMarket,
        productUrl: project.productUrl,
        asin: project.asin,
      },
      salesKit,
      tds,
      activeReport: latestReport
        ? { competitive_analysis: latestReport.competitive_analysis, pricing_analysis: latestReport.pricing_analysis, content_form: latestReport.content_form }
        : null,
    };

    const derived = deriveFieldsFromSources(sources.project, sources.salesKit, sources.tds, sources.activeReport);
    const uploadedTdsContext = await getUploadedTdsContext(project.id);

    let checked = 0;
    const changedFieldIds: string[] = [];

    for (const schemaField of GTM_FIELD_SCHEMA) {
      if (schemaField.kind !== "grounded") continue;
      const current = fieldsById.get(schemaField.id);
      if (!current) continue;
      if (UNTOUCHABLE_SOURCES.has(current.source || "")) continue;
      checked++;

      // Candidate value: deterministic derive floor, then uploaded-TDS
      // override on top (same precedence as full generation).
      const candidateMap: Record<string, { answer: string; source: string; sourceDetail?: any }> = {
        [schemaField.id]: derived[schemaField.id] ? { ...derived[schemaField.id] } : { answer: current.answer || "N/A", source: current.source || "none" },
      };
      applyUploadedTdsFacts(candidateMap as any, [schemaField], uploadedTdsContext);
      const candidate = candidateMap[schemaField.id];

      const candidateAnswer = (candidate.answer || "").trim();
      const currentAnswer = (current.answer || "").trim();
      if (!candidateAnswer || candidateAnswer.toUpperCase() === "N/A" || candidateAnswer === currentAnswer) continue;

      await updateDocumentField(document.id, schemaField.id, candidateAnswer, session.email, {
        source: candidate.source,
        sourceDetail: candidate.sourceDetail,
        flagged: false,
      });
      changedFieldIds.push(schemaField.id);
    }

    if (uploadedTdsContext.docsUsed.length > 0) {
      const versions: Record<string, { id: string; version: number }> = {};
      for (const d of uploadedTdsContext.docsUsed) versions[d.docType] = { id: d.id, version: d.version };
      await setDocumentSourceDocVersions(document.id, versions);
    }

    return NextResponse.json({ checked, changed: changedFieldIds.length, changedFieldIds });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to re-fill from sources" }, { status: 500 });
  }
}
