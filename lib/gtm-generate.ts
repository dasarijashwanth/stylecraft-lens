// Core GTM field-generation pipeline — shared by the full-document generate
// route and the single-field regenerate route. Field-resolution ladder:
// project record > project documents (TDS/Sales Kit/Competitive Analysis)
// > real web search (OpenAI's native web_search tool, same trust model
// already proven in lib/analysisEngine.ts/lib/product-news.ts) > computed
// derivation (good_better_best/hair_type) > category-level "typical for
// this kind of product" default > an honest "Not determinable — {reason}"
// terminal state (never a bare N/A/TBD). Every non-"internal" field is
// eligible for the web tier — previously only 7 were (the rest were
// contractually forced to N/A the moment the project's own documents
// didn't already contain the spec), which was the main reason most fields
// never completed. "internal"-kind fields (genuine human decisions —
// packaging specs, approved pricing) skip the AI/web/derived/category
// tiers entirely and terminate at "Awaiting internal input" instead.
import { callAiForFields, coerceAiAnswer } from "./ai-json-call";
import { GTM_FIELD_SCHEMA, GTM_SECTIONS, GtmField, GtmFieldAnswer, GtmFieldSource } from "./gtm-field-schema";
import { deriveFieldsFromSources, ProjectRecord } from "./gtm-derive";
import { applyTier6Inference } from "./gtm-tier6-inference";
import { getCategoryDefault, CATEGORY_DEFAULT_LABEL_PREFIX } from "./category-defaults";
import { applyWebSearchFallback } from "./web-search-fallback";
import { finalizeFieldAnswers } from "./field-finalize";
import { isRealAnswer } from "./field-answer-state";
import { verifyGrounding, checkConsistency, SourceTexts } from "./gtm-grounding";
import { textSimilarity, BOILERPLATE_SIMILARITY_THRESHOLD } from "./text-similarity";
import { meetsElaborationBar } from "./gtm-elaboration";
import { GENERIC_EXEMPLARS } from "./gtm-reference-exemplars";
import { DocumentFieldRow, getMostRecentOtherDocumentFields } from "./db/documents";

// Vercel Hobby's function timeout is a fixed 60s and cannot be raised.
// Confirmed live that a 45s/45s split here still produced a hard 504 (the
// whole route killed by Vercel, worse than a graceful per-field N/A) —
// tightened so the fallback/quality-guard passes reliably bail out with
// real time still left before the platform limit, rather than racing it.
const PIPELINE_TIME_BUDGET_MS = 30_000;

// A single call covering all 77 fields with web search enabled was
// confirmed live to time out even at 38s (OpenAI's own request timeout) —
// once genuine web search is involved across that many fields, one call
// can't reliably finish inside any budget that still leaves room for the
// fallback/quality-guard passes and DB writes within the route's 60s
// ceiling. Split into small, evenly-sized chunks instead (see
// FIELDS_PER_CHUNK below) — each chunk's scope is small enough to
// realistically finish well inside its own timeout, and running them all
// via Promise.all means total wall-clock is bounded by the slowest chunk,
// not the sum of all of them.
const SECTION_CALL_TIMEOUT_MS = 28_000;

export interface GtmSources {
  project: ProjectRecord;
  salesKit: any | null;
  // Flat field_id -> answer map read from the TDS document's document_fields
  // rows (see lib/db/documents.ts's flattenDocumentFields) — TDS moved off
  // its old nested project_outputs blob onto the same documents/
  // document_fields model GTM uses, so this is no longer arbitrary JSON.
  tds: Record<string, string> | null;
  activeReport: { competitive_analysis?: any; pricing_analysis?: any; content_form?: any } | null;
}

export function buildSourceTexts(sources: GtmSources): SourceTexts {
  return {
    projectRecord: JSON.stringify({
      productName: sources.project.productName,
      description: sources.project.description,
      category: sources.project.category,
      motorTech: sources.project.motorTech,
      keyDiff: sources.project.keyDiff,
      pricePoint: sources.project.pricePoint,
      companyContext: sources.project.companyContext,
    }),
    competitiveAnalysis: JSON.stringify(sources.activeReport?.competitive_analysis || {}),
    tds: JSON.stringify(sources.tds || {}),
    salesKit: JSON.stringify(sources.salesKit || {}),
  };
}

