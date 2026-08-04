// lib/tds-doc-facts.ts
// Uploaded TDS Ingestion, Part 1 — format-agnostic structured fact
// extraction. Runs on whatever `fullText`/`locations` lib/tds-doc-extract.ts
// produced, regardless of source format (PDF/XLSX/DOCX). Targets
// lib/tds-field-schema.ts's own field vocabulary directly — TDS's spec
// field ids are already identical to GTM_FIELD_SCHEMA's, so extracted
// facts slot straight into the existing fill ladder with no translation.
import { callAiForJson } from "./ai-json-call";
import { TDS_FIELD_SCHEMA } from "./tds-field-schema";
import { ExtractedDocContent, ExtractedLocation } from "./tds-doc-extract";

export interface ExtractedFactCandidate {
  field_id: string;
  value: string;
  raw_text: string;
  source_location?: string;
}

// A document's real text can run long — capped to keep the extraction call
// well within a single request's time/token budget. TDS documents are
// typically a handful of pages; a doc past this cap may miss facts beyond
// it, an accepted MVP scope limit rather than building full chunking here.
const MAX_EXTRACTION_TEXT_CHARS = 40_000;

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// Same case/whitespace-insensitive substring discipline as
// lib/gtm-grounding.ts's verifyGrounding — a candidate whose quote doesn't
// actually appear in the source text (AI hallucination) is dropped here,
// before it's ever persisted, rather than trusting the model's own claim.
function quoteAppearsInText(rawText: string, fullText: string): boolean {
  const needle = normalize(rawText);
  if (needle.length < 2) return false;
  return normalize(fullText).includes(needle);
}

function findLocationForRawText(locations: ExtractedLocation[], rawText: string): string | undefined {
  const needle = normalize(rawText);
  const hit = locations.find(l => normalize(l.text).includes(needle));
  return hit?.label;
}

export async function extractStructuredFacts(
  content: ExtractedDocContent,
  productName: string
): Promise<ExtractedFactCandidate[]> {
  if (!content.fullText.trim()) return [];

  // Internal-kind fields are genuine human decisions (approved pricing,
  // packaging sign-off) — never AI/document-extractable, so they're never
  // asked for here, same exclusion the rest of GTM generation already applies.
  const targetFields = TDS_FIELD_SCHEMA.filter(f => f.kind !== "internal");
  const fieldList = targetFields.map(f => `- ${f.id}: ${f.question}`).join("\n");
  const validFieldIds = new Set(targetFields.map(f => f.id));

  const systemInstruction = `You extract technical spec facts from a product's Technical Data Sheet (TDS) document for "${productName}". Given the document text below, extract ONLY values for the fields listed that are LITERALLY present in the text — never infer, guess, or use general knowledge about similar products. For the motor_type field specifically, format the value as "{Canonical Family} ({Branded Name})" when both are determinable (e.g. "Brushless Motor (EON Digital Brushless Motor)"), or just whichever of the two is present.

FIELDS TO EXTRACT (id: label):
${fieldList}

For each fact found, include a "raw_text" value — a short VERBATIM quote (a few words to one sentence) copied EXACTLY from the document text below that proves this value. A fact whose raw_text isn't an exact quote from the document will be discarded, so never paraphrase it.

DOCUMENT TEXT:
"""
${content.fullText.slice(0, MAX_EXTRACTION_TEXT_CHARS)}
"""

Return ONLY valid JSON: { "facts": [{ "field_id": "...", "value": "...", "raw_text": "..." }] } — omit any field not literally found, never guess a value.`;

  const raw = await callAiForJson<{ facts?: ExtractedFactCandidate[] }>(
    systemInstruction,
    `Product: ${productName}`,
    "TDS-Doc-Fact-Extraction",
    { timeoutMs: 30_000 }
  );

  const candidates = (raw?.facts || []).filter(
    f => f && typeof f.field_id === "string" && typeof f.value === "string" && typeof f.raw_text === "string" && f.value.trim() && f.raw_text.trim()
  );

  return candidates
    .filter(f => validFieldIds.has(f.field_id) && quoteAppearsInText(f.raw_text, content.fullText))
    .map(f => ({
      field_id: f.field_id,
      value: f.value.trim(),
      raw_text: f.raw_text.trim(),
      source_location: findLocationForRawText(content.locations, f.raw_text),
    }));
}
