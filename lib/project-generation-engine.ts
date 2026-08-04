// Runs exactly ONE phase of the project-creation pipeline per call —
// capture snapshot -> generate TDS -> generate GTM — driven by
// app/api/projects/[id]/pipeline/continue/route.ts. Same reasoning as
// lib/analysisEngine.ts's runAnalysisStep: each phase is a short,
// independent request that persists its result before returning, so a
// dropped connection just resumes from whatever phase is saved, and no
// single call risks Vercel's fixed 60s cap the way "do everything in one
// request" would.
import { getProject, updateProject } from "./db/projects";
import { getGenerationState, updateGenerationState, reclaimStaleRunningState, GenerationStateRow } from "./db/generation-state";
import { captureProductSnapshot } from "./snapshot-capture";
import { getLatestSnapshot } from "./db/snapshots";
import { generateTdsFields } from "./tds-generate";
import { generateAllFields, GtmSources } from "./gtm-generate";
import { getOrCreateDocument, saveDocumentFields, setDocumentSnapshot, setDocumentVoiceGuide, setDocumentSourceDocVersions, getTdsFieldsForProject, getDocumentFields, flattenDocumentFields } from "./db/documents";
import { resolveBrandForProduct, getActiveVoiceGuide, buildVoiceBlock } from "./brand-voice";
import { getUploadedTdsContext, buildTdsGroundingBlock } from "./gtm-uploaded-tds";
import { TDS_FIELD_SCHEMA } from "./tds-field-schema";
import { GTM_FIELD_SCHEMA } from "./gtm-field-schema";
import { reconcileTdsFromGtm } from "./tds-gtm-reconcile";
import { getLatestOutput } from "./project-outputs";
import { getProjectReports } from "./db/reports";
import { getActiveDeckTemplate } from "./db/deck-templates";
import { generateProjectDeck } from "./deck-generate";
import { logCall } from "./obs";
import { isTdsEnabled, isDeckGenerationEnabled } from "./feature-flags";
import { listToolTypes } from "./db/tool-types";
import { generateProductFaqs } from "./gtm-product-faqs";
import { finalizeFieldAnswers } from "./field-finalize";

export interface GenerationStepResult {
  state: GenerationStateRow;
  phaseCompleted: "snapshot" | "tds" | "gtm" | "faqs" | "deck" | null;
}

