// lib/document-fill-engine.ts
// Automatic Source-Doc Fact Extraction & Cross-Document Fill — the actual
// per-document fill logic, extracted out of the two refill-from-sources
// ROUTES (app/api/documents/gtm/[id]/refill-from-sources,
// app/api/documents/content-form/[id]/refill-from-sources) into plain
// functions so BOTH the manual "Fill blanks from sources" button (via those
// routes) AND the automatic upload-triggered chain (lib/db/document-fill-
// state.ts + app/api/projects/[id]/fill-from-sources/continue) call the
// exact same code — no HTTP round-trip between the chain driver and the
// fill logic, no duplicated behavior to keep in sync.
import { getProject } from "@/lib/db/projects";
import { getOrCreateDocument, getDocumentFields, updateDocumentField, setDocumentSourceDocVersions, getTdsFieldsForProject, flattenDocumentFields } from "@/lib/db/documents";
import { getProjectReports } from "@/lib/db/reports";
import { getLatestOutput } from "@/lib/project-outputs";
import { GTM_FIELD_SCHEMA } from "@/lib/gtm-field-schema";
import { deriveFieldsFromSources } from "@/lib/gtm-derive";
import { getUploadedTdsContext, applyUploadedTdsFacts, buildTdsGroundingBlock } from "@/lib/gtm-uploaded-tds";
import type { GtmSources } from "@/lib/gtm-generate";
import { listActiveDocsForProject } from "@/lib/db/uploaded-source-docs";
import { deriveFactsForDoc } from "@/lib/tds-doc-ingest";
import { isRealAnswer, isAwaitingInternalInput, isNotDeterminable } from "@/lib/field-answer-state";
import { resolveBrandForProduct, getActiveVoiceGuide, buildVoiceBlock } from "@/lib/brand-voice";
import { generateMarketingDirection } from "@/lib/gtm-marketing-direction";
import { generateProductFaqs } from "@/lib/gtm-product-faqs";
import { applyBoxOnlyDerivation } from "@/lib/gtm-box-only";
import { listCatalogProducts } from "@/lib/db/catalog-products";
import { matchCatalogProductByName } from "@/lib/our-product-position";
import { getMarketingDefaults } from "@/lib/db/marketing-defaults";
import { CONTENT_FORM_SCHEMA } from "@/lib/content-form-field-schema";
import { generateContentForm } from "@/lib/content-form-generate";
import { getDocumentFillState, updateDocumentFillState, reclaimStaleRunningFillState, type DocumentFillStateRow, type FillStep } from "@/lib/db/document-fill-state";

const UNTOUCHABLE_SOURCES = new Set(["manual_edit", "project_record", "active_report"]);

function isBlank(answer: string | null | undefined): boolean {
  return !isRealAnswer(answer) || isAwaitingInternalInput(answer) || isNotDeterminable(answer);
}

async function buildProjectSources(project: any, userId: string): Promise<GtmSources> {
  const [salesKit, tds, reports] = await Promise.all([
    getLatestOutput(project.id, "sales_kit"),
    getTdsFieldsForProject(project.id),
    getProjectReports(project.id, userId),
  ]);
  const latestReport = reports?.[0];
  return {
    project: {
      productName: project.productName, description: project.description, category: project.category, toolType: project.toolType,
      motorFamily: project.motorFamily, motorBrandedName: project.motorBrandedName, motorTech: project.motorTech,
      keyDiff: project.keyDiff, pricePoint: project.pricePoint, companyContext: project.companyContext,
      targetMarket: project.targetMarket, productUrl: project.productUrl, asin: project.asin,
    },
    salesKit, tds,
    activeReport: latestReport
      ? { competitive_analysis: latestReport.competitive_analysis, pricing_analysis: latestReport.pricing_analysis, content_form: latestReport.content_form }
      : null,
  };
}

export interface FillStepResult {
  filled: number; // grounded fields overwritten verbatim from an uploaded fact
  regenerated: number; // narrative fields regenerated using source facts
  stillAwaiting: number; // fields still blank/awaiting after this pass
  changedFieldIds: string[];
  factsRetried: number;
}

// Retries stale/failed fact extraction for every active source doc first —
// shared by both fill functions below, same reasoning as the original GTM
// refill route's own comment: a doc whose LAST facts-derivation attempt
// failed (or never ran) must not stay silently stuck at 0 facts forever.
async function retryStaleExtractions(projectId: string, productName: string, routeStartTime: number): Promise<number> {
  const activeDocs = await listActiveDocsForProject(projectId);
  const staleDocs = activeDocs.filter(d => d.extraction_status === "complete" && d.facts_extraction_status !== "complete");
  for (const staleDoc of staleDocs) {
    await deriveFactsForDoc(staleDoc.id, projectId, productName, routeStartTime);
  }
  return staleDocs.length;
}

