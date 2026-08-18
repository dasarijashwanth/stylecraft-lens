// lib/catalog-import.ts
// Parses an admin-uploaded xlsx/csv spreadsheet of StyleCraft products into
// normalized catalog_products rows — powers the Product Catalog admin
// page's re-import flow (app/api/admin/catalog-products/import). Mirrors
// lib/deck-template-parser.ts's shape: buffer in, plain structured object
// out, no DB access inside either function — the route handler fetches the
// current taxonomy rows once and passes them in, then does the actual
// insert/update against lib/db/catalog-products.ts after the admin confirms
// the diff preview. Never makes a live API call.
import * as XLSX from "xlsx";
import { normalizeMotor } from "./motor-taxonomy";
import { normalizeHeatTech } from "./heat-tech-taxonomy";
import { resolveToolType } from "./tool-type-taxonomy";
import type { MotorFamilyRow } from "./db/motor-families";
import type { BrandedMotorNameRow } from "./db/branded-motor-names";
import type { HeatTechFamilyRow } from "./db/heat-tech-families";
import type { BrandedHeatTechNameRow } from "./db/branded-heat-tech-names";
import type { ToolTypeRow } from "./db/tool-types";
import type { CatalogProductRow } from "./db/catalog-products";
import { normalizeProductName } from "./db/catalog-products";

export type ParsedImportRow = Record<string, any>;

// Reads both .xlsx and .csv through the one SheetJS API — header row
// becomes each row object's keys, in whatever casing/wording the sheet
// actually uses (normalizeImportRow below looks columns up case-
// insensitively against a list of accepted header spellings).
export function parseImportFile(fileBuffer: Buffer): ParsedImportRow[] {
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<ParsedImportRow>(sheet, { defval: null, raw: false });
}

// Whether a row's CURRENT field values (not raw import text) still count
// as "incomplete" — the single source of truth used both here at import
// time and by the admin edit route (app/api/admin/catalog-products/[id]/
// route.ts) to recompute the flag after a manual edit, so a product an
// admin has now fully filled in stops showing "Incomplete" instead of
// permanently carrying whatever this said at import time. Whether a motor/
// heat-tech family is even required is derived from the tool type's own
// primary_criterion (a product whose type genuinely has neither, e.g.
// primary_criterion "none", is never incomplete for lacking one) rather
// than the fragile "was the raw import text literally 'n/a'" heuristic
// that only made sense at parse time and has no equivalent once the row
// only has resolved family keys left, not the original free text.
export function isCatalogRowIncomplete(
  row: { targetPrice: number | null; description: string | null; toolType: string | null; motorFamily: string | null; heatTechFamily: string | null },
  toolTypes: ToolTypeRow[]
): boolean {
  const primaryCriterion = toolTypes.find(t => t.type_key === row.toolType)?.primary_criterion ?? null;
  const needsMotorOrHeatTech = primaryCriterion === "motor" || primaryCriterion === "heat_technology";
  const hasMotorOrHeatTech = !!row.motorFamily || !!row.heatTechFamily;
  return !row.targetPrice || !row.description || (needsMotorOrHeatTech && !hasMotorOrHeatTech);
}

function pick(raw: ParsedImportRow, keys: string[]): string | null {
  const lowerMap = new Map(Object.keys(raw).map(k => [k.trim().toLowerCase(), k]));
  for (const key of keys) {
    const actualKey = lowerMap.get(key);
    if (actualKey === undefined) continue;
    const value = raw[actualKey];
    if (value === null || value === undefined) continue;
    const str = String(value).trim();
    if (str) return str;
  }
  return null;
}

function normalizeIndustry(raw: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (/groom|barber/.test(lower)) return "grooming-barbering";
  if (/hair\s*styl|beauty|haircare/.test(lower)) return "haircare-styling";
  return null;
}

function normalizeTargetMarket(raw: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (/both/.test(lower)) return "both";
  if (/retail|consumer/.test(lower)) return "consumer";
  if (/pro/.test(lower)) return "pro";
  return null;
}

