// Generates the Technical Data Sheet from a real product snapshot only —
// snapshot > project record > "Not listed on product page". Unlike GTM,
// TDS has no written/narrative tier and no regenerate route: this module
// backs exactly two callers — the initial capture during project
// creation, and the explicit "re-capture snapshot" action (see
// lib/snapshot-capture.ts and app/api/projects/[id]/snapshot/route.ts).
import { callAiForFields } from "./ai-json-call";
import { TDS_FIELD_SCHEMA, TdsField, TdsFieldAnswer } from "./tds-field-schema";
import { verifyGrounding } from "./gtm-grounding";

export const TDS_NOT_LISTED = "Not listed on product page";

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
  const schema = TDS_FIELD_SCHEMA;
  const snapshotText = JSON.stringify(snapshotRawData || {});
  const recordText = projectRecordText(project);

  const systemInstruction = buildSystemInstruction(productTitle, schema);
  const userContent = buildUserContent(snapshotText, recordText);
  const aiRaw = await callAiForFields(systemInstruction, userContent, "TDS", { projectId });

  const result: Record<string, TdsFieldAnswer> = {};
  for (const f of schema) {
    const got = aiRaw?.[f.id];
    const answer = got?.answer?.trim();
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
  // description/dimensions/weight/box-contents data is never silently
  // wasted just because the AI didn't surface it. Only fills fields the AI
  // left at "none" — never overwrites something it already found.
  const az = snapshotRawData?.amazon;
  if (az) {
    const fillFromAmazon = (id: string, value: string | null | undefined) => {
      if (value && result[id]?.source === "none") {
        result[id] = { answer: value, source: "amazon", sourceDetail: { url: az.amazon_url, retrieved_at: az.last_updated } };
      }
    };
    fillFromAmazon("manufacturer", az.manufacturer);
    fillFromAmazon("model_number", az.model_number);
    fillFromAmazon("product_description", az.description);
    fillFromAmazon("product_lwh", az.dimensions);
    fillFromAmazon("product_weight", az.weight);
    if (Array.isArray(az.whats_in_the_box) && az.whats_in_the_box.length) {
      fillFromAmazon("whats_in_box_list", az.whats_in_the_box.join("; "));
    }
    const voltageSpec = Array.isArray(az.specifications)
      ? az.specifications.find((s: any) => /voltage/i.test(s?.name || ""))?.value
      : null;
    fillFromAmazon("charging_voltage", voltageSpec);
  }

  return verifyGrounding(result, schema, [snapshotText, recordText], TDS_NOT_LISTED);
}
