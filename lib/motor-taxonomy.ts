// lib/motor-taxonomy.ts
// Pure motor-family matching against the admin-editable taxonomy
// (lib/db/motor-families.ts) — the #1 priority signal in competitor
// selection (lib/competitor-scoring.ts). Plain TS, no server-only imports.
import { normalizeBrandToken } from "./legacy-brand-discovery";
import type { MotorFamilyRow } from "./db/motor-families";
import type { BrandedMotorNameRow } from "./db/branded-motor-names";
import { resolveRegistryCategorySlug } from "./legacy-brand-registry";
import type { IdentityCard } from "./product-identification";
import type { ToolTypeRow } from "./db/tool-types";

export type MotorMatchTier = "exact" | "adjacent" | "different" | "unverified";

export interface MatchedMotor {
  familyKey: string;
  label: string;
  modifierKey: string | null;
  modifierLabel: string | null;
}

// Word-boundary, accent/typography-safe token match — mirrors
// lib/legacy-brand-discovery.ts's brandMatchesTitle exactly. Motor-type
// identity is exactly as high-stakes as brand identity: a naive substring
// test on a short alias like "AC" would false-positive constantly (e.g.
// inside "PACKAGE" or "BLACK").
function aliasMatchesText(alias: string, textTokens: Set<string>): boolean {
  const aliasTokens = normalizeBrandToken(alias).split(/\s+/).filter(Boolean);
  return aliasTokens.length > 0 && aliasTokens.every(t => textTokens.has(t));
}

// Finds the first enabled non-modifier family whose label/key/alias
// appears as a whole-word match in `text`, plus any modifier (e.g.
// "brushless") that also appears — modifiers never compete as their own
// family, they only ever combine with one (e.g. "brushless rotary").
// Returns null when no family matches at all (an honest "couldn't
// determine motor type from this text," not a guess).
export function matchMotorFamily(text: string, families: MotorFamilyRow[]): MatchedMotor | null {
  const textTokens = new Set(normalizeBrandToken(text || "").split(/\s+/).filter(Boolean));
  if (textTokens.size === 0) return null;

  const nonModifiers = families.filter(f => f.enabled && !f.modifier).sort((a, b) => a.sort_order - b.sort_order);
  const modifiers = families.filter(f => f.enabled && f.modifier);

  let matchedFamily: MotorFamilyRow | null = null;
  for (const family of nonModifiers) {
    const candidates = [family.label, family.family_key.replace(/_/g, " "), ...family.aliases];
    if (candidates.some(c => aliasMatchesText(c, textTokens))) {
      matchedFamily = family;
      break;
    }
  }
  if (!matchedFamily) return null;

  let matchedModifier: MotorFamilyRow | null = null;
  for (const mod of modifiers) {
    const candidates = [mod.label, mod.family_key.replace(/_/g, " "), ...mod.aliases];
    if (candidates.some(c => aliasMatchesText(c, textTokens))) {
      matchedModifier = mod;
      break;
    }
  }

  return {
    familyKey: matchedFamily.family_key,
    label: matchedFamily.label,
    modifierKey: matchedModifier?.family_key ?? null,
    modifierLabel: matchedModifier?.label ?? null,
  };
}

// motor_families.aliases is a single GLOBAL namespace matched regardless of
// brand — adding a brand's own proprietary marketing name there (e.g. "IN3")
// would wrongly match every other brand's product that happens to share the
// same string. This checks only entries scoped to the SAME brand (brand-name
// comparison uses the same normalizeBrandToken equality this codebase
// already uses for brand matching elsewhere), so a proprietary term is only
// ever trusted for the brand that actually owns it.
export function matchBrandedMotorName(brand: string, text: string, brandedNames: BrandedMotorNameRow[], families: MotorFamilyRow[]): (MatchedMotor & { brandedTerm: string }) | null {
  const brandToken = normalizeBrandToken(brand || "");
  if (!brandToken) return null;
  const textTokens = new Set(normalizeBrandToken(text || "").split(/\s+/).filter(Boolean));
  if (textTokens.size === 0) return null;

  for (const entry of brandedNames) {
    if (!entry.enabled) continue;
    if (normalizeBrandToken(entry.brand_name) !== brandToken) continue;
    if (!aliasMatchesText(entry.branded_term, textTokens)) continue;
    const family = families.find(f => f.enabled && f.family_key === entry.family_key);
    if (!family) continue;
    return { familyKey: family.family_key, label: family.label, modifierKey: null, modifierLabel: null, brandedTerm: entry.branded_term };
  }
  return null;
}