function sourceTextBlocks(sourceTexts: SourceTexts): string[] {
  return [sourceTexts.projectRecord, sourceTexts.competitiveAnalysis, sourceTexts.tds, sourceTexts.salesKit];
}

// Text blob for lib/gtm-tier6-inference.ts's keyword-based hair_type
// inference — every source that could plausibly mention hair type in
// prose, not the structured spec fields already covered by gtm-derive.ts.
function buildHairTypeSourceText(sources: GtmSources): string {
  return [
    sources.tds?.product_description,
    (sources.salesKit?.key_features || []).map((f: any) => f.headline).filter(Boolean).join(" "),
    sources.project.category,
  ].filter(Boolean).join(" ");
}

function buildSystemInstruction(productName: string, schema: GtmField[]) {
  const fieldList = schema
    .map(f => `- ${f.id} [${f.section}] (${f.kind === "grounded" ? "HARD-GROUNDED" : "WRITTEN"}): ${f.question}`)
    .join("\n");

  return `You are generating a Go-To-Market Product Knowledge sheet for ONE specific product: ${productName}. Write it like a real product marketing team would — detailed and structured, never one-word or generic.

Rules:
- Answer every field using ONLY the labeled sources provided below. Cite the source per field.
- HARD-GROUNDED fields (specs: dimensions, weight, RPM, run time, voltage, cord length, blade names, quantities, colors, pricing, warranty, box/pallet data, included-in-box items): copy values exactly as they appear in the sources, units included. If a value is not present in any source, return "N/A". NEVER estimate, infer, or reuse a value from another product.
- WRITTEN fields (positioning statement, story, reason to buy, expert tip, messaging): write them specifically about THIS product, referencing its actual named features and specs from the sources. Do not produce generic copy that could apply to any similar product — every claim must trace back to a real fact in the sources.
- Source priority, highest first: the Project Record > Competitive Analysis / TDS / Sales Kit documents > real web search. If a field's answer is not in the labeled sources below, use web search to find real, verifiable public information about this EXACT product (its official product page, retailer listings, spec sheets) — never general/world knowledge, never a guess, and never a value from a different or similar product. Mark any web-sourced field's "source" as "web" in your JSON response. Only return "N/A" if the answer genuinely cannot be found in the sources OR via a real web search.
- Bias: specs/motor/blades/packaging/included-in-box come from TDS; positioning/pricing tiers/USPs/upsell/expert tip come from Sales Kit; COMPS/buying-guide/competitive context come from Competitive Analysis. Fields still missing after checking all of these are exactly the ones worth a web search.

REQUIRED DEPTH for these specific fields (this describes FORMAT AND DEPTH ONLY — never copy this wording, it is not about the current product):
- why_creating_item: a numbered list of 4-6 concrete reasons (consumer need, competitive gap, identity/customization, credibility, system completion), each one sentence, specific to this product's real facts.
- positioning_statement: a 4-6 sentence narrative paragraph covering origin, goal, design considerations, and the product's role in the lineup — not a single generic sentence.
- product_name_origin / name_story_tie: 2-4 sentences connecting the actual product name to a real fact about the brand or product (skip gracefully to N/A if the sources give no real basis — never invent a naming story).
- reason_to_buy: 5 numbered USPs, each a bolded-style claim followed by the supporting spec that backs it (e.g. "First-ever [real tech from sources] — [real spec value from sources]").
- expert_tip: 1-2 sentences of concrete, actionable usage/maintenance advice tied to this product's real features.
- features_full_list: a complete bullet list with exact spec values and units from the sources, not paraphrased summaries.
Simple fields (core_consumer, good_better_best, warranty, certification_needed, etc.) stay short and exact — do not pad these with filler.

FIELD SCHEMA (id [section] (grounded|written): question):
${fieldList}

Return ONLY valid JSON — no markdown, no explanation — keyed by field id:
{ "<field_id>": { "answer": "...", "source": "project_record" | "competitive_analysis" | "tds" | "sales_kit" | "web" | "multiple" | "none" } }

If the answer genuinely cannot be found in the sources or via web search, return { "answer": "N/A", "source": "none" }. Every field id listed above must appear in your response.`;
}