function parsePrice(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

export interface NormalizedCatalogRow {
  name: string;
  industry: string | null;
  targetMarket: string | null;
  toolType: string | null;
  targetPrice: number | null;
  description: string | null;
  motorFamily: string | null;
  motorBranded: string | null;
  heatTechFamily: string | null;
  heatTechBranded: string | null;
  brand: string | null;
  sku: string | null;
  upc: string | null;
  importFlags: string[];
  source: string;
}

export interface CatalogTaxonomyContext {
  motorFamilies: MotorFamilyRow[];
  brandedMotorNames: BrandedMotorNameRow[];
  heatTechFamilies: HeatTechFamilyRow[];
  brandedHeatTechNames: BrandedHeatTechNameRow[];
  toolTypes: ToolTypeRow[];
}

const MOTORLESS_MARKERS = ["n/a", "na", "none", "motorless", "-"];

export function normalizeImportRow(raw: ParsedImportRow, ctx: CatalogTaxonomyContext): NormalizedCatalogRow | null {
  const name = pick(raw, ["name", "product name", "product"]);
  if (!name) return null;

  const flags: string[] = [];

  const industry = normalizeIndustry(pick(raw, ["industry"]));
  const targetMarket = normalizeTargetMarket(pick(raw, ["target market", "market"]));

  const priceText = pick(raw, ["price", "target price"]);
  const targetPrice = parsePrice(priceText);

  const description = pick(raw, ["description", "features & benefits", "features and benefits"]);

  // Tool type — the spreadsheet's own "Tool Type"/"Type" column is tried
  // first (an explicit, human-entered value beats an inferred one), but a
  // blank or unresolvable column no longer gives up immediately: the same
  // resolveToolType() alias-matching already used for a product TITLE
  // elsewhere in this app (lib/analysisEngine.ts, lib/tool-type-taxonomy.ts)
  // is tried next against the product's own Name, then its Description —
  // both real, already-known text, not a guess. Only flagged for manual
  // review when none of the three sources resolve to exactly one type.
  const toolTypeText = pick(raw, ["tool type", "type"]);
  let toolType: string | null = null;
  let toolTypeAmbiguous = false;
  if (toolTypeText) {
    const resolved = resolveToolType(toolTypeText, ctx.toolTypes);
    if (resolved && !resolved.ambiguous) toolType = resolved.type;
    else if (resolved?.ambiguous) toolTypeAmbiguous = true;
    else if (/multistyler/i.test(toolTypeText)) {
      toolType = "dryer";
      flags.push("tool_type_needs_review");
    }
  }
  if (!toolType && !toolTypeAmbiguous) {
    for (const candidateText of [name, description]) {
      if (!candidateText) continue;
      const resolved = resolveToolType(candidateText, ctx.toolTypes);
      if (resolved && !resolved.ambiguous && resolved.type) {
        toolType = resolved.type;
        flags.push("tool_type_inferred_from_product");
        break;
      }
      if (resolved?.ambiguous) toolTypeAmbiguous = true;
    }
  }
  if (!toolType) flags.push("tool_type_needs_review");

  const motorText = pick(raw, ["motor", "motor type", "motor (branded)", "motor (branded to canonical)"]);
  const toolTypeRow = ctx.toolTypes.find(t => t.type_key === toolType);
  const primaryCriterion = toolTypeRow?.primary_criterion ?? null;

  let motorFamily: string | null = null;
  let motorBranded: string | null = null;
  let heatTechFamily: string | null = null;
  let heatTechBranded: string | null = null;

  const motorIsMotorless = !motorText || MOTORLESS_MARKERS.includes(motorText.toLowerCase());

  if (motorText && !motorIsMotorless && primaryCriterion !== "heat_technology") {
    const { family, brandedName } = normalizeMotor(motorText, ctx.motorFamilies, { brand: "StyleCraft", brandedNames: ctx.brandedMotorNames });
    motorFamily = family?.familyKey ?? null;
    motorBranded = brandedName ?? motorText;
    if (!motorFamily) flags.push("motor_needs_confirmation");
  } else if (primaryCriterion === "heat_technology" || motorIsMotorless) {
    const heatText = pick(raw, ["heat technology", "plate technology", "heat tech"]) || description || motorText;
    if (heatText) {
      const { family, brandedName } = normalizeHeatTech(heatText, ctx.heatTechFamilies, { brand: "StyleCraft", brandedNames: ctx.brandedHeatTechNames });
      heatTechFamily = family?.familyKey ?? null;
      heatTechBranded = brandedName ?? (family ? heatText : null);
      if (!heatTechFamily && primaryCriterion === "heat_technology") flags.push("heat_tech_needs_confirmation");
    }
  }

  if (isCatalogRowIncomplete({ targetPrice, description, toolType, motorFamily, heatTechFamily }, ctx.toolTypes)) {
    flags.push("incomplete");
  }

  const brand = pick(raw, ["brand", "brand name", "manufacturer"]);
  const sku = pick(raw, ["sku", "sku #", "sku#", "item number", "item #"]);
  const upc = pick(raw, ["upc", "upc #", "upc#", "gtin"]);

  return {
    name,
    industry,
    targetMarket,
    toolType,
    targetPrice,
    description,
    motorFamily,
    motorBranded,
    heatTechFamily,
    heatTechBranded,
    brand,
    sku,
    upc,
    importFlags: Array.from(new Set(flags)),
    source: "spreadsheet_import",
  };
}

export interface ImportDiffRow {
  row: NormalizedCatalogRow;
  existingId?: string;
  changedFields?: string[];
}

export interface ImportDiffResult {
  new: ImportDiffRow[];
  changed: ImportDiffRow[];
  unchanged: ImportDiffRow[];
  missingFromFile: { id: string; name: string }[];
}

const COMPARABLE_FIELDS: (keyof NormalizedCatalogRow)[] = [
  "industry", "targetMarket", "toolType", "targetPrice", "description",
  "motorFamily", "motorBranded", "heatTechFamily", "heatTechBranded",
  "brand", "sku", "upc",
];

// Pure diff — matches by case/whitespace-insensitive name (normalizeProductName),
// never mutates/writes anything. Exported so it's directly unit-testable
// (scripts/verify-catalog-products.ts) rather than only reachable through
// the API route handler.
export function diffCatalogImport(normalizedRows: NormalizedCatalogRow[], existing: CatalogProductRow[]): ImportDiffResult {
  const existingByName = new Map(existing.map(p => [normalizeProductName(p.name), p]));
  const seenNames = new Set<string>();

  const newRows: ImportDiffRow[] = [];
  const changedRows: ImportDiffRow[] = [];
  const unchangedRows: ImportDiffRow[] = [];

  for (const row of normalizedRows) {
    const key = normalizeProductName(row.name);
    seenNames.add(key);
    const match = existingByName.get(key);
    if (!match) {
      newRows.push({ row });
      continue;
    }
    const changedFields = COMPARABLE_FIELDS.filter(f => {
      const newVal = row[f];
      const oldVal = f === "targetMarket" ? match.target_market
        : f === "toolType" ? match.tool_type
        : f === "targetPrice" ? match.target_price
        : f === "motorFamily" ? match.motor_family
        : f === "motorBranded" ? match.motor_branded
        : f === "heatTechFamily" ? match.heat_tech_family
        : f === "heatTechBranded" ? match.heat_tech_branded
        : (match as any)[f];
      // brand/sku/upc are newer, optional spreadsheet columns most re-import
      // files won't have yet — a genuinely absent column (parsed as null,
      // same as a blank cell, pick() can't tell the two apart) must never
      // register as "changed to null", or every legacy re-import would
      // spuriously flag every single row the moment these columns existed.
      // Only a real, differing incoming value counts as a change.
      if (f === "brand" || f === "sku" || f === "upc") return newVal != null && newVal !== oldVal;
      return (newVal ?? null) !== (oldVal ?? null);
    });
    if (changedFields.length > 0) changedRows.push({ row, existingId: match.id, changedFields });
    else unchangedRows.push({ row, existingId: match.id });
  }

  const missingFromFile = existing.filter(p => !seenNames.has(normalizeProductName(p.name)));

  return {
    new: newRows,
    changed: changedRows,
    unchanged: unchangedRows,
    missingFromFile: missingFromFile.map(p => ({ id: p.id, name: p.name })),
  };
}
