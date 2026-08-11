// lib/grooming-tag-taxonomy.ts
// Grooming industry gate ticket, Part 2 — a finer-grained sub-classification
// WITHIN an existing tool_types row (e.g. "trimmer" splits into beard_trimmer
// vs. detail_trimmer_outliner; "shaver" splits into foil_shaver vs.
// rotary_shaver), not a second parallel taxonomy table. Plain TS, no server
// imports — fully offline-testable, mirrors lib/motor-taxonomy.ts's shape.
import type { FeatureComparable } from "./competitor-scoring";

export type GroomingTag =
  | "hair_clipper"
  | "beard_trimmer"
  | "detail_trimmer_outliner"
  | "foil_shaver"
  | "rotary_shaver"
  | "hair_dryer"
  | "flat_iron"
  | "curling_iron";

// Fixed, hardcoded — NOT DB-editable. This is a closed, structurally-stable
// 8-value vocabulary, same convention as lib/spec-extraction.ts's own
// BLADE_KEYWORDS/CORDLESS_KEYWORDS arrays.
const TAG_DISAMBIGUATION_KEYWORDS: Record<GroomingTag, string[]> = {
  hair_clipper: ["clipper"],
  beard_trimmer: ["beard trimmer", "beard"],
  detail_trimmer_outliner: ["detailer", "outliner", "liner", "edger", "detail trimmer"],
  foil_shaver: ["foil shaver", "foil"],
  rotary_shaver: ["rotary shaver", "rotary"],
  hair_dryer: ["dryer", "blow dryer"],
  flat_iron: ["flat iron", "straightener"],
  curling_iron: ["curling iron", "curling wand", "curler"],
};

// Which tool_type_key each tag can be derived under — a tag is only ever
// inferred within its matching tool type, so a "beard" mention on a hair-
// dryer listing never accidentally derives beard_trimmer.
const TOOL_TYPE_TO_TAGS: Record<string, GroomingTag[]> = {
  trimmer: ["beard_trimmer", "detail_trimmer_outliner"],
  clipper: ["hair_clipper"],
  shaver: ["foil_shaver", "rotary_shaver"],
  dryer: ["hair_dryer"],
  flat_iron: ["flat_iron"],
  curling_iron: ["curling_iron"],
};

// Strict for shaver sub-types (foil vs rotary are genuinely different
// cutting systems); trimmer sub-types are compatible with each other and
// with hair_clipper at reduced (not zero) confidence, since a detail
// trimmer is a real competitive alternative to a beard trimmer.
const TAG_COMPATIBILITY: Record<GroomingTag, GroomingTag[]> = {
  hair_clipper: ["hair_clipper", "beard_trimmer"],
  beard_trimmer: ["beard_trimmer", "detail_trimmer_outliner", "hair_clipper"],
  detail_trimmer_outliner: ["detail_trimmer_outliner", "beard_trimmer"],
  foil_shaver: ["foil_shaver"],
  rotary_shaver: ["rotary_shaver"],
  hair_dryer: ["hair_dryer"],
  flat_iron: ["flat_iron"],
  curling_iron: ["curling_iron"],
};

export const DEFAULT_GROOMING_TAG_CONFIDENCE_THRESHOLD = 0.4;

function normalize(text: string): string {
  return text.toLowerCase();
}

// Derives the finer-grained tag from free text, scoped to the candidate
// tool_type_key resolved elsewhere (assertToolType/resolveToolType) — never
// guesses across tool types. Returns null when the tool type has no known
// sub-tags (dryer/flat_iron/curling_iron each have exactly one tag, so this
// still resolves them) or when no disambiguation keyword is present at all.
export function deriveGroomingTag(toolTypeKey: string | null | undefined, text: string): GroomingTag | null {
  if (!toolTypeKey) return null;
  const candidateTags = TOOL_TYPE_TO_TAGS[toolTypeKey];
  if (!candidateTags || candidateTags.length === 0) return null;
  if (candidateTags.length === 1) return candidateTags[0];

  const normalized = normalize(text);
  for (const tag of candidateTags) {
    if (TAG_DISAMBIGUATION_KEYWORDS[tag].some(kw => normalized.includes(kw))) return tag;
  }
  // No sub-type keyword found — default to the first (most general) tag for
  // this tool type rather than returning null, so a generic "Beard Trimmer"
  // listing with no extra disambiguating word still resolves to something.
  return candidateTags[0];
}

export function areTagsCompatible(a: GroomingTag, b: GroomingTag): boolean {
  return TAG_COMPATIBILITY[a]?.includes(b) ?? false;
}

// Structural-overlap fraction over the Part 2 spec fields, same "missing on
// either side never penalizes" discipline computeFeatureScore already uses.
// This is intentionally a SEPARATE function from computeFeatureScore — the
// ticket requires candidates below threshold to be HARD-REJECTED even when
// motor+price matched, never just blended into the softer feature-overlap
// score.
export function computeGroomingTagConfidence(
  ourTag: GroomingTag | null | undefined,
  candidateTag: GroomingTag | null | undefined,
  ourSpecs: FeatureComparable,
  candidateSpecs: FeatureComparable
): number {
  if (!ourTag || !candidateTag) return 1; // nothing to compare against — don't gate on absence of tag data
  if (!areTagsCompatible(ourTag, candidateTag)) return 0;
  if (ourTag === candidateTag) return 1; // identical tag is always a full match, regardless of spec overlap

  const checks: boolean[] = [];
  if (ourSpecs.bladeType && candidateSpecs.bladeType) checks.push(ourSpecs.bladeType.toLowerCase() === candidateSpecs.bladeType.toLowerCase());
  if (ourSpecs.guardCombCount != null && candidateSpecs.guardCombCount != null) checks.push(ourSpecs.guardCombCount === candidateSpecs.guardCombCount);
  if (ourSpecs.lengthSettingsCount != null && candidateSpecs.lengthSettingsCount != null) checks.push(ourSpecs.lengthSettingsCount === candidateSpecs.lengthSettingsCount);
  if (ourSpecs.waterproof != null && candidateSpecs.waterproof != null) checks.push(ourSpecs.waterproof === candidateSpecs.waterproof);
  if (ourSpecs.cordless != null && candidateSpecs.cordless != null) checks.push(ourSpecs.cordless === candidateSpecs.cordless);

  // Compatible-but-different tags with nothing comparable yet (e.g. a
  // bare-bones AI-hallucinated candidate with no specs at all) get a
  // moderate default rather than 0 or 1 — real evidence of overlap raises
  // it, real evidence of divergence lowers it, absence of evidence is
  // neither a pass nor a fail on its own.
  if (checks.length === 0) return 0.5;
  return checks.filter(Boolean).length / checks.length;
}