export interface NormalizedMotor {
  family: MatchedMotor | null;
  // The brand's own registered proprietary term (e.g. "IN3") — set ONLY
  // when a brand-scoped branded map entry actually matched, since that's
  // the one case where there's a real display value beyond the canonical
  // family label itself (a spec row reading "Motor Type: Brushless" has
  // nothing to add over the label "Brushless Motor"). Null whenever
  // resolution fell through to plain generic family matching.
  brandedName: string | null;
}

// Single unified entry point every motor-entry point should call instead of
// invoking matchBrandedMotorName/matchMotorFamily separately. `opts.brand` +
// `opts.brandedNames` are optional — when given (competitor extraction), a
// brand's own proprietary term is checked first; when omitted (our own
// product, e.g. the analyze form's canonical-family select), this falls
// straight to generic family matching — "EON Digital Brushless Motor"
// already resolves via Brushless's own seeded aliases, no brand-scoping
// needed for our own product.
export function normalizeMotor(
  raw: string,
  families: MotorFamilyRow[],
  opts?: { brand?: string | null; brandedNames?: BrandedMotorNameRow[] }
): NormalizedMotor {
  const trimmed = (raw || "").trim();
  if (!trimmed) return { family: null, brandedName: null };

  if (opts?.brand && opts.brandedNames?.length) {
    const branded = matchBrandedMotorName(opts.brand, trimmed, opts.brandedNames, families);
    if (branded) {
      const { brandedTerm, ...family } = branded;
      return { family, brandedName: brandedTerm };
    }
  }

  return { family: matchMotorFamily(trimmed, families), brandedName: null };
}

// exact (same family) > adjacent (either family lists the other in its
// adjacent_families) > different > unverified (either side's motor type
// couldn't be determined at all — never treated as "different", since
// that would falsely penalize a candidate we simply lack data for).
export function computeMotorMatchTier(ourFamilyKey: string | null, candidateFamilyKey: string | null, families: MotorFamilyRow[]): MotorMatchTier {
  if (!ourFamilyKey || !candidateFamilyKey) return "unverified";
  if (ourFamilyKey === candidateFamilyKey) return "exact";
  const ourFamily = families.find(f => f.family_key === ourFamilyKey);
  if (ourFamily?.adjacent_families.includes(candidateFamilyKey)) return "adjacent";
  const candidateFamily = families.find(f => f.family_key === candidateFamilyKey);
  if (candidateFamily?.adjacent_families.includes(ourFamilyKey)) return "adjacent";
  return "different";
}

// Motor scoring only applies when the identified category is one this
// taxonomy actually covers — reuses the EXACT category-keyword resolution
// lib/legacy-brand-registry.ts already does for the brand registry (clipper/
// trimmer/shaver vs. dryer/iron/styler/brush), rather than inventing a
// second classification system. A genuinely unrelated product
// (resolveRegistryCategorySlug returns null) skips motor scoring entirely —
// never forces a motor requirement onto something it doesn't apply to.
export function isMotorizedCategory(identity: Pick<IdentityCard, "category" | "subcategory" | "targetUser" | "toolType">, toolTypes: ToolTypeRow[]): boolean {
  return resolveRegistryCategorySlug(identity, toolTypes) !== null;
}
