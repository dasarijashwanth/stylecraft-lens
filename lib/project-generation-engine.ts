// Runs exactly ONE phase of the project-creation pipeline per call —
// capture snapshot -> generate TDS -> generate GTM — driven by
// app/api/projects/[id]/pipeline/continue/route.ts. Same reasoning as
// lib/analysisEngine.ts's runAnalysisStep: each phase is a short,
// independent request that persists its result before returning, so a
// dropped connection just resumes from whatever phase is saved, and no
// single call risks Vercel's fixed 60s cap the way "do everything in one
// request" would.
import { getProject, updateProject } from "./db/projects";
import { getGenerationState, updateGenerationState, GenerationStateRow } from "./db/generation-state";
import { captureProductSnapshot } from "./snapshot-capture";
import { getLatestSnapshot } from "./db/snapshots";
import { generateTdsFields } from "./tds-generate";
import { generateAllFields, GtmSources } from "./gtm-generate";
import { getOrCreateDocument, saveDocumentFields, setDocumentSnapshot, getTdsFieldsForProject } from "./db/documents";
import { TDS_FIELD_SCHEMA } from "./tds-field-schema";
import { GTM_FIELD_SCHEMA } from "./gtm-field-schema";
import { getLatestOutput } from "./project-outputs";
import { getProjectReports } from "./db/reports";

export interface GenerationStepResult {
  state: GenerationStateRow;
  phaseCompleted: "snapshot" | "tds" | "gtm" | null;
}

export async function runProjectGenerationStep(projectId: string, orgId: string, userId: string): Promise<GenerationStepResult> {
  const state = await getGenerationState(projectId);
  if (!state) throw new Error("No generation pipeline started for this project");

  if (state.status === "complete" || state.status === "failed") {
    return { state, phaseCompleted: null };
  }

  const project = await getProject(projectId, orgId) as any;
  if (!project) {
    await updateGenerationState(projectId, { status: "failed", errorMessage: "Project not found" });
    throw new Error("Project not found");
  }

  try {
    if (state.phase === "pending") {
      const productUrl: string | null = project.productUrl ?? null;
      const asin: string | null = project.asin ?? null;
      if (!productUrl && !asin) {
        await updateGenerationState(projectId, { status: "failed", errorMessage: "No product URL or ASIN to capture" });
        throw new Error("No product URL or ASIN to capture");
      }

      const { projection } = await captureProductSnapshot({ projectId, productUrl, asin });

      // Auto-fill only fields the user left blank — never overwrite what
      // they typed. Category isn't auto-filled: nothing scraped gives a
      // reliable signal for it, and a wrong guess is worse than blank.
      const updates: Record<string, any> = {};
      if (!project.pricePoint && projection.price) updates.pricePoint = projection.price;
      if (!project.description && projection.description) updates.description = projection.description;
      if (Object.keys(updates).length > 0) {
        await updateProject(projectId, orgId, updates);
      }

      await updateGenerationState(projectId, { phase: "snapshot", status: "running" });
      return { state: { ...state, phase: "snapshot", status: "running" }, phaseCompleted: "snapshot" };
    }

    if (state.phase === "snapshot") {
      const snapshot = await getLatestSnapshot(projectId);
      if (!snapshot) {
        await updateGenerationState(projectId, { status: "failed", errorMessage: "No snapshot found for TDS generation" });
        throw new Error("No snapshot found for TDS generation");
      }

      const fields = await generateTdsFields(project.productName, snapshot.raw_data, {
        productName: project.productName,
        description: project.description,
        category: project.category,
        motorTech: project.motorTech,
        keyDiff: project.keyDiff,
        pricePoint: project.pricePoint,
        companyContext: project.companyContext,
      });

      const document = await getOrCreateDocument(projectId, "tds");
      await saveDocumentFields(document.id, TDS_FIELD_SCHEMA, fields, userId);
      await setDocumentSnapshot(document.id, snapshot.id);

      await updateGenerationState(projectId, { phase: "tds", status: "running" });
      return { state: { ...state, phase: "tds", status: "running" }, phaseCompleted: "tds" };
    }

    if (state.phase === "tds") {
      const [salesKit, tds, reports] = await Promise.all([
        getLatestOutput(projectId, "sales_kit"),
        getTdsFieldsForProject(projectId),
        getProjectReports(projectId, userId),
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

      const fields = await generateAllFields(project.productName, sources, projectId);
      const document = await getOrCreateDocument(projectId, "gtm");
      await saveDocumentFields(document.id, GTM_FIELD_SCHEMA, fields, userId);

      await updateGenerationState(projectId, { phase: "gtm", status: "complete" });
      return { state: { ...state, phase: "gtm", status: "complete" }, phaseCompleted: "gtm" };
    }

    // phase === "gtm" but status wasn't already complete/failed — treat as done.
    await updateGenerationState(projectId, { status: "complete" });
    return { state: { ...state, status: "complete" }, phaseCompleted: null };
  } catch (err: any) {
    await updateGenerationState(projectId, { status: "failed", errorMessage: err.message || "Generation step failed" });
    throw err;
  }
}
