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
  keyDiff: z.string().max(200).optional(),
  pricePoint: RequiredPricePoint,
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