function buildUserContent(sourceTexts: SourceTexts) {
  return `<PROJECT_RECORD>
${sourceTexts.projectRecord}
</PROJECT_RECORD>

<COMPETITIVE_ANALYSIS>
${sourceTexts.competitiveAnalysis}
</COMPETITIVE_ANALYSIS>

<TDS>
${sourceTexts.tds}
</TDS>

<SALES_KIT>
${sourceTexts.salesKit}
</SALES_KIT>`;
}

function callAi(systemInstruction: string, userContent: string, opts?: { timeoutMs?: number; maxToolCalls?: number; projectId?: string }) {
  return callAiForFields(systemInstruction, userContent, "GTM", {
    webSearch: true,
    maxToolCalls: opts?.maxToolCalls ?? 3,
    timeoutMs: opts?.timeoutMs ?? SECTION_CALL_TIMEOUT_MS,
    projectId: opts?.projectId,
  });
}

// Fixed-size chunks rather than by-section: sections range from 2 fields
// (Lids) to 22 (General) — confirmed live that grouping by section still
// produced a hard 504 (Vercel killed the whole route at its 60s ceiling,
// worse than a graceful per-field N/A), because the largest section alone
// was still too much for one call. Small, evenly-sized chunks keep every
// individual call's scope — and therefore its realistic completion time —
// uniform regardless of how the schema happens to be organized. Merges
// into the same {fieldId: {answer, source}} shape the rest of the
// pipeline already expects, so nothing downstream needs to know the call
// was split.
// Confirmed live: even 6 fields per chunk at a 28s timeout still let a
// handful of chunks time out (web-search-augmented multi-field extraction
// with gpt-5 has consistently run 20-50s for a single focused item all
// session, regardless of how few fields are asked for) — smaller chunks
// trade a few more concurrent requests for a real reduction in how often
// any one of them needs more time than it's given.
const FIELDS_PER_CHUNK = 4;

async function callAiPerSection(productName: string, schema: GtmField[], userContent: string, projectId: string): Promise<Record<string, { answer: string; source: string }> | null> {
  const chunks: GtmField[][] = [];
  for (let i = 0; i < schema.length; i += FIELDS_PER_CHUNK) chunks.push(schema.slice(i, i + FIELDS_PER_CHUNK));

  const results = await Promise.all(
    chunks.map(fields => callAi(buildSystemInstruction(productName, fields), userContent, { maxToolCalls: 3, projectId }))
  );

  const merged: Record<string, { answer: string; source: string }> = {};
  let anySucceeded = false;
  for (const raw of results) {
    if (!raw) continue;
    anySucceeded = true;
    Object.assign(merged, raw);
  }
  return anySucceeded ? merged : null;
}

function mergeField(schemaField: GtmField, aiRaw: Record<string, { answer: string; source: string }> | null, derived: Record<string, GtmFieldAnswer>): { field: GtmFieldAnswer; fromAi: boolean } {
  const got = aiRaw?.[schemaField.id];
  const aiAnswer = coerceAiAnswer(got?.answer);
  const aiUsable = !!aiAnswer && aiAnswer.toUpperCase() !== "N/A" && aiAnswer.toUpperCase() !== "TBD";
  if (aiUsable) {
    return { field: { answer: aiAnswer!, source: (got?.source as GtmFieldSource) || "multiple" }, fromAi: true };
  }
  if (derived[schemaField.id]) return { field: derived[schemaField.id], fromAi: false };
  return { field: { answer: "N/A", source: "none" }, fromAi: false };
}

// Tier 7 — mutates `fields` in place. Skips "internal"-kind fields (a
// category-typical guess about a packaging/pricing DECISION makes no
// sense) and anything that already has a real answer from an earlier tier.
function applyCategoryDefaults(fields: Record<string, GtmFieldAnswer>, schema: GtmField[], category: string | null | undefined) {
  for (const f of schema) {
    if (f.kind === "internal" || isRealAnswer(fields[f.id]?.answer)) continue;
    const value = getCategoryDefault(category, f.id);
    if (value) {
      fields[f.id] = { answer: `${CATEGORY_DEFAULT_LABEL_PREFIX}${value}`, source: "category_default" };
    }
  }
}

