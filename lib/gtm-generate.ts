// Core GTM field-generation pipeline — shared by the full-document generate
// route and the single-field regenerate route. Fix 1's grounding/hierarchy
// rules live here: project record > project documents > N/A (web enrichment
// deferred — see WEB_ELIGIBLE_FIELD_IDS in gtm-field-schema.ts).
import { genAI, hasGeminiKey, GEMINI_MODEL, cleanJsonString } from "./gemini";
import { anthropic, hasAnthropicKey, ANTHROPIC_MODEL } from "./anthropic";
import { GTM_FIELD_SCHEMA, GtmField, GtmFieldAnswer, GtmFieldSource } from "./gtm-field-schema";
import { deriveFieldsFromSources, ProjectRecord } from "./gtm-derive";
import { verifyGrounding, checkConsistency, SourceTexts } from "./gtm-grounding";
import { textSimilarity, BOILERPLATE_SIMILARITY_THRESHOLD } from "./text-similarity";
import { DocumentFieldRow, getMostRecentOtherDocumentFields } from "./db/documents";

export interface GtmSources {
  project: ProjectRecord;
  salesKit: any | null;
  tds: any | null;
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

function buildSystemInstruction(productName: string, schema: GtmField[]) {
  const fieldList = schema
    .map(f => `- ${f.id} [${f.section}] (${f.kind === "grounded" ? "HARD-GROUNDED" : "WRITTEN"}): ${f.question}`)
    .join("\n");

  return `You are generating a Go-To-Market Product Knowledge sheet for ONE specific product: ${productName}.

Rules:
- Answer every field using ONLY the labeled sources provided below. Cite the source per field.
- HARD-GROUNDED fields (specs: dimensions, weight, RPM, run time, voltage, cord length, blade names, quantities, colors, pricing, warranty, box/pallet data, included-in-box items): copy values exactly as they appear in the sources. If a value is not present in any source, return "N/A". NEVER estimate, infer, or reuse a value from another product.
- WRITTEN fields (positioning statement, story, reason to buy, expert tip, messaging): write them specifically about THIS product, referencing its actual named features and specs from the sources. Do not produce generic copy that could apply to any similar product.
- Source priority, highest first: the Project Record > Competitive Analysis / TDS / Sales Kit documents. Never use general/world knowledge or web search.
- Bias: specs/motor/blades/packaging/included-in-box come from TDS; positioning/pricing tiers/USPs/upsell/expert tip come from Sales Kit; COMPS/buying-guide/competitive context come from Competitive Analysis.

FIELD SCHEMA (id [section] (grounded|written): question):
${fieldList}

Return ONLY valid JSON — no markdown, no explanation — keyed by field id:
{ "<field_id>": { "answer": "...", "source": "project_record" | "competitive_analysis" | "tds" | "sales_kit" | "multiple" | "none" } }

If the sources do not contain the answer for a field, return { "answer": "N/A", "source": "none" }. Every field id listed above must appear in your response.`;
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

async function callAi(systemInstruction: string, userContent: string): Promise<Record<string, { answer: string; source: string }> | null> {
  if (hasGeminiKey) {
    try {
      const message = await genAI.models.generateContent({
        model: GEMINI_MODEL,
        config: { systemInstruction, maxOutputTokens: 8192 },
        contents: userContent,
      });
      return JSON.parse(cleanJsonString(message.text || "{}"));
    } catch (err) {
      console.warn("Gemini GTM generation failed:", err);
    }
  }
  if (hasAnthropicKey) {
    try {
      const message = await anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 8192,
        system: systemInstruction,
        messages: [{ role: "user", content: userContent }],
      });
      const text = message.content.filter(b => b.type === "text").map((b: any) => b.text).join("\n");
      return JSON.parse(cleanJsonString(text || "{}"));
    } catch (err) {
      console.warn("Anthropic GTM generation failed:", err);
    }
  }
  return null;
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
    if (fromAi) aiSourcedIds.add(f.id);
  }

  const groundedAiOnly = verifyGrounding(merged, schema.filter(f => aiSourcedIds.has(f.id)), sourceTexts);
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

  await guardWrittenFieldsAgainstBoilerplate(grounded, schema, sources, productName, projectId);

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

  const aiRaw = await callAi(systemInstruction, userContent);
  const derived = deriveFieldsFromSources(sources.project, sources.salesKit, sources.tds, sources.activeReport);
  const { field: mergedField, fromAi } = mergeField(schemaField, aiRaw, derived);

  const grounded = fromAi ? verifyGrounding({ [fieldId]: mergedField }, [schemaField], sourceTexts)[fieldId] : mergedField;

  if (schemaField.kind === "written") {
    const guarded = { [fieldId]: grounded };
    await guardWrittenFieldsAgainstBoilerplate(guarded, [schemaField], sources, productName, projectId);
    return guarded[fieldId];
  }

  return grounded;
}

// Mutates `fields` in place: any written field too similar (>0.85 trigram
// Jaccard) to the same field on the most recently generated OTHER project
// gets one regeneration attempt with an explicit "too generic" instruction;
// still too similar after that -> flagged, kept as-is.
async function guardWrittenFieldsAgainstBoilerplate(
  fields: Record<string, GtmFieldAnswer>,
  schema: GtmField[],
  sources: GtmSources,
  productName: string,
  projectId: string
) {
  const writtenFields = schema.filter(f => f.kind === "written");
  if (writtenFields.length === 0) return;

  const otherFields = await getMostRecentOtherDocumentFields(projectId, "gtm");
  if (otherFields.length === 0) return;
  const otherByFieldId = new Map(otherFields.map(f => [f.field_id, f]));

  const facts = [sources.project.motorTech, sources.project.keyDiff, sources.project.pricePoint]
    .filter(Boolean)
    .map(v => String(v));

  for (const f of writtenFields) {
    const current = fields[f.id];
    const other = otherByFieldId.get(f.id);
    if (!current?.answer || !other?.answer) continue;
    if (current.answer.toUpperCase() === "N/A" || other.answer.toUpperCase() === "N/A") continue;

    const similarity = textSimilarity(current.answer, other.answer);
    if (similarity <= BOILERPLATE_SIMILARITY_THRESHOLD) continue;

    const retryInstruction = `${buildSystemInstruction(productName, [f])}\n\nThe previous draft was too generic — it closely matched another product's copy for this field. Rewrite it using these specific facts about ${productName}: ${facts.join("; ") || "(use the specs and description from the sources above)"}.`;
    const retryRaw = await callAi(retryInstruction, buildUserContent(buildSourceTexts(sources)));
    const retryAnswer = retryRaw?.[f.id]?.answer?.trim();

    if (retryAnswer && retryAnswer.toUpperCase() !== "N/A" && textSimilarity(retryAnswer, other.answer) <= BOILERPLATE_SIMILARITY_THRESHOLD) {
      fields[f.id] = { answer: retryAnswer, source: (retryRaw?.[f.id]?.source as GtmFieldSource) || current.source };
    } else {
      fields[f.id] = { ...current, flagged: true, sourceDetail: { ...(current.sourceDetail || {}), reason: "boilerplate", similarTo: other.answer } };
    }
  }
}
