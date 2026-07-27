// lib/motor-taxonomy.ts
// Pure motor-family matching against the admin-editable taxonomy
// (lib/db/motor-families.ts) — the #1 priority signal in competitor
// selection (lib/competitor-scoring.ts). Plain TS, no server-only imports.
import { normalizeBrandToken } from "./legacy-brand-discovery";
import type { MotorFamilyRow } from "./db/motor-families";
import { resolveRegistryCategorySlug } from "./legacy-brand-registry";
import type { IdentityCard } from "./product-identification";

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
export function isMotorizedCategory(identity: Pick<IdentityCard, "category" | "subcategory" | "targetUser">): boolean {
  return resolveRegistryCategorySlug(identity) !== null;
}