// Full 77-field generation: AI (if available) -> deterministic derivation
// floor -> grounding verification -> cross-source consistency check ->
// anti-boilerplate rewrite pass for written fields.
//
// Grounding verification only ever runs against AI-provided answers.
// Deterministically-derived answers are direct field copies from the
// source objects (see gtm-derive.ts) — they cannot hallucinate by
// construction, and substring-checking them against the raw source JSON
// produces false rejections whenever the derivation formats/joins multiple
// sub-fields (e.g. warranty duration + coverage joined with " — ").
export async function generateAllFields(productName: string, sources: GtmSources, projectId: string): Promise<Record<string, GtmFieldAnswer>> {
  const pipelineStart = Date.now();
  const schema = GTM_FIELD_SCHEMA;
  const sourceTexts = buildSourceTexts(sources);
  const userContent = buildUserContent(sourceTexts);

  // "internal"-kind fields (dieline, approved pricing, etc.) are never
  // asked of the AI — nothing about a packaging/pricing DECISION is
  // answerable by reading sources or web search. They still go through
  // mergeField below via the FULL schema, so the deterministic `derived`
  // floor (tiers 1-4) can still populate them from real TDS/project data.
  const aiEligibleSchema = schema.filter(f => f.kind !== "internal");
  const aiRaw = await callAiPerSection(productName, aiEligibleSchema, userContent, projectId);
  const derived = deriveFieldsFromSources(sources.project, sources.salesKit, sources.tds, sources.activeReport);

  const merged: Record<string, GtmFieldAnswer> = {};
  const aiSourcedIds = new Set<string>();
  for (const f of schema) {
    const { field: value, fromAi } = mergeField(f, aiRaw, derived);
    merged[f.id] = value;
    // Web-sourced answers are real (OpenAI's own web_search tool actually
    // searched and read a page — same trust model as
    // lib/analysisEngine.ts/lib/product-news.ts), but they won't literally
    // appear in the internal project/TDS/sales-kit JSON blocks the
    // substring check below compares against — excluding them here avoids
    // rejecting genuinely-correct web answers as "ungrounded".
    if (fromAi && value.source !== "web") aiSourcedIds.add(f.id);
  }

  const groundedAiOnly = verifyGrounding(merged, schema.filter(f => aiSourcedIds.has(f.id)), sourceTextBlocks(sourceTexts));
  const grounded = { ...merged, ...groundedAiOnly };

  const conflicts = checkConsistency(aiRaw, derived, schema);
  for (const [fieldId, info] of Object.entries(conflicts)) {
    if (grounded[fieldId]) {
      grounded[fieldId] = {
        ...grounded[fieldId],
        flagged: true,
        sourceDetail: { ...(grounded[fieldId].sourceDetail || {}), conflict: info.values },
      };
    }
  }

  // Tier 5 — web fallback fills genuinely-unanswered fields before the
  // quality guard runs, so a web-sourced answer still gets checked for
  // depth/genericness like any other written-field answer. Internal fields
  // are excluded from the eligible schema, same reasoning as the AI call.
  await applyWebSearchFallback(grounded, aiEligibleSchema, productName, pipelineStart, PIPELINE_TIME_BUDGET_MS);

  // Tier 6 (computed derivation, e.g. good_better_best/hair_type) runs
  // strictly after the web-search tier — these are pure/free to compute
  // but must never preempt a real web search result the way an eager
  // pre-AI derivation would (see lib/gtm-tier6-inference.ts).
  applyTier6Inference(grounded, schema, {
    pricingAnalysis: sources.activeReport?.pricing_analysis || null,
    hairTypeSourceText: buildHairTypeSourceText(sources),
  });

  // Tier 7 — category-level "typical for this kind of product" default,
  // the last and lowest-confidence fill before an honest "not determinable".
  applyCategoryDefaults(grounded, schema, sources.project.category);

  await guardWrittenFieldsQuality(grounded, schema, sources, productName, projectId, pipelineStart);

  // Terminal step — converts anything still unresolved into
  // "Not determinable — {reason}" ("Awaiting internal input" for
  // internal-kind fields) instead of a bare N/A/TBD.
  return finalizeFieldAnswers(grounded, schema, "not found in product data, TDS/Sales Kit/Competitive Analysis, or web search");
}

