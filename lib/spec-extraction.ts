// lib/spec-extraction.ts
// Extracts the comparable spec/feature signals lib/competitor-scoring.ts's
// computeFeatureScore needs — blade tech, RPM, run time, cordless/corded,
// build material — for BOTH our own product (from its real TDS fields,
// same "grounded, never invented" discipline as everything else in this
// pipeline) and a competitor (from the Rainforest product data already
// fetched by enrichCompetitorsWithRainforest, zero new network calls,
// mirroring lib/motor-extraction.ts's exact reuse strategy).
import type { RainforestSpec } from "./rainforest";
import type { FeatureComparable } from "./competitor-scoring";
import { isRealAnswer } from "./field-answer-state";

const RPM_LABELS = ["rpm", "speed"];
const RUNTIME_LABELS = ["run time", "runtime", "battery life"];
const CORDLESS_KEYWORDS = ["cordless", "wireless", "battery-powered", "battery powered"];
const CORDED_KEYWORDS = ["corded", "plug-in", "plug in", "wired"];
const BLADE_KEYWORDS = ["stainless steel", "ceramic", "titanium", "carbon steel", "self-sharpening"];

function findSpecValue(specAndAttr: RainforestSpec[], labels: string[]): string | null {
  for (const spec of specAndAttr) {
    const nameLower = (spec.name || "").toLowerCase();
    if (labels.some(l => nameLower.includes(l))) return spec.value;
  }
  return null;
}

function parseNumber(s: string | null): number | null {
  if (!s) return null;
  const match = s.replace(/,/g, "").match(/[\d.]+/);
  return match ? parseFloat(match[0]) : null;
}

function parseRuntimeMinutes(raw: string | null): number | null {
  if (!raw) return null;
  const hourMatch = raw.match(/([\d.]+)\s*h(?:our|r)?/i);
  if (hourMatch) return parseFloat(hourMatch[1]) * 60;
  const minMatch = raw.match(/([\d.]+)\s*min/i);
  if (minMatch) return parseFloat(minMatch[1]);
  return parseNumber(raw);
}

function detectCordless(texts: string[]): boolean | null {
  const joined = texts.join(" ").toLowerCase();
  if (CORDLESS_KEYWORDS.some(k => joined.includes(k))) return true;
  if (CORDED_KEYWORDS.some(k => joined.includes(k))) return false;
  return null;
}

function findBladeMention(texts: string[]): string | null {
  const joined = texts.join(" ").toLowerCase();
  return BLADE_KEYWORDS.find(k => joined.includes(k)) || null;
}

export function extractCompetitorSpecs(product: {
  specifications?: RainforestSpec[];
  attributes?: RainforestSpec[];
  feature_bullets?: string[];
  description?: string | null;
}): FeatureComparable {
  const specAndAttr = [...(product.specifications || []), ...(product.attributes || [])];
  const texts = [...(product.feature_bullets || []), product.description || ""];

  return {
    rpm: parseNumber(findSpecValue(specAndAttr, RPM_LABELS)),
    runTimeMinutes: parseRuntimeMinutes(findSpecValue(specAndAttr, RUNTIME_LABELS)),
    cordless: detectCordless([...texts, ...specAndAttr.map(s => `${s.name} ${s.value}`)]),
    buildMaterial: findSpecValue(specAndAttr, ["material"]),
    bladeTech: findBladeMention(texts),
  };
}

// `tdsFields` is the flat {field_id: answer} map from
// lib/db/documents.ts's getTdsFieldsForProject — real TDS spec fields
// (motor_rpm, motor_run_time, material, blade_name) reused as-is, never a
// new data source. Returns an all-null comparable when there's no linked
// project (ad-hoc analyses simply skip feature scoring gracefully, since
// computeFeatureScore already treats "nothing comparable" as 0, not an error).
export function extractOurSpecsFromTds(tdsFields: Record<string, string> | null): FeatureComparable {
  if (!tdsFields) return { rpm: null, runTimeMinutes: null, cordless: null, buildMaterial: null, bladeTech: null };

  const rpmAnswer = tdsFields["motor_rpm"];
  const runTimeAnswer = tdsFields["motor_run_time"];
  const materialAnswer = tdsFields["material"];
  const bladeAnswer = tdsFields["blade_name"];

  return {
    rpm: isRealAnswer(rpmAnswer) ? parseNumber(rpmAnswer) : null,
    runTimeMinutes: isRealAnswer(runTimeAnswer) ? parseRuntimeMinutes(runTimeAnswer) : null,
    cordless: null, // no dedicated TDS field for this today — left unknown rather than guessed
    buildMaterial: isRealAnswer(materialAnswer) ? materialAnswer : null,
    bladeTech: isRealAnswer(bladeAnswer) ? (findBladeMention([bladeAnswer]) || bladeAnswer) : null,
  };
}
