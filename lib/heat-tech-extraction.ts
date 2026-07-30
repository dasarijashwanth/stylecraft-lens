// lib/heat-tech-extraction.ts
// Resolves Heat/Plate Technology for BOTH sides of a competitor comparison
// — a full parallel to lib/motor-extraction.ts for motorless styling tools
// (flat iron/curling iron/hot brush — see lib/db/tool-types.ts's
// primary_criterion column). Same cascade shape, same priority order,
// minus the motor-specific miss-auto-classification admin panel (not
// requested for this criterion).
import type { RainforestSpec } from "./rainforest";
import type { HeatTechFamilyRow } from "./db/heat-tech-families";
import type { BrandedHeatTechNameRow } from "./db/branded-heat-tech-names";
import { matchHeatTechFamily, normalizeHeatTech, MatchedHeatTech } from "./heat-tech-taxonomy";
import type { IdentityCard } from "./product-identification";
import { isRealAnswer } from "./field-answer-state";

export type HeatTechConfirmedVia = "branded_map" | "spec_table" | "title" | "bullets" | "description";

export interface CompetitorHeatTechExtraction extends MatchedHeatTech {
  sourceQuote: string;
  confirmedVia: HeatTechConfirmedVia;
  brandedName: string | null;
}

const HEAT_TECH_SPEC_LABELS = ["plate material", "heat technology", "plate", "heater type"];

// Reuses whatever Rainforest data enrichCompetitorsWithRainforest already
// fetched (specifications/attributes/feature_bullets/description/title) —
// mirrors lib/motor-extraction.ts's extractCompetitorMotorType exactly.
export function extractCompetitorHeatTech(
  product: { specifications?: RainforestSpec[]; attributes?: RainforestSpec[]; feature_bullets?: string[]; description?: string | null; title?: string | null },
  families: HeatTechFamilyRow[],
  opts?: { brand?: string | null; brandedNames?: BrandedHeatTechNameRow[] }
): CompetitorHeatTechExtraction | null {
  const specAndAttr = [...(product.specifications || []), ...(product.attributes || [])];

  if (opts?.brand && opts.brandedNames?.length) {
    const brandedTexts = [product.title, ...(product.feature_bullets || []), product.description].filter((t): t is string => !!t);
    for (const text of brandedTexts) {
      const normalized = normalizeHeatTech(text, families, { brand: opts.brand, brandedNames: opts.brandedNames });
      if (normalized.family) return { ...normalized.family, brandedName: normalized.brandedName, sourceQuote: text, confirmedVia: "branded_map" };
    }
  }

  // Prefer an explicit "Plate Material"/"Heat Technology" spec row —
  // highest-confidence generic source, and its own {name, value} pair
  // doubles as a precise quote.
  for (const spec of specAndAttr) {
    const nameLower = (spec.name || "").toLowerCase();
    if (HEAT_TECH_SPEC_LABELS.some(label => nameLower.includes(label))) {
      const normalized = normalizeHeatTech(spec.value, families);
      if (normalized.family) return { ...normalized.family, brandedName: normalized.brandedName, sourceQuote: `${spec.name}: ${spec.value}`, confirmedVia: "spec_table" };
    }
  }

  // Title next.
  if (product.title) {
    const normalized = normalizeHeatTech(product.title, families);
    if (normalized.family) return { ...normalized.family, brandedName: normalized.brandedName, sourceQuote: product.title, confirmedVia: "title" };
  }

  // Fall back to feature bullets — verbatim Amazon listing text.
  for (const bullet of product.feature_bullets || []) {
    const normalized = normalizeHeatTech(bullet, families);
    if (normalized.family) return { ...normalized.family, brandedName: normalized.brandedName, sourceQuote: bullet, confirmedVia: "bullets" };
  }

  // Last resort: the listing description — quote the specific matching
  // sentence, not the whole block.
  if (product.description) {
    const sentences = product.description.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      const normalized = normalizeHeatTech(sentence, families);
      if (normalized.family) return { ...normalized.family, brandedName: normalized.brandedName, sourceQuote: sentence.trim(), confirmedVia: "description" };
    }
  }

  return null;
}

export type OurHeatTechSource = "heat_tech_family_field" | "project_gtm" | "heat_tech_raw_field" | "identity_text";

export interface OurHeatTechResolution extends MatchedHeatTech {
  source: OurHeatTechSource;
}

// Priority order (mirrors lib/motor-extraction.ts's resolveOurMotorType
// exactly): (1) an explicit canonical family selected directly on THIS
// analysis's own form (context.heatTechFamily, the Heat/Plate Technology
// select); (2) the linked project's GTM plate_material field; (3) the
// legacy free-text field (context.heatTechRaw, kept only for analyses
// created before the canonical select existed) — fuzzy-matched; (4) the
// Identity Card's own text. Returns null when none of these resolve — the
// caller pauses-and-asks, but only when this product's tool type's
// primary_criterion is 'heat_technology'.
export async function resolveOurHeatTech(
  input: { heatTechFamily?: string; heatTechRaw?: string; projectId: string | null },
  identity: Pick<IdentityCard, "whatItIs" | "keyAttributes" | "evidence">,
  families: HeatTechFamilyRow[]
): Promise<OurHeatTechResolution | null> {
  if (input.heatTechFamily) {
    const family = families.find(f => f.enabled && f.family_key === input.heatTechFamily);
    if (family) {
      return { familyKey: family.family_key, label: family.label, source: "heat_tech_family_field" };
    }
  }

  if (input.projectId) {
    try {
      const { getDocumentByProject, getDocumentFields } = await import("./db/documents");
      const doc = await getDocumentByProject(input.projectId, "gtm");
      if (doc) {
        const fields = await getDocumentFields(doc.id);
        const field = fields.find(f => f.field_id === "plate_material");
        if (field && isRealAnswer(field.answer)) {
          const matched = matchHeatTechFamily(field.answer as string, families);
          if (matched) return { ...matched, source: "project_gtm" };
        }
      }
    } catch {
      // Best-effort only — a missing/broken GTM doc must never block discovery.
    }
  }

  if (input.heatTechRaw) {
    const matched = matchHeatTechFamily(input.heatTechRaw, families);
    if (matched) return { ...matched, source: "heat_tech_raw_field" };
  }

  const identityText = [identity.whatItIs, ...(identity.keyAttributes || []), ...(identity.evidence || []).map(e => e.quote)]
    .filter(Boolean)
    .join(" ");
  const matched = matchHeatTechFamily(identityText, families);
  if (matched) return { ...matched, source: "identity_text" };

  return null;
}