// GTM document — grounded/spec fields (verbatim override), then Marketing
// Direction + Product FAQ narrative fields (regenerate-if-blank), then Box
// Only (regenerate-if-blank) — see the original route's own header comment,
// preserved verbatim below since the reasoning didn't change, only where the
// code lives.
//
// 1. GROUNDED/spec fields: re-runs the deterministic + uploaded-TDS tiers,
//    writing only whatever actually changed.
// 2. WRITTEN/narrative fields (Marketing Direction + Product FAQ sections):
//    regenerates the whole group (these generators only ever run at group
//    granularity, matching their own initial-generation phase) but writes
//    ONLY fields that are still blank/awaiting/not-determinable at write
//    time — never touches a field with a real answer already.
// 3. Box Only section: this section has no independent phase/regenerate
//    entry point anywhere else in the app (it normally only runs inline
//    inside full GTM generation), so this is its only "fill from sources" path.
//
// A field already sourced from something more authoritative than an upload
// (manual_edit/project_record/active_report) is never touched in ANY pass.
export async function refillGtmFromSources(projectId: string, orgId: string, userId: string, actorEmail: string, routeStartTime: number = Date.now()): Promise<FillStepResult> {
  const project = await getProject(projectId, orgId) as any;
  if (!project) throw new Error("Project not found");
  const document = await getOrCreateDocument(projectId, "gtm");

  const factsRetried = await retryStaleExtractions(projectId, project.productName, routeStartTime);

  const fields = await getDocumentFields(document.id);
  const fieldsById = new Map(fields.map(f => [f.field_id, f]));

  const [sources, catalogProducts, marketingDefaults] = await Promise.all([
    buildProjectSources(project, userId),
    listCatalogProducts(),
    getMarketingDefaults(),
  ]);

  const derived = deriveFieldsFromSources(sources.project, sources.salesKit, sources.tds, sources.activeReport);
  const uploadedTdsContext = await getUploadedTdsContext(projectId);

  // ---- Pass 1: GROUNDED/spec fields ----
  const groundedChangedIds: string[] = [];
  for (const schemaField of GTM_FIELD_SCHEMA) {
    if (schemaField.kind !== "grounded") continue;
    const current = fieldsById.get(schemaField.id);
    if (!current) continue;
    if (UNTOUCHABLE_SOURCES.has(current.source || "")) continue;

    const candidateMap: Record<string, { answer: string; source: string; sourceDetail?: any }> = {
      [schemaField.id]: derived[schemaField.id] ? { ...derived[schemaField.id] } : { answer: current.answer || "N/A", source: current.source || "none" },
    };
    applyUploadedTdsFacts(candidateMap as any, [schemaField], uploadedTdsContext);
    const candidate = candidateMap[schemaField.id];

    const candidateAnswer = (candidate.answer || "").trim();
    const currentAnswer = (current.answer || "").trim();
    if (!candidateAnswer || candidateAnswer.toUpperCase() === "N/A" || candidateAnswer === currentAnswer) continue;

    await updateDocumentField(document.id, schemaField.id, candidateAnswer, actorEmail, {
      source: candidate.source, sourceDetail: candidate.sourceDetail, flagged: false,
    });
    groundedChangedIds.push(schemaField.id);
  }

  // ---- Pass 2: WRITTEN/narrative fields (Marketing Direction + Product FAQ) ----
  const marketingSchema = GTM_FIELD_SCHEMA.filter(f => f.section === "Marketing Direction" && f.kind === "written");
  const faqSchema = GTM_FIELD_SCHEMA.filter(f => f.section === "Product FAQ" && f.kind === "written");
  const wantsMarketing = marketingSchema.some(f => isBlank(fieldsById.get(f.id)?.answer));
  const wantsFaqs = faqSchema.some(f => isBlank(fieldsById.get(f.id)?.answer));

  const regeneratedIds: string[] = [];
  const isPreLaunch = !project.productUrl && !project.asin;
  const tdsGroundingBlock = buildTdsGroundingBlock(uploadedTdsContext, isPreLaunch);

  if (wantsMarketing || wantsFaqs) {
    const brand = await resolveBrandForProduct(project.productName);
    const voiceBlock = buildVoiceBlock(await getActiveVoiceGuide(brand));
    const gtmFieldsFlat = flattenDocumentFields(fields);

    if (wantsFaqs) {
      const faqFields = await generateProductFaqs(sources, gtmFieldsFlat, voiceBlock, tdsGroundingBlock);
      for (const schemaField of faqSchema) {
        const current = fieldsById.get(schemaField.id);
        if (!current || !isBlank(current.answer) || UNTOUCHABLE_SOURCES.has(current.source || "")) continue;
        const candidate = faqFields[schemaField.id];
        if (!candidate || !isRealAnswer(candidate.answer)) continue;
        await updateDocumentField(document.id, schemaField.id, candidate.answer, actorEmail, {
          source: candidate.source, sourceDetail: candidate.sourceDetail, flagged: !!candidate.flagged,
        });
        regeneratedIds.push(schemaField.id);
      }
    }

    if (wantsMarketing) {
      const refreshedFlat = wantsFaqs ? flattenDocumentFields(await getDocumentFields(document.id)) : gtmFieldsFlat;
      const matchedCatalogProduct = matchCatalogProductByName(project.productName, catalogProducts);
      const marketingFields = await generateMarketingDirection(
        sources, refreshedFlat, matchedCatalogProduct?.collection ?? null, catalogProducts, matchedCatalogProduct?.id ?? null,
        marketingDefaults.languages, voiceBlock, tdsGroundingBlock
      );
      for (const schemaField of marketingSchema) {
        const current = fieldsById.get(schemaField.id);
        if (!current || !isBlank(current.answer) || UNTOUCHABLE_SOURCES.has(current.source || "")) continue;
        const candidate = marketingFields[schemaField.id];
        if (!candidate || !isRealAnswer(candidate.answer)) continue;
        await updateDocumentField(document.id, schemaField.id, candidate.answer, actorEmail, {
          source: candidate.source, sourceDetail: candidate.sourceDetail, flagged: !!candidate.flagged,
        });
        regeneratedIds.push(schemaField.id);
      }
    }
  }

  // ---- Pass 3: Box Only section ----
  const boxOnlySchema = GTM_FIELD_SCHEMA.filter(f => f.section === "Box Only");
  const wantsBoxOnly = boxOnlySchema.some(f => isBlank(fieldsById.get(f.id)?.answer));
  if (wantsBoxOnly) {
    const latestFields = flattenDocumentFields(await getDocumentFields(document.id));
    const boxFieldsMap: Record<string, { answer: string; source: string }> = {};
    for (const [id, answer] of Object.entries(latestFields)) boxFieldsMap[id] = { answer, source: "existing" };
    const brand = await resolveBrandForProduct(project.productName);
    const voiceBlock = buildVoiceBlock(await getActiveVoiceGuide(brand));
    await applyBoxOnlyDerivation(boxFieldsMap as any, boxOnlySchema, project.productName, voiceBlock, tdsGroundingBlock);

    for (const schemaField of boxOnlySchema) {
      const current = fieldsById.get(schemaField.id);
      if (!current || !isBlank(current.answer) || UNTOUCHABLE_SOURCES.has(current.source || "")) continue;
      const candidate = (boxFieldsMap as any)[schemaField.id];
      if (!candidate || candidate.source === "existing" || !isRealAnswer(candidate.answer)) continue;
      await updateDocumentField(document.id, schemaField.id, candidate.answer, actorEmail, {
        source: candidate.source, sourceDetail: candidate.sourceDetail, flagged: !!candidate.flagged,
      });
      regeneratedIds.push(schemaField.id);
    }
  }

  if (uploadedTdsContext.docsUsed.length > 0) {
    const versions: Record<string, { id: string; version: number }> = {};
    for (const d of uploadedTdsContext.docsUsed) versions[d.docType] = { id: d.id, version: d.version };
    await setDocumentSourceDocVersions(document.id, versions);
  }

  const finalFields = await getDocumentFields(document.id);
  const stillAwaiting = finalFields.filter(f => isBlank(f.answer)).length;

  return {
    filled: groundedChangedIds.length,
    regenerated: regeneratedIds.length,
    stillAwaiting,
    changedFieldIds: [...groundedChangedIds, ...regeneratedIds],
    factsRetried,
  };
}

