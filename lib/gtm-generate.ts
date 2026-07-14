// Core GTM field-generation pipeline — shared by the full-document generate
// route and the single-field regenerate route. Source priority: project
// record > project documents (TDS/Sales Kit/Competitive Analysis) > real
// web search (OpenAI's native web_search tool, same trust model already
// proven in lib/analysisEngine.ts/lib/product-news.ts) > N/A. Every one of
// the 74 fields is eligible for the web tier now — previously only 7 were
// (the rest were contractually forced to N/A the moment the project's own
// documents didn't already contain the spec), which was the main reason
// most fields never completed.
import { callAiForFields } from "./ai-json-call";
import { genAI, hasGeminiKey, GEMINI_MODEL, cleanJsonString } from "./gemini";
import { openai, hasOpenAIKey, OPENAI_MODEL } from "./openai";
import { GTM_FIELD_SCHEMA, GtmField, GtmFieldAnswer, GtmFieldSource } from "./gtm-field-schema";
import { deriveFieldsFromSources, ProjectRecord } from "./gtm-derive";
import { verifyGrounding, checkConsistency, SourceTexts } from "./gtm-grounding";
import { textSimilarity, BOILERPLATE_SIMILARITY_THRESHOLD } from "./text-similarity";
import { meetsElaborationBar } from "./gtm-elaboration";
import { GENERIC_EXEMPLARS } from "./gtm-reference-exemplars";
import { DocumentFieldRow, getMostRecentOtherDocumentFields } from "./db/documents";

// Vercel Hobby's function timeout is a fixed 60s and cannot be raised.
// This leaves headroom for the DB writes that still happen after
// generateAllFields returns, so the boilerplate-guard retry pass below
// bails out before actually hitting the platform limit.
const PIPELINE_TIME_BUDGET_MS = 45_000;

// The main call now carries real web search across all 74 fields (not the
// old docs-only, 25s-timeout call) — confirmed live that 25s was too tight
// even for the docs-only version and was silently truncating/timing out,
// with every failure swallowed into a misleading "N/A" (callOpenAiForJson
// catches all errors and returns null — see lib/openai.ts). 38s leaves
// real room, within the 60s route budget, for the second-chance web
// fallback pass and the written-field quality-guard retry pass that both
// still need to run afterward, plus the DB writes back in the route handler.
const MAIN_CALL_TIMEOUT_MS = 38_000;

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

function callAi(systemInstruction: string, userContent: string, opts?: { timeoutMs?: number }) {
  // maxToolCalls: 10 — up to 74 fields can each need their own search;
  // bounded so one call can't run away the way an uncapped web_search call
  // did in the prior (now-removed) Anthropic integration.
  return callAiForFields(systemInstruction, userContent, "GTM", {
    webSearch: true,
    maxToolCalls: 10,
    timeoutMs: opts?.timeoutMs ?? MAIN_CALL_TIMEOUT_MS,
  });
}

function mergeField(schemaField: GtmField, aiRaw: Record<string, { answer: string; source: string }> | null, derived: Record<string, GtmFieldAnswer>): { field: GtmFieldAnswer; fromAi: boolean } {
  const got = aiRaw?.[schemaField.id];
  const aiAnswer = got?.answer?.trim();
  const aiUsable = !!aiAnswer && aiAnswer.toUpperCase() !== "N/A" && aiAnswer.toUpperCase() !== "TBD";
  if (aiUsable) {
    return { field: { answer: aiAnswer!, source: (got?.source as GtmFieldSource) || "multiple" }, fromAi: true };
  }
  if (derived[schemaField.id]) return { field: derived[schemaField.id], fromAi: false };
  return { field: { answer: "N/A", source: "none" }, fromAi: false };
}

// Full 74-field generation: AI (if available) -> deterministic derivation
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
  const systemInstruction = buildSystemInstruction(productName, schema);
  const userContent = buildUserContent(sourceTexts);

  const aiRaw = await callAi(systemInstruction, userContent);
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

  // Web fallback fills genuinely-unanswered whitelisted fields before the
  // quality guard runs, so a web-sourced answer still gets checked for
  // depth/genericness like any other written-field answer.
  await applyWebSearchFallback(grounded, schema, productName, pipelineStart);
  await guardWrittenFieldsQuality(grounded, schema, sources, productName, projectId, pipelineStart);

  return grounded;
}