// Regenerates exactly one field through the same pipeline.
export async function generateSingleField(fieldId: string, sources: GtmSources, projectId: string): Promise<GtmFieldAnswer> {
  const productName = sources.project.productName;
  const schemaField = GTM_FIELD_SCHEMA.find(f => f.id === fieldId);
  if (!schemaField) throw new Error(`Unknown field id: ${fieldId}`);

  const derived = deriveFieldsFromSources(sources.project, sources.salesKit, sources.tds, sources.activeReport);

  // "internal"-kind fields are genuine human decisions — the API route
  // itself also rejects a direct regenerate request for one of these (see
  // app/api/documents/gtm/[id]/fields/[fieldId]/regenerate/route.ts); this
  // is defense in depth. Only tier 1-4 (the deterministic `derived` floor)
  // applies — never AI/web/computed-derivation/category tiers.
  if (schemaField.kind === "internal") {
    const finalized = finalizeFieldAnswers(
      { [fieldId]: derived[fieldId] || { answer: "N/A", source: "none" } },
      [schemaField],
      "no product-data source available for this internal field"
    );
    return finalized[fieldId];
  }

  const sourceTexts = buildSourceTexts(sources);
  const systemInstruction = buildSystemInstruction(productName, [schemaField]);
  const userContent = buildUserContent(sourceTexts);

  // A single field needs far less search than the full 77-field sweep —
  // this route's own maxDuration is 45s, and the web-fallback/quality-guard
  // passes below still need their share of it.
  const aiRaw = await callAi(systemInstruction, userContent, { timeoutMs: 30_000, projectId });
  const { field: mergedField, fromAi } = mergeField(schemaField, aiRaw, derived);

  const grounded = fromAi && mergedField.source !== "web"
    ? verifyGrounding({ [fieldId]: mergedField }, [schemaField], sourceTextBlocks(sourceTexts))[fieldId]
    : mergedField;

  // Web fallback + tier-6 inference + category default apply regardless of
  // field kind — a single regenerated "grounded" field deserves the same
  // second-chance tiers the full 77-field sweep already gives it above.
  const guarded = { [fieldId]: grounded };
  await applyWebSearchFallback(guarded, [schemaField], productName, Date.now(), PIPELINE_TIME_BUDGET_MS);
  applyTier6Inference(guarded, [schemaField], {
    pricingAnalysis: sources.activeReport?.pricing_analysis || null,
    hairTypeSourceText: buildHairTypeSourceText(sources),
  });
  applyCategoryDefaults(guarded, [schemaField], sources.project.category);

  if (schemaField.kind === "written") {
    await guardWrittenFieldsQuality(guarded, [schemaField], sources, productName, projectId, Date.now());
  }

  const finalized = finalizeFieldAnswers(guarded, [schemaField], "not found in product sources or web search");
  return finalized[fieldId];
}

