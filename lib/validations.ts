// lib/validations.ts
import { z } from "zod";

// Strict tool-type isolation (lib/tool-type-taxonomy.ts) — required on
// every form that seeds an analysis, so a trimmer analysis can never pull
// in clipper data (or vice versa). Tool Type is now DB-backed and user-
// editable (lib/db/tool-types.ts's tool_types table) rather than a fixed
// set, so this can no longer be a zod enum of literal values — real
// membership/strictness checking happens server-side against the live
// tool_types table when the analysis pipeline actually runs
// (assertToolType), not at this schema boundary.
const ToolTypeValue = z.string().min(1, "Select the exact tool type");

// The 7 canonical motor families, fixed by design (unlike Tool Type, this
// list is NOT user-extensible) — every motor-entry point (form, extraction,
// matching, display, GTM/TDS) normalizes to exactly one of these. Kept as a
// literal tuple (zod needs literal values at schema-definition time); must
// stay in sync with the 7 enabled rows seeded by supabase_schema.sql's
// Section 25 migration / lib/memoryDb.ts's seedMotorFamilyDefaults.
export const MOTOR_FAMILY_VALUES = [
  "magnetic", "pivot", "rotary", "brushless", "vector", "ac_motor", "dc_motor",
] as const;

// The parallel fixed set for the Heat/Plate Technology criterion (motorless
// styling tools — flat iron/curling iron/hot brush, see lib/db/tool-types.ts's
// primary_criterion column). Must stay in sync with the 4 enabled rows
// seeded by supabase_schema.sql's Section 31 migration /
// lib/memoryDb.ts's seedHeatTechFamilyDefaults, same convention as
// MOTOR_FAMILY_VALUES above.
export const HEAT_TECH_FAMILY_VALUES = [
  "titanium", "ceramic", "tourmaline", "ionic",
] as const;