// Regenerates exactly one field through the same pipeline.
export async function generateSingleField(fieldId: string, sources: GtmSources, projectId: string): Promise<GtmFieldAnswer> {
  const productName = sources.project.productName;
  const schemaField = GTM_FIELD_SCHEMA.find(f => f.id === fieldId);
  if (!schemaField) throw new Error(`Unknown field id: ${fieldId}`);

  const sourceTexts = buildSourceTexts(sources);
  const systemInstruction = buildSystemInstruction(productName, [schemaField]);
  const userContent = buildUserContent(sourceTexts);

  // A single field needs far less search than the full 74-field sweep —
  // this route's own maxDuration is 45s, and the web-fallback/quality-guard
  // passes below still need their share of it.
  const aiRaw = await callAi(systemInstruction, userContent, { timeoutMs: 30_000 });
  const derived = deriveFieldsFromSources(sources.project, sources.salesKit, sources.tds, sources.activeReport);
  const { field: mergedField, fromAi } = mergeField(schemaField, aiRaw, derived);

  const grounded = fromAi && mergedField.source !== "web"
    ? verifyGrounding({ [fieldId]: mergedField }, [schemaField], sourceTextBlocks(sourceTexts))[fieldId]
    : mergedField;

  if (schemaField.kind === "written") {
    const guarded = { [fieldId]: grounded };
    await applyWebSearchFallback(guarded, [schemaField], productName, Date.now());
    await guardWrittenFieldsQuality(guarded, [schemaField], sources, productName, projectId, Date.now());
    return guarded[fieldId];
  }

  return grounded;
}

// Second-chance web search for whatever's STILL unanswered after the main
// call (which now already tries web search itself, across all 74 fields —
// this covers anything that call's own tool-call budget didn't reach).
// Every field is eligible now, not just a small whitelist — the whitelist
// was the main reason most fields never completed; the remaining 67 were
// contractually forced to N/A whenever the project's own documents didn't
// already have the spec, even though a real web search plainly could have
// found it. One call covers every eligible N/A field at once, never one
// call per field, and is skipped once the pipeline is close to Vercel's
// 60s cap — same time-budget discipline as the boilerplate-retry pass
// below.
async function applyWebSearchFallback(
  fields: Record<string, GtmFieldAnswer>,
  schema: GtmField[],
  productName: string,
  pipelineStart: number
) {
  const eligible = schema.filter(f => !fields[f.id] || fields[f.id].source === "none" || fields[f.id].answer.toUpperCase() === "N/A");
  if (eligible.length === 0 || (!hasOpenAIKey && !hasGeminiKey)) return;
  if (Date.now() - pipelineStart > PIPELINE_TIME_BUDGET_MS) return;

  const fieldList = eligible.map(f => `- ${f.id}: ${f.question}`).join("\n");
  const systemInstruction = `Search the web for verifiable public information about the product "${productName}" to answer the fields below. Use ONLY information you find via search — never guess or use general knowledge about similar products. If nothing reliable is found for a field, return "N/A".

Do not narrate your search process — search silently, then respond with ONLY the final JSON object. No preamble, no commentary.

Return ONLY valid JSON, no markdown, keyed by field id: { "<field_id>": { "answer": "..." } }

FIELDS:
${fieldList}`;

  // OpenAI is primary — its own native web_search tool handles the lookup.
  // Gemini's googleSearch is the fallback if OpenAI is unavailable/fails.
  if (hasOpenAIKey) {
    try {
      const response: any = await openai.responses.create(
        {
          model: OPENAI_MODEL,
          reasoning: { effort: "low" },
          // max_tool_calls bounds search chaining; without it a single call
          // can run away (see lib/analysisEngine.ts's runOpenAiWebSearch for
          // the same lesson learned from the prior, now-removed Anthropic
          // integration).
          tools: [{ type: "web_search" as any }],
          max_tool_calls: 6,
          instructions: systemInstruction,
          input: `Product: ${productName}`,
        } as any,
        // Short — this only runs at all if PIPELINE_TIME_BUDGET_MS above
        // left room, and the quality-guard retry pass still needs its
        // share of whatever's left in the route's 60s ceiling.
        { timeout: 15_000 }
      );
      const queries: string[] = (response.output || [])
        .filter((o: any) => o.type === "web_search_call")
        .flatMap((o: any) => o.action?.queries || (o.action?.query ? [o.action.query] : []));
      const message = (response.output || []).find((o: any) => o.type === "message");
      const text: string = message?.content?.find((c: any) => c.type === "output_text")?.text || response.output_text || "";
      const parsed = JSON.parse(cleanJsonString(text || "{}"));

      for (const f of eligible) {
        const answer = parsed?.[f.id]?.answer?.trim();
        if (answer && answer.toUpperCase() !== "N/A") {
          fields[f.id] = { answer, source: "web", sourceDetail: { webSearchQueries: queries }, flagged: false };
        }
      }
      return;
    } catch (err) {
      console.warn("OpenAI GTM web-search fallback failed, trying Gemini:", err);
    }
  }

  if (!hasGeminiKey) return;
  try {
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Product: ${productName}`,
      config: { systemInstruction, tools: [{ googleSearch: {} }], maxOutputTokens: 2048 },
    });
    const queries: string[] = response.candidates?.[0]?.groundingMetadata?.webSearchQueries || [];
    const parsed = JSON.parse(cleanJsonString(response.text || "{}"));

    for (const f of eligible) {
      const answer = parsed?.[f.id]?.answer?.trim();
      if (answer && answer.toUpperCase() !== "N/A") {
        fields[f.id] = { answer, source: "web", sourceDetail: { webSearchQueries: queries }, flagged: false };
      }
    }
  } catch (err) {
    console.warn("GTM web-search fallback failed:", err);
  }
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
      const retryAnswer = retryRaw?.[f.id]?.answer?.trim();

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