// Content Form document — every field is kind:"written" (no grounded/
// override distinction), so "fill" means: regenerate the whole 33-field
// sheet (this generator only ever runs at full-document granularity,
// matching its own initial-generation phase), writing ONLY fields still
// blank at write time.
export async function refillContentFormFromSources(projectId: string, orgId: string, userId: string, actorEmail: string, routeStartTime: number = Date.now()): Promise<FillStepResult> {
  const project = await getProject(projectId, orgId) as any;
  if (!project) throw new Error("Project not found");
  const document = await getOrCreateDocument(projectId, "content_form");

  const factsRetried = await retryStaleExtractions(projectId, project.productName, routeStartTime);

  const fields = await getDocumentFields(document.id);
  const fieldsById = new Map(fields.map(f => [f.field_id, f]));

  const wantsFill = CONTENT_FORM_SCHEMA.some(f => isBlank(fieldsById.get(f.id)?.answer) && !UNTOUCHABLE_SOURCES.has(fieldsById.get(f.id)?.source || ""));
  if (!wantsFill) {
    return { filled: 0, regenerated: 0, stillAwaiting: fields.filter(f => isBlank(f.answer)).length, changedFieldIds: [], factsRetried };
  }

  const gtmDocument = await getOrCreateDocument(projectId, "gtm");
  const gtmDocFields = await getDocumentFields(gtmDocument.id);
  const gtmFieldsFlat = flattenDocumentFields(gtmDocFields);

  const [sources, catalogProducts] = await Promise.all([buildProjectSources(project, userId), listCatalogProducts()]);
  const matchedCatalogProduct = matchCatalogProductByName(project.productName, catalogProducts);
  const brand = await resolveBrandForProduct(project.productName);
  const voiceBlock = buildVoiceBlock(await getActiveVoiceGuide(brand));
  const isPreLaunch = !project.productUrl && !project.asin;
  const uploadedTdsContext = await getUploadedTdsContext(projectId);
  const tdsGroundingBlock = buildTdsGroundingBlock(uploadedTdsContext, isPreLaunch);

  const generated = await generateContentForm(sources, gtmFieldsFlat, matchedCatalogProduct, voiceBlock, tdsGroundingBlock);

  const regeneratedIds: string[] = [];
  for (const schemaField of CONTENT_FORM_SCHEMA) {
    const current = fieldsById.get(schemaField.id);
    if (!current || !isBlank(current.answer) || UNTOUCHABLE_SOURCES.has(current.source || "")) continue;
    const candidate = generated[schemaField.id];
    if (!candidate || !isRealAnswer(candidate.answer)) continue;
    await updateDocumentField(document.id, schemaField.id, candidate.answer, actorEmail, {
      source: candidate.source, sourceDetail: candidate.sourceDetail, flagged: !!candidate.flagged,
    });
    regeneratedIds.push(schemaField.id);
  }

  const finalFields = await getDocumentFields(document.id);
  const stillAwaiting = finalFields.filter(f => isBlank(f.answer)).length;

  return { filled: 0, regenerated: regeneratedIds.length, stillAwaiting, changedFieldIds: regeneratedIds, factsRetried };
}