// Normalizes and validates any URL input
export function normalizeUrl(input: string): string | null {
  if (!input || input.trim() === "") return null;

  let url = input.trim();

  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes(".")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export const AddCompetitorSchema = z.object({
  name:        z.string().min(2, "Name must be at least 2 characters").max(100),
  website:     z.string().optional(),
  description: z.string().max(500).optional(),
  status:      z.enum(["ACTIVE", "MONITORING", "ARCHIVED"]),
  tags:        z.array(z.string().max(30)).max(10),
  main_products: z.string().max(200).optional(),
});

// Target Price is required (not just optional free text) — every field on
// the analyze/new-project forms is meant to genuinely shape discovery, and
// price is a hard input to the price-band/composite-scoring math
// (lib/price-band.ts, lib/competitor-scoring.ts), so an unset price can't
// be allowed to silently fall through as "no preference."
const RequiredPricePoint = z.string()
  .min(1, "Target price is required")
  .max(20)
  .refine(val => /^\$?\d+(\.\d{1,2})?$/.test(val), "Price must be a number like 99.95 or $99.95")
  .refine(val => parseFloat(val.replace(/[^0-9.]/g, "")) > 0, "Target price must be greater than $0");

export const ProjectSchema = z.object({
  name:            z.string().min(2).max(100),
  industry:        z.enum(["grooming-barbering", "haircare-styling"]),
  targetMarket:    z.enum(["pro", "consumer", "both"]),
  productName:     z.string().min(3).max(100),
  description:     z.string().min(10).max(2000),
  category:        z.string().max(100).optional(),
  toolType:        ToolTypeValue,
  companyContext:  z.string().max(1000).optional(),
  motorFamily:     z.enum(MOTOR_FAMILY_VALUES).optional(),
  motorBrandedName: z.string().max(150).optional(),
  // Legacy free-text fallback — no longer written by the form, kept
  // optional so old projects/analyses persisted before the canonical
  // motorFamily select existed keep reading back correctly.
  motorTech:       z.string().max(100).optional(),
  keyDiff:         z.string().max(200).optional(),
  pricePoint:      RequiredPricePoint,
});

export const AnalysisFormSchema = z.object({
  industry: z.string().min(1, "Select an industry"),
  targetMarket: z.enum(["pro", "consumer", "both"]),
  productName: z.string().min(3, "Product name must be at least 3 characters").max(100),
  description: z.string().min(10, "Add at least 10 characters for sharper results").max(2000),
  category: z.string().optional(),
  toolType: ToolTypeValue,
  companyContext: z.string().max(1000).optional(),
  motorFamily: z.enum(MOTOR_FAMILY_VALUES).optional(),
  motorBrandedName: z.string().max(150).optional(),
  motorTech: z.string().optional(),
  // The parallel Heat/Plate Technology fields — populated instead of
  // motorFamily/motorBrandedName/motorTech when the selected tool type's
  // primary_criterion is 'heat_technology' (see lib/analysisEngine.ts's
  // resolvePrimaryCriterion). heatTechRaw mirrors motorTech's role: a
  // legacy free-text fallback, never written by the form going forward.
  heatTechFamily: z.enum(HEAT_TECH_FAMILY_VALUES).optional(),
  heatTechBrandedName: z.string().max(150).optional(),
  heatTechRaw: z.string().optional(),
  keyDiff: z.string().max(200).optional(),
  pricePoint: RequiredPricePoint,
  // Set when the analyze form's catalog picker was used to select a real
  // catalog_products row — see lib/our-product-position.ts's
  // resolveOurLineupTier, which checks this before falling back to fuzzy
  // name matching. Absent for manual/custom entries.
  catalogProductId: z.string().uuid().optional(),
  // Optional "Adjust weights for this analysis" override (lib/db/scoring-
  // profiles.ts) — free-form relative-importance numbers, no sum-to-1
  // constraint (see lib/competitor-scoring.ts's computeCompositeScore for
  // where normalization actually happens). When omitted, the pipeline
  // resolves the selected tool type's own scoring profile instead.
  weightOverride: z.object({
    motor: z.number().min(0),
    price: z.number().min(0),
    feature: z.number().min(0),
  }).refine(w => w.motor + w.price + w.feature > 0, "At least one criterion must be > 0").optional(),
  // Up to 3 user-pasted "nearby similar products" (Related Products field,
  // next to Positioning Context) — raw input only (asin/url/addedAt), rides
  // in analyses.context like every other field here. The enriched
  // Rainforest+motor-extraction result lives in its own analyses.
  // related_products column (supabase_schema.sql Section 51), resolved by
  // lib/analysisEngine.ts's resolveRelatedProducts during Phase 0.
  relatedAsins: z.array(z.object({
    asin: z.string().regex(/^[A-Z0-9]{10}$/i, "ASIN must be exactly 10 letters/digits"),
    url: z.string().url().optional(),
    addedAt: z.string(),
  })).max(3, "Up to 3 related products").optional(),
});

// Same ASIN format check as ProjectSchema/NewProjectSchema's own asin
// field (lib/product-cache-key.ts's ^[A-Z0-9]{10}$ convention) — not the
// stricter "B0..." Amazon-specific prefix, since this codebase already
// accepts any 10-char alphanumeric ASIN elsewhere.
const AsinValue = z.string().regex(/^[A-Z0-9]{10}$/i, "ASIN must be exactly 10 letters/digits");

export const CorrectionReasonValues = ["wrong_product", "wrong_model", "wrong_motor", "better_competitor", "discontinued", "wrong_industry", "not_comparable", "other"] as const;

export const CompetitorPreviewSchema = z.object({
  asinOrUrl: z.string().min(1, "Enter an ASIN or Amazon product URL"),
});

export const CompetitorReplaceSchema = z.object({
  oldAsin: AsinValue,
  asinOrUrl: z.string().min(1, "Enter an ASIN or Amazon product URL"),
  reason: z.enum(CorrectionReasonValues),
  note: z.string().max(500).optional(),
});

// Remove + Refill single slot (see lib/analysisEngine.ts's removeCompetitorSlot/
// refillCompetitorSlot) — a distinct, smaller reason set than
// CorrectionReasonValues above (no "wrong_model"/"better_competitor" — those
// only make sense when a replacement ASIN is already known, which Remove
// deliberately doesn't require up front).
export const CompetitorRemoveReasonValues = ["wrong_industry", "wrong_product", "wrong_motor", "not_comparable", "other"] as const;

export const CompetitorRemoveSchema = z.object({
  asin: AsinValue,
  reason: z.enum(CompetitorRemoveReasonValues),
  note: z.string().max(500).optional(),
});

export const CompetitorRefillSlotSchema = z.object({
  removedAsin: AsinValue,
});

export const CompetitorBulkRefillSchema = z.object({
  items: z.array(z.object({
    asin: AsinValue,
    reason: z.enum(CompetitorRemoveReasonValues),
    note: z.string().max(500).optional(),
  })).max(10),
});

// Related Products preview (analyze form, no analysisId yet — the analysis
// doesn't exist until submit) — unlike CompetitorPreviewSchema's analysis-
// scoped sibling, this needs the form's own toolType passed explicitly so
// the server can still compute a tool-type-mismatch warning.
export const RelatedProductPreviewSchema = z.object({
  asinOrUrl: z.string().min(1, "Enter an ASIN or Amazon product URL"),
  requiredToolType: ToolTypeValue.optional(),
});

// Related Products "fixing a mispaste re-fetches in place" swap — no
// CorrectionReason (a mispaste fix isn't a discovery-learning signal, see
// lib/db/competitor-corrections.ts) and no tool-type-mismatch block (the
// existing CompetitorReplaceSchema flow blocks discovered-competitor swaps
// on a hard duplicate only; a related-product mismatch is expected/common
// per the feature's own Part 2.3, never a hard error here).
export const RelatedProductReplaceSchema = z.object({
  oldAsin: AsinValue,
  asinOrUrl: z.string().min(1, "Enter an ASIN or Amazon product URL"),
});

export const NewProjectSchema = z.object({
  name: z.string().min(2, "Project name must be at least 2 characters").max(100),
  industry: z.string().min(1, "Select an industry"),
  targetMarket: z.enum(["pro", "consumer", "both"]),
  productName: z.string().min(3, "Product name must be at least 3 characters").max(100),
  description: z.string().min(10, "Add at least 10 characters for sharper results").max(2000),
  category: z.string().optional(),
  toolType: ToolTypeValue,
  companyContext: z.string().max(1000).optional(),
  motorFamily: z.enum(MOTOR_FAMILY_VALUES).optional(),
  motorBrandedName: z.string().max(150).optional(),
  motorTech: z.string().optional(),
  keyDiff: z.string().max(200).optional(),
  pricePoint: RequiredPricePoint,
  // The product-anchor identity — optional, but when provided drives the
  // real-time TDS snapshot + auto-fill pipeline (see lib/snapshot-capture.ts).
  productUrl: z.string().max(500).optional().refine(v => !v || normalizeUrl(v) !== null, "Enter a valid product URL"),
  asin: z.string().max(20).optional().refine(v => !v || /^[A-Z0-9]{10}$/i.test(v), "ASIN must be exactly 10 letters/digits"),
});
