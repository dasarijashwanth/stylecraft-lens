// lib/gtm-uploaded-tds.ts
// Uploaded TDS Ingestion, Part 3 — folds a project's active uploaded
// source-doc facts (lib/db/extracted-facts.ts) into the GTM fill ladder as
// a top-priority external source. Grounded/spec fields fill VERBATIM;
// narrative fields get a <UPLOADED_TDS> prompt block + a hard grounding
// rule for pre-launch products with no web presence.
import { getMergedFactsForProject, MergedFact } from "./db/extracted-facts";
import { GtmField, GtmFieldAnswer } from "./gtm-field-schema";

export interface UploadedTdsContext {
  factsByFieldId: Record<string, MergedFact>;
  fullTextBlocks: string[];
  docsUsed: { docType: string; id: string; version: number }[];
  hasFacts: boolean;
}

export async function getUploadedTdsContext(projectId: string): Promise<UploadedTdsContext> {
  const merged = await getMergedFactsForProject(projectId);
  return { ...merged, hasFacts: Object.keys(merged.factsByFieldId).length > 0 };
}

// Overrides `fields` with uploaded-TDS facts for grounded fields — mutates
// in place, returns the set of field ids it touched (so the caller can run
// a dedicated grounding check against these specifically, separate from
// the AI-answer grounding check). The ONLY thing that outranks an uploaded
// TDS fact is a literal project-record value (source: "project_record") —
// per the fill ladder's own priority order (user inputs/catalog record >
// uploaded TDS > everything else), this makes "spec fields fill verbatim
// from the uploaded TDS" a real guarantee rather than something that only
// holds when the AI's own prompt happens to behave — the AI is ALSO given
// this same content (buildUploadedTdsPromptBlock below) and told to prefer
// it, so in the common case the two already agree; this override is what
// makes the guarantee unconditional.
export function applyUploadedTdsFacts(
  fields: Record<string, GtmFieldAnswer>,
  schema: GtmField[],
  context: UploadedTdsContext
): Set<string> {
  const uploadedTdsSourcedIds = new Set<string>();
  if (!context.hasFacts) return uploadedTdsSourcedIds;

  for (const f of schema) {
    if (f.kind !== "grounded") continue;
    if (fields[f.id]?.source === "project_record") continue;

    const fact = context.factsByFieldId[f.id];
    if (!fact) continue;

    fields[f.id] = {
      answer: fact.value,
      source: "uploaded_tds",
      sourceDetail: {
        docType: fact.doc_type,
        location: fact.source_location,
        rawText: fact.raw_text,
        confirmedByUser: fact.confirmed_by_user,
      },
    };
    uploadedTdsSourcedIds.add(f.id);
  }
  return uploadedTdsSourcedIds;
}

const MAX_PROMPT_TEXT_CHARS = 20_000;

// The <UPLOADED_TDS> source block fed into buildUserContent — a fact
// summary (quick to scan) plus the actual source text excerpts (so
// narrative fields can be grounded in details beyond the extracted fact
// list, e.g. a care/usage paragraph that isn't itself one discrete spec).
export function buildUploadedTdsPromptBlock(context: UploadedTdsContext): string {
  if (!context.hasFacts) return "(none uploaded for this project)";

  const factLines = Object.values(context.factsByFieldId)
    .map(f => `- ${f.field_id}: ${f.value}${f.source_location ? ` (${f.source_location})` : ""}`)
    .join("\n");
  const textExcerpt = context.fullTextBlocks.join("\n---\n").slice(0, MAX_PROMPT_TEXT_CHARS);

  return `EXTRACTED FACTS:\n${factLines}\n\nSOURCE TEXT EXCERPTS:\n${textExcerpt}`;
}

// Appended to the system instruction only for pre-launch products (no
// productUrl/asin) that actually have uploaded TDS facts — subordinates
// web/market-claim invention to what the TDS + user inputs actually say.
export function buildPreLaunchGroundingRule(hasUploadedTdsFacts: boolean): string {
  if (!hasUploadedTdsFacts) return "";
  return "\n\nThis product is pre-launch/custom with no live web presence to search — every factual claim in every field must trace to the UPLOADED_TDS source block or the project's own inputs above. Do not invent, assume, or generalize from market/web knowledge for THIS product.";
}

// Single combined block for narrative-only call sites (gtm-features-and-tip.ts,
// gtm-product-faqs.ts, gtm-box-only.ts) that don't have gtm-generate.ts's own
// <SOURCE_BLOCK>-per-tag structure to slot into — appended the same way
// voiceBlock already is at each of those call sites. Includes both the fact
// summary and (for pre-launch products) the hard grounding rule in one string.
export function buildTdsGroundingBlock(context: UploadedTdsContext, isPreLaunch: boolean): string {
  if (!context.hasFacts) return "";
  const factLines = Object.values(context.factsByFieldId)
    .map(f => `- ${f.field_id}: ${f.value}`)
    .join("\n");
  const rule = isPreLaunch
    ? "\nThis product is pre-launch/custom with no live web presence — every factual claim must trace to these UPLOADED TDS facts or the project's own inputs. Do not invent or assume market/web facts for THIS product."
    : "";
  return `\n\nUPLOADED TDS FACTS (from the team's own uploaded source document — treat as ground truth):\n${factLines}${rule}`;
}
