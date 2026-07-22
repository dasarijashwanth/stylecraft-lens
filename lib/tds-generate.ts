// Generates the Technical Data Sheet from a real product snapshot first,
// then the project record, then a real web search, then an honest
// "Not determinable"/"Awaiting internal input" terminal state — never a
// bare placeholder. Unlike GTM, TDS has no written/narrative tier and no
// regenerate route: this module backs exactly two callers — the initial
// capture during project creation, and the explicit "re-capture snapshot"
// action (see lib/snapshot-capture.ts and
// app/api/projects/[id]/snapshot/route.ts).
import { callAiForFields, coerceAiAnswer } from "./ai-json-call";
import { TDS_FIELD_SCHEMA, TdsField, TdsFieldAnswer } from "./tds-field-schema";
import { verifyGrounding } from "./gtm-grounding";
import { deriveTdsFieldsFromAmazon } from "./tds-derive";
import { applyWebSearchFallback } from "./web-search-fallback";
import { finalizeFieldAnswers } from "./field-finalize";
import { TDS_NOT_LISTED } from "./field-answer-state";

// Re-exported for backward compatibility — canonical definition moved to
// lib/field-answer-state.ts so it can be shared without a circular import.
export { TDS_NOT_LISTED };

// Vercel Hobby's function timeout is a fixed 60s — same discipline as
// lib/gtm-generate.ts's PIPELINE_TIME_BUDGET_MS. TDS's main call + floor-fill
// are fast (no web search involved in either), so this mostly governs how
// much room the new web-search fallback tier below is allowed to use.
const TDS_PIPELINE_TIME_BUDGET_MS = 35_000;

export interface TdsProjectRecord {
  productName: string;
  description?: string | null;
  category?: string | null;
  motorTech?: string | null;
  keyDiff?: string | null;
  pricePoint?: string | null;
  companyContext?: string | null;
}

function buildSystemInstruction(productTitle: string, schema: TdsField[]) {
  const fieldList = schema.map(f => `- ${f.id} [${f.section}]: ${f.question}`).join("\n");
  return `You are filling a Technical Data Sheet (TDS) for ONE specific product: ${productTitle}.

Rules:
- Answer using ONLY the scraped product page data and Amazon listing data provided below, plus the project record.
- For manufacturer/model/mpn/brand fields, also check inside any schema.org JSON-LD structured data in the scraped site snapshot (look for "manufacturer", "model", "mpn", "sku" keys) — sites often only expose these there, not in visible page text.
- Copy spec values EXACTLY as written in the source, including units (e.g. "7,500 RPM", "3.6V", "50cm | 19.68 in").
- NEVER estimate, infer, round, or reuse a value from a different/similar product.
- If a value is not present anywhere in the provided data, return exactly "${TDS_NOT_LISTED}".
- Return ONLY valid JSON, no markdown, no explanation, keyed by field id:
{ "<field_id>": { "answer": "...", "source": "product_snapshot" | "project_record" | "none" } }

FIELD SCHEMA (id [section]: question):
${fieldList}

Every field id listed above must appear in your response.`;
}

function buildUserContent(snapshotText: string, projectRecordText: string) {
  return `<PRODUCT_SNAPSHOT>
${snapshotText}
</PRODUCT_SNAPSHOT>

<PROJECT_RECORD>
${projectRecordText}
</PROJECT_RECORD>`;
}

function projectRecordText(project: TdsProjectRecord): string {
  return JSON.stringify({
    productName: project.productName,
    description: project.description,
    category: project.category,
    motorTech: project.motorTech,
    keyDiff: project.keyDiff,
    pricePoint: project.pricePoint,
    companyContext: project.companyContext,
  });
}

export async function generateTdsFields(
  productTitle: string,
  snapshotRawData: any | null,
  project: TdsProjectRecord,
  projectId?: string
): Promise<Record<string, TdsFieldAnswer>> {
  const pipelineStart = Date.now();
  const schema = TDS_FIELD_SCHEMA;
  const snapshotText = JSON.stringify(snapshotRawData || {});
  const recordText = projectRecordText(project);

  // "internal"-kind fields (approved_pricing, dieline, etc. — see
  // lib/gtm-field-schema.ts's INTERNAL_FIELD_IDS, inherited onto
  // TDS_FIELD_SCHEMA) are genuine human decisions never present in a
  // scraped page or Amazon listing — never asked of the AI at all.
  const aiEligibleSchema = schema.filter(f => f.kind !== "internal");
  const systemInstruction = buildSystemInstruction(productTitle, aiEligibleSchema);
  const userContent = buildUserContent(snapshotText, recordText);
  const aiRaw = await callAiForFields(systemInstruction, userContent, "TDS", { projectId });

  const result: Record<string, TdsFieldAnswer> = {};
  for (const f of schema) {
    const got = aiRaw?.[f.id];
    const answer = coerceAiAnswer(got?.answer);
    const usable = !!answer && answer.toUpperCase() !== "N/A" && answer !== TDS_NOT_LISTED;
    result[f.id] = usable
      ? { answer: answer!, source: (got?.source === "project_record" ? "project_record" : "amazon") }
      : { answer: TDS_NOT_LISTED, source: "none" };
  }

  // A few fields the project record itself directly answers (team-entered,
  // outranks whatever the AI extracted) — same priority GTM's own
  // derivation gives project.motorTech/pricePoint.
  if (project.motorTech && result.motor_type?.source === "none") {
    result.motor_type = { answer: project.motorTech, source: "project_record" };
  }
  if (project.pricePoint && result.approved_pricing?.source === "none") {
    result.approved_pricing = { answer: project.pricePoint, source: "project_record" };
  }
  if (project.productName && result.product_title?.source === "none") {
    result.product_title = { answer: project.productName, source: "project_record" };
  }

  // Deterministic floor from the widened Rainforest product payload
  // (lib/rainforest.ts) — a real, credit-costing Rainforest fetch already
  // ran to capture this snapshot; make sure its manufacturer/model/
  // description/dimensions/weight/box-contents/country-of-origin/material/
  // safety-notes data is never silently wasted just because the AI didn't
  // surface it. Only fills fields the AI left at "none" — never overwrites
  // something it already found (see lib/tds-derive.ts).
  deriveTdsFieldsFromAmazon(result, snapshotRawData?.amazon);

  const grounded = verifyGrounding(result, schema, [snapshotText, recordText], TDS_NOT_LISTED);

  // Tier 5 — real web search for whatever's still unanswered after the
  // snapshot+project-record floor above (TDS's own AI call above has no
  // web search capability at all). The shared fallback's eligibility check
  // (lib/field-answer-state.ts's isRealAnswer) already treats
  // TDS_NOT_LISTED as "no value" — no separate TDS-specific check needed.
  await applyWebSearchFallback(grounded, aiEligibleSchema, productTitle, pipelineStart, TDS_PIPELINE_TIME_BUDGET_MS);

  // Terminal step — converts anything still unresolved into an honest
  // "Not determinable — {reason}" ("Awaiting internal input" for
  // internal-kind fields) instead of TDS_NOT_LISTED surviving to the UI/CSV
  // as an unexplained placeholder.
  return finalizeFieldAnswers(grounded, schema, "not found on the product page, Amazon listing, or project record");
}