// Mutates `fields` in place. Three independent reasons flag a written
// field for one retry attempt: (1) too similar to the same field on the
// most recently generated OTHER project (cross-product boilerplate),
// (2) fails the minimum elaboration depth for that field
// (lib/gtm-elaboration.ts), (3) too similar to a deliberately generic
// reference exemplar (lib/gtm-reference-exemplars.ts) — i.e. lazy,
// could-apply-to-any-product copy. All three share the SAME single retry
// attempt, not one round trip per reason.
//
// All retries fire concurrently (Promise.all), not one-at-a-time — with up
// to 9 written fields, a sequential loop of individual AI round-trips was
// blowing well past Vercel's fixed 60s function timeout on top of the
// initial full-document generation call, producing a hard 504 instead of
// a JSON response. If the pipeline is already close to the time budget
// (e.g. the main generation call itself ran long), retries are skipped
// entirely and the fields are just flagged — never silently exceed the cap.
async function guardWrittenFieldsQuality(
  fields: Record<string, GtmFieldAnswer>,
  schema: GtmField[],
  sources: GtmSources,
  productName: string,
  projectId: string,
  pipelineStart: number
) {
  const writtenFields = schema.filter(f => f.kind === "written");
  if (writtenFields.length === 0) return;

  const otherFields = await getMostRecentOtherDocumentFields(projectId, "gtm");
  const otherByFieldId = new Map(otherFields.map(f => [f.field_id, f]));

  const facts = [sources.project.motorTech, sources.project.keyDiff, sources.project.pricePoint]
    .filter(Boolean)
    .map(v => String(v));

  type Reason = { kind: "boilerplate" | "shallow" | "generic"; detail?: string };
  const retryReasons = new Map<string, Reason>();

  for (const f of writtenFields) {
    const current = fields[f.id];
    if (!current?.answer || current.answer.toUpperCase() === "N/A") continue;

    const other = otherByFieldId.get(f.id);
    if (other?.answer && other.answer.toUpperCase() !== "N/A" && textSimilarity(current.answer, other.answer) > BOILERPLATE_SIMILARITY_THRESHOLD) {
      retryReasons.set(f.id, { kind: "boilerplate", detail: other.answer });
      continue;
    }
    if (!meetsElaborationBar(f.id, current.answer)) {
      retryReasons.set(f.id, { kind: "shallow" });
      continue;
    }
    const exemplar = GENERIC_EXEMPLARS[f.id];
    if (exemplar && textSimilarity(current.answer, exemplar) > BOILERPLATE_SIMILARITY_THRESHOLD) {
      retryReasons.set(f.id, { kind: "generic" });
    }
  }

  if (retryReasons.size === 0) return;
  const needsRetry = writtenFields.filter(f => retryReasons.has(f.id));

  const flagAsIs = (f: GtmField, extraReason: string) => {
    const reason = retryReasons.get(f.id)!;
    fields[f.id] = { ...fields[f.id], flagged: true, sourceDetail: { ...(fields[f.id].sourceDetail || {}), reason: extraReason, similarTo: reason.detail } };
  };

  if (Date.now() - pipelineStart > PIPELINE_TIME_BUDGET_MS) {
    for (const f of needsRetry) flagAsIs(f, `${retryReasons.get(f.id)!.kind}-retry-skipped-timeout`);
    return;
  }

  const sourceTexts = buildSourceTexts(sources);
  const userContent = buildUserContent(sourceTexts);

  await Promise.all(
    needsRetry.map(async (f) => {
      const current = fields[f.id];
      const reason = retryReasons.get(f.id)!;
      const other = otherByFieldId.get(f.id);
      const instructionByReason = {
        boilerplate: `The previous draft was too generic — it closely matched another product's copy for this field.`,
        shallow: `The previous draft was too short/shallow — it needs real depth (see the REQUIRED DEPTH guidance above for this field).`,
        generic: `The previous draft read like generic, could-apply-to-any-product marketing filler.`,
      }[reason.kind];
      const retryInstruction = `${buildSystemInstruction(productName, [f])}\n\n${instructionByReason} Rewrite it using these specific facts about ${productName}: ${facts.join("; ") || "(use the specs and description from the sources above)"}.`;
      // These retries run concurrently for up to 9 written fields — a
      // shorter timeout each keeps the whole Promise.all safely inside the
      // pipeline's remaining time budget (checked just above this block).
      const retryRaw = await callAi(retryInstruction, userContent, { timeoutMs: 20_000 });
      const retryAnswer = coerceAiAnswer(retryRaw?.[f.id]?.answer);

      const exemplar = GENERIC_EXEMPLARS[f.id];
      const stillBoilerplate = other?.answer && retryAnswer ? textSimilarity(retryAnswer, other.answer) > BOILERPLATE_SIMILARITY_THRESHOLD : false;
      const stillShallow = retryAnswer ? !meetsElaborationBar(f.id, retryAnswer) : true;
      const stillGeneric = exemplar && retryAnswer ? textSimilarity(retryAnswer, exemplar) > BOILERPLATE_SIMILARITY_THRESHOLD : false;

      if (retryAnswer && retryAnswer.toUpperCase() !== "N/A" && !stillBoilerplate && !stillShallow && !stillGeneric) {
        fields[f.id] = { answer: retryAnswer, source: (retryRaw?.[f.id]?.source as GtmFieldSource) || current.source };
      } else {
        flagAsIs(f, reason.kind);
      }
    })
  );
}