export async function runProjectGenerationStep(projectId: string, orgId: string, userId: string): Promise<GenerationStepResult> {
  // Self-heals a job stuck at status:"running" forever from a hard platform
  // kill mid-step (not a catchable JS exception, so the catch block below
  // never got a chance to run) — reclassifies it "failed" so it's retryable.
  const state = await reclaimStaleRunningState(projectId);
  if (!state) throw new Error("No generation pipeline started for this project");

  if (state.status === "complete" || state.status === "failed") {
    return { state, phaseCompleted: null };
  }

  const project = await getProject(projectId, orgId) as any;
  if (!project) {
    await updateGenerationState(projectId, { status: "failed", errorMessage: "Project not found" });
    throw new Error("Project not found");
  }

  const stepStart = Date.now();
  logCall("generation-pipeline", { op: "phase-start", projectId, phase: state.phase, outcome: "ok", elapsedMs: 0 });

  try {
    if (state.phase === "pending") {
      const productUrl: string | null = project.productUrl ?? null;
      const asin: string | null = project.asin ?? null;

      // No product anchor is no longer a hard failure — GTM generation (and,
      // in degraded form, TDS) can still run from just the project record.
      // This is what makes generation fully automatic for every project,
      // not only ones created with a URL/ASIN.
      if (productUrl || asin) {
        const toolTypes = await listToolTypes();
        const { projection } = await captureProductSnapshot({ projectId, productUrl, asin, requiredToolType: (project as any).toolType, toolTypes });

        // Auto-fill only fields the user left blank — never overwrite what
        // they typed. Category isn't auto-filled: nothing scraped gives a
        // reliable signal for it, and a wrong guess is worse than blank.
        const updates: Record<string, any> = {};
        if (!project.pricePoint && projection.price) updates.pricePoint = projection.price;
        if (!project.description && projection.description) updates.description = projection.description;
        if (Object.keys(updates).length > 0) {
          await updateProject(projectId, orgId, updates);
        }
      }

      await updateGenerationState(projectId, { phase: "snapshot", status: "running" });
      logCall("generation-pipeline", { op: "phase-complete", projectId, phase: "pending->snapshot", outcome: "ok", elapsedMs: Date.now() - stepStart });
      return { state: { ...state, phase: "snapshot", status: "running" }, phaseCompleted: "snapshot" };
    }

    if (state.phase === "snapshot") {
      // TDS generation disabled via feature flag (lib/feature-flags.ts) —
      // the "tds" phase SLOT still exists (never removed from the enum:
      // scripts/backfill-gtm.ts seeds phase:"tds" directly, and
      // ProjectGenerationProgress.tsx's PHASE_INDEX keys off it), only its
      // work is skipped — same idiom the "deck" branch below already uses
      // for a missing active deck template.
      if (!(await isTdsEnabled())) {
        logCall("generation-pipeline", { op: "phase-skip", projectId, phase: "tds", outcome: "ok", errorMessage: "TDS disabled via feature flag", elapsedMs: Date.now() - stepStart });
        await updateGenerationState(projectId, { phase: "tds", status: "running" });
        return { state: { ...state, phase: "tds", status: "running" }, phaseCompleted: "tds" };
      }

      // No snapshot (no anchor was given, or capture didn't find one) is no
      // longer a hard failure — generateTdsFields already accepts a null
      // raw_data and produces a document sourced only from the project
      // record (mostly "Not listed on product page"), which is a real, if
      // degraded, TDS rather than nothing at all.
      const snapshot = await getLatestSnapshot(projectId);

      const fields = await generateTdsFields(project.productName, snapshot?.raw_data ?? null, {
        productName: project.productName,
        description: project.description,
        category: project.category,
        toolType: project.toolType,
        motorFamily: (project as any).motorFamily,
        motorBrandedName: (project as any).motorBrandedName,
        motorTech: project.motorTech,
        keyDiff: project.keyDiff,
        pricePoint: project.pricePoint,
        companyContext: project.companyContext,
      }, projectId);

      const document = await getOrCreateDocument(projectId, "tds");
      await saveDocumentFields(document.id, TDS_FIELD_SCHEMA, fields, userId);
      if (snapshot) await setDocumentSnapshot(document.id, snapshot.id);

      await updateGenerationState(projectId, { phase: "tds", status: "running" });
      logCall("generation-pipeline", { op: "phase-complete", projectId, phase: "snapshot->tds", outcome: "ok", elapsedMs: Date.now() - stepStart });
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
          toolType: project.toolType,
          motorFamily: (project as any).motorFamily,
          motorBrandedName: (project as any).motorBrandedName,
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

      const fields = await generateAllFields(project.productName, sources, projectId);
      const document = await getOrCreateDocument(projectId, "gtm");
      await saveDocumentFields(document.id, GTM_FIELD_SCHEMA, fields, userId);

      // Records which brand voice guide version this generation actually
      // used (lib/brand-voice.ts) — cached, so this doesn't repeat the DB
      // fetch generateAllFields already made internally.
      const brand = await resolveBrandForProduct(project.productName);
      const voiceGuide = await getActiveVoiceGuide(brand);
      await setDocumentVoiceGuide(document.id, voiceGuide.id, voiceGuide.version);

      // Uploaded TDS Ingestion — records which active source-doc version(s)
      // this generation actually used, for the "out of date sources" banner.
      const uploadedTdsContext = await getUploadedTdsContext(projectId);
      if (uploadedTdsContext.docsUsed.length > 0) {
        const sourceDocVersions: Record<string, { id: string; version: number }> = {};
        for (const d of uploadedTdsContext.docsUsed) sourceDocVersions[d.docType] = { id: d.id, version: d.version };
        await setDocumentSourceDocVersions(document.id, sourceDocVersions);
      }

      // gtm is no longer a terminal phase — the pipeline continues into FAQ
      // generation (needs GTM's fully-resolved fields as grounding) and then
      // deck generation, so this is "running" not "complete".
      await updateGenerationState(projectId, { phase: "faqs", status: "running" });
      logCall("generation-pipeline", { op: "phase-complete", projectId, phase: "tds->gtm", outcome: "ok", elapsedMs: Date.now() - stepStart });

      // Cross-fill any TDS field GTM just answered for real while TDS was
      // still unresolved — never fails the (already-successful) GTM phase.
      try {
        const copied = await reconcileTdsFromGtm(projectId, userId, fields);
        if (copied > 0) logCall("generation-pipeline", { op: "reconcile", projectId, phase: "tds-gtm-reconcile", outcome: "ok", elapsedMs: Date.now() - stepStart });
      } catch (err: any) {
        logCall("generation-pipeline", { op: "reconcile", projectId, phase: "tds-gtm-reconcile", outcome: "error", errorMessage: err.message || "reconcile failed", elapsedMs: Date.now() - stepStart });
      }

      return { state: { ...state, phase: "faqs", status: "running" }, phaseCompleted: "gtm" };
    }

    if (state.phase === "faqs") {
      // 10 auto-generated Product FAQs + Differentiators/Selling Position/
      // Rep Talking Points — grounded in GTM's already-resolved fields, so
      // this runs strictly after "gtm". Best-effort, same precedent as deck
      // generation: a real facts/analysis document already exists, FAQs are
      // additive, and each one has its own in-app regenerate button for
      // manual retry — a generation hiccup here must never fail the rest of
      // project setup.
      //
      // Deck generation is deliberately its OWN phase/request (below), not
      // run inline here — FAQ generation alone (initial call + a possible
      // brand-name/voice-violation retry + differentiators/talking-points)
      // can already approach this route's 60s maxDuration; stacking full
      // deck generation on top in the same request risked a hard platform
      // kill mid-request (confirmed: no per-call budget covers both
      // together). Matches this file's own header rule — exactly one phase
      // per request — which this branch previously violated.
      try {
        const document = await getOrCreateDocument(projectId, "gtm");
        const gtmDocFields = await getDocumentFields(document.id);
        const gtmFieldsFlat = flattenDocumentFields(gtmDocFields);

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
            toolType: project.toolType,
            motorFamily: (project as any).motorFamily,
            motorBrandedName: (project as any).motorBrandedName,
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

        const faqSchema = GTM_FIELD_SCHEMA.filter(f => f.section === "Product FAQ");
        const faqBrand = await resolveBrandForProduct(project.productName);
        const faqVoiceBlock = buildVoiceBlock(await getActiveVoiceGuide(faqBrand));
        const faqIsPreLaunch = !project.productUrl && !project.asin;
        const faqUploadedTdsContext = await getUploadedTdsContext(projectId);
        const faqTdsGroundingBlock = buildTdsGroundingBlock(faqUploadedTdsContext, faqIsPreLaunch);
        const faqFields = await generateProductFaqs(sources, gtmFieldsFlat, faqVoiceBlock, faqTdsGroundingBlock);
        // Anything generateProductFaqs didn't resolve (a failed AI call for
        // one FAQ, or the margin/quantity internal-kind fields, which are
        // never AI-answerable) becomes an honest terminal state instead of
        // a missing row — same finalize step generateAllFields itself ends on.
        const finalized = finalizeFieldAnswers(faqFields, faqSchema, 1);
        await saveDocumentFields(document.id, faqSchema, finalized, userId);
        logCall("generation-pipeline", { op: "phase-complete", projectId, phase: "faqs", outcome: "ok", elapsedMs: Date.now() - stepStart });
      } catch (err: any) {
        logCall("generation-pipeline", { op: "phase-failed", projectId, phase: "faqs", outcome: "error", errorMessage: err.message || "FAQ generation failed", elapsedMs: Date.now() - stepStart });
      }

      await updateGenerationState(projectId, { phase: "deck", status: "running" });
      logCall("generation-pipeline", { op: "phase-complete", projectId, phase: "gtm->faqs", outcome: "ok", elapsedMs: Date.now() - stepStart });
      return { state: { ...state, phase: "deck", status: "running" }, phaseCompleted: "faqs" };
    }

    if (state.phase === "deck") {
      // Deck generation was taking long enough to repeatedly stall/time out
      // in production (lib/feature-flags.ts's isDeckGenerationEnabled,
      // defaults to disabled) — same "flag exists, work is skipped" idiom
      // as the "snapshot" phase's isTdsEnabled() check above. Project setup
      // completes right after Product FAQs instead of hanging here; the
      // deck can still be generated manually later from the Project Deck
      // tab's own generate/retry action once the underlying slowness is fixed.
      if (!(await isDeckGenerationEnabled())) {
        logCall("generation-pipeline", { op: "phase-skip", projectId, phase: "deck", outcome: "ok", errorMessage: "Deck generation disabled via feature flag", elapsedMs: Date.now() - stepStart });
        await updateGenerationState(projectId, { phase: "deck", status: "complete" });
        return { state: { ...state, phase: "deck", status: "complete" }, phaseCompleted: "deck" };
      }

      // Deck generation deliberately never fails the overall pipeline — TDS
      // and GTM are the required artifacts and already succeeded; the deck
      // is a bonus layer on top. A missing active template, or any real
      // rendering error, is logged and the project simply ends up with no
      // deck (or a project_decks row already marked "failed" with its own
      // real error — generateProjectDeck sets that itself before rethrowing).
      // The Project Deck tab surfaces this with its own Retry action instead
      // of blocking the rest of project setup.
      try {
        const activeTemplate = await getActiveDeckTemplate();
        if (activeTemplate) {
          await generateProjectDeck(projectId, orgId, userId);
        } else {
          logCall("generation-pipeline", { op: "phase-skip", projectId, phase: "deck", outcome: "ok", errorMessage: "No active deck template configured", elapsedMs: Date.now() - stepStart });
        }
      } catch (err: any) {
        logCall("generation-pipeline", { op: "phase-failed", projectId, phase: "deck", outcome: "error", errorMessage: err.message || "Deck generation failed", elapsedMs: Date.now() - stepStart });
      }

      await updateGenerationState(projectId, { phase: "deck", status: "complete" });
      logCall("generation-pipeline", { op: "phase-complete", projectId, phase: "faqs->deck", outcome: "ok", elapsedMs: Date.now() - stepStart });
      return { state: { ...state, phase: "deck", status: "complete" }, phaseCompleted: "deck" };
    }

    // Unexpected phase value (shouldn't happen for any real pipeline run) —
    // mark complete rather than looping forever on an unrecognized state.
    await updateGenerationState(projectId, { status: "complete" });
    return { state: { ...state, status: "complete" }, phaseCompleted: null };
  } catch (err: any) {
    await updateGenerationState(projectId, { status: "failed", errorMessage: err.message || "Generation step failed" });
    logCall("generation-pipeline", { op: "phase-failed", projectId, phase: state.phase, outcome: "error", errorMessage: err.message || "Generation step failed", elapsedMs: Date.now() - stepStart });
    throw err;
  }
}
