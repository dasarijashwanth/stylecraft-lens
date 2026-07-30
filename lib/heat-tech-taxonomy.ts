// lib/heat-tech-taxonomy.ts
// Pure Heat/Plate Technology family matching against the admin-editable
// taxonomy (lib/db/heat-tech-families.ts) — a full parallel to
// lib/motor-taxonomy.ts for motorless styling tools (flat iron/curling
// iron/hot brush — see lib/db/tool-types.ts's primary_criterion column),
// minus the motor-specific modifier/adjacent-family concepts (not
// requested for this criterion — match tiers are exact/different/
// unverified only). Plain TS, no server-only imports.
import { normalizeBrandToken } from "./legacy-brand-discovery";
import type { HeatTechFamilyRow } from "./db/heat-tech-families";
import type { BrandedHeatTechNameRow } from "./db/branded-heat-tech-names";

export type HeatTechMatchTier = "exact" | "different" | "unverified";

export interface MatchedHeatTech {
  familyKey: string;
  label: string;
}

// Word-boundary, accent/typography-safe token match — mirrors
// lib/motor-taxonomy.ts's aliasMatchesText exactly.
function aliasMatchesText(alias: string, textTokens: Set<string>): boolean {
  const aliasTokens = normalizeBrandToken(alias).split(/\s+/).filter(Boolean);
  return aliasTokens.length > 0 && aliasTokens.every(t => textTokens.has(t));
}

// Finds the first enabled family whose label/key/alias appears as a
// whole-word match in `text`. Returns null when no family matches at all
// (an honest "couldn't determine plate/heat technology from this text,"
// not a guess).
export function matchHeatTechFamily(text: string, families: HeatTechFamilyRow[]): MatchedHeatTech | null {
  const textTokens = new Set(normalizeBrandToken(text || "").split(/\s+/).filter(Boolean));
  if (textTokens.size === 0) return null;

  const enabled = families.filter(f => f.enabled).sort((a, b) => a.sort_order - b.sort_order);
  for (const family of enabled) {
    const candidates = [family.label, family.family_key.replace(/_/g, " "), ...family.aliases];
    if (candidates.some(c => aliasMatchesText(c, textTokens))) {
      return { familyKey: family.family_key, label: family.label };
    }
  }
  return null;
}

// heat_tech_families.aliases is a single GLOBAL namespace matched
// regardless of brand — mirrors lib/motor-taxonomy.ts's
// matchBrandedMotorName exactly: only entries scoped to the SAME brand are
// ever checked, so a proprietary plate/heat marketing name is only ever
// trusted for the brand that actually owns it.
export function matchBrandedHeatTechName(
  brand: string,
  text: string,
  brandedNames: BrandedHeatTechNameRow[],
  families: HeatTechFamilyRow[]
): (MatchedHeatTech & { brandedTerm: string }) | null {
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
    return { familyKey: family.family_key, label: family.label, brandedTerm: entry.branded_term };
  }
  return null;
}

export interface NormalizedHeatTech {
  family: MatchedHeatTech | null;
  // The brand's own registered proprietary term — set ONLY when a
  // brand-scoped branded map entry actually matched. Mirrors
  // lib/motor-taxonomy.ts's NormalizedMotor.brandedName exactly.
  brandedName: string | null;
}

// Single unified entry point every heat-tech-entry point should call
// instead of invoking matchBrandedHeatTechName/matchHeatTechFamily
// separately — mirrors lib/motor-taxonomy.ts's normalizeMotor exactly.
export function normalizeHeatTech(
  raw: string,
  families: HeatTechFamilyRow[],
  opts?: { brand?: string | null; brandedNames?: BrandedHeatTechNameRow[] }
): NormalizedHeatTech {
  const trimmed = (raw || "").trim();
  if (!trimmed) return { family: null, brandedName: null };

  if (opts?.brand && opts.brandedNames?.length) {
    const branded = matchBrandedHeatTechName(opts.brand, trimmed, opts.brandedNames, families);
    if (branded) {
      const { brandedTerm, ...family } = branded;
      return { family, brandedName: brandedTerm };
    }
  }

  return { family: matchHeatTechFamily(trimmed, families), brandedName: null };
}

// exact (same family) > different > unverified (either side's plate/heat
// technology couldn't be determined at all — never treated as
// "different", since that would falsely penalize a candidate we simply
// lack data for). No "adjacent" tier — not requested for this criterion.
export function computeHeatTechMatchTier(ourFamilyKey: string | null, candidateFamilyKey: string | null): HeatTechMatchTier {
  if (!ourFamilyKey || !candidateFamilyKey) return "unverified";
  if (ourFamilyKey === candidateFamilyKey) return "exact";
  return "different";
}
