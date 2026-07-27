// lib/motor-extraction.ts
// Resolves motor type for BOTH sides of a competitor comparison — the
// candidate competitor (from already-fetched Rainforest data, zero new
// network calls) and our own input product (from the linked project's GTM
// data, the analyze form's motorTech field, or the Identity Card's own
// text) — grounded to a real source quote whenever possible, never
// fabricated from brand reputation.
import type { RainforestSpec } from "./rainforest";
import type { MotorFamilyRow } from "./db/motor-families";
import { matchMotorFamily, MatchedMotor } from "./motor-taxonomy";
import type { IdentityCard } from "./product-identification";
import { isRealAnswer } from "./field-answer-state";

export interface CompetitorMotorExtraction extends MatchedMotor {
  sourceQuote: string;
}

const MOTOR_SPEC_LABELS = ["motor type", "motor technology", "motor"];

// Reuses whatever Rainforest data enrichCompetitorsWithRainforest already
// fetched (specifications/attributes/feature_bullets/description) — no
// dedicated per-competitor page-fetch needed, per the plan's Context
// section (a real cost this feature deliberately avoids).
export function extractCompetitorMotorType(
  product: { specifications?: RainforestSpec[]; attributes?: RainforestSpec[]; feature_bullets?: string[]; description?: string | null },
  families: MotorFamilyRow[]
): CompetitorMotorExtraction | null {
  const specAndAttr = [...(product.specifications || []), ...(product.attributes || [])];

  // Prefer an explicit "Motor Type"/"Motor" spec row — highest-confidence
  // source, and its own {name, value} pair doubles as a precise quote.
  for (const spec of specAndAttr) {
    const nameLower = (spec.name || "").toLowerCase();
    if (MOTOR_SPEC_LABELS.some(label => nameLower.includes(label))) {
      const matched = matchMotorFamily(spec.value, families);
      if (matched) return { ...matched, sourceQuote: `${spec.name}: ${spec.value}` };
    }
  }

  // Fall back to feature bullets — verbatim Amazon listing text.
  for (const bullet of product.feature_bullets || []) {
    const matched = matchMotorFamily(bullet, families);
    if (matched) return { ...matched, sourceQuote: bullet };
  }

  // Last resort: the listing description — quote the specific matching
  // sentence, not the whole block.
  if (product.description) {
    const sentences = product.description.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      const matched = matchMotorFamily(sentence, families);
      if (matched) return { ...matched, sourceQuote: sentence.trim() };
    }
  }

  return null;
}

export type OurMotorSource = "project_gtm" | "motor_tech_field" | "identity_text";

export interface OurMotorResolution extends MatchedMotor {
  source: OurMotorSource;
}

// Priority order (per the plan): (1) the linked project's GTM motor_type
// field — a real, grounded answer if the pipeline already generated one;
// (2) the analyze form's existing "Motor technology" select
// (context.motorTech) — a different, coarser vocabulary than this
// taxonomy, so treated as a soft hint, not authoritative; (3) the Identity
// Card's own text (whatItIs/keyAttributes/evidence quotes). Returns null
// when none of these resolve — the caller pauses-and-asks, but only when
// isMotorizedCategory() says this product's category needs a motor type
// at all.
export async function resolveOurMotorType(
  input: { motorTech?: string; projectId: string | null },
  identity: Pick<IdentityCard, "whatItIs" | "keyAttributes" | "evidence">,
  families: MotorFamilyRow[]
): Promise<OurMotorResolution | null> {
  if (input.projectId) {
    try {
      const { getDocumentByProject, getDocumentFields } = await import("./db/documents");
      const doc = await getDocumentByProject(input.projectId, "gtm");
      if (doc) {
        const fields = await getDocumentFields(doc.id);
        const motorField = fields.find(f => f.field_id === "motor_type");
        if (motorField && isRealAnswer(motorField.answer)) {
          const matched = matchMotorFamily(motorField.answer as string, families);
          if (matched) return { ...matched, source: "project_gtm" };
        }
      }
    } catch {
      // Best-effort only — a missing/broken GTM doc must never block discovery.
    }
  }

  if (input.motorTech) {
    const matched = matchMotorFamily(input.motorTech, families);
    if (matched) return { ...matched, source: "motor_tech_field" };
  }

  const identityText = [identity.whatItIs, ...(identity.keyAttributes || []), ...(identity.evidence || []).map(e => e.quote)]
    .filter(Boolean)
    .join(" ");
  const matched = matchMotorFamily(identityText, families);
  if (matched) return { ...matched, source: "identity_text" };

  return null;
}