// The resumable chain driver — one step per call, exactly like
// project-generation-engine.ts's runProjectGenerationStep. Called by both
// the "start" route (which also initializes the state row) and the
// "continue" route (which just resumes it) — see app/api/projects/[id]/
// fill-from-sources/{start,continue}. A closed tab mid-chain just means this
// never gets called again until something re-triggers it (the automatic
// poll mounted in ProjectDetailPage, or a manual "Fill blanks from sources"
// click) — no background-job service involved, per this feature's own
// design (see supabase_schema.sql Section 53's comment on the reverted
// Inngest attempt).
export async function runNextFillStep(projectId: string, orgId: string, userId: string, actorEmail: string): Promise<DocumentFillStateRow | null> {
  await reclaimStaleRunningFillState(projectId);
  const state = await getDocumentFillState(projectId);
  if (!state || state.status !== "running") return state;

  const step: FillStep | undefined = state.steps[state.current_step_index];
  if (!step) {
    await updateDocumentFillState(projectId, { status: "complete" });
    return getDocumentFillState(projectId);
  }

  try {
    const result = step === "gtm"
      ? await refillGtmFromSources(projectId, orgId, userId, actorEmail)
      : await refillContentFormFromSources(projectId, orgId, userId, actorEmail);

    const nextIndex = state.current_step_index + 1;
    const isDone = nextIndex >= state.steps.length;
    await updateDocumentFillState(projectId, {
      status: isDone ? "complete" : "running",
      currentStepIndex: nextIndex,
      resultsPatch: { [step]: result },
    });
  } catch (err: any) {
    await updateDocumentFillState(projectId, {
      status: "failed",
      resultsPatch: { [step]: { error: err.message || "Fill step failed" } },
    });
  }
  return getDocumentFillState(projectId);
}
