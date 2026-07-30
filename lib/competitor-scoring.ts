// lib/competitor-scoring.ts
// Pure composite-scoring math for competitor selection: motor (dominant),
// then price (absolute for legacy, relative-lineup for indie), then
// comparable feature/spec overlap as a tie-breaker. Plain TS, no
// server-only imports — fully offline-testable.
import type { MotorMatchTier } from "./motor-taxonomy";

export interface MatchingWeights {
  motor: number;
  price: number;
  feature: number;
}

export const DEFAULT_WEIGHTS: MatchingWeights = { motor: 0.45, price: 0.35, feature: 0.2 };

const MOTOR_SCORE_BY_TIER: Record<MotorMatchTier, number> = {
  exact: 1.0,
  adjacent: 0.6,
  different: 0.15,
  unverified: 0.3,
};

export function computeMotorScore(tier: MotorMatchTier): number {
  return MOTOR_SCORE_BY_TIER[tier];
}

// Absolute proximity to target price (legacy default) — the same falloff
// shape already implied by lib/price-band.ts's existing ±50%-of-target
// floor: a candidate priced at the floor scores 0, right at target scores 1.
export function computePriceScoreAbsolute(price: number, targetPrice: number): number {
  if (!targetPrice) return 0;
  const diff = Math.abs(price - targetPrice);
  return Math.max(0, 1 - Math.min(1, diff / (0.5 * targetPrice)));
}

// Relative-tier proximity for indie brands (Part 4) — 1.0 when our
// percentile within OUR OWN lineup matches their model's percentile within
// THEIR lineup (both are each brand's flagship, say), regardless of how
// different the absolute dollars are.
export function computePriceScoreRelative(ourPercentile: number, theirPercentile: number): number {
  return Math.max(0, 1 - Math.abs(ourPercentile - theirPercentile));
}

export interface FeatureComparable {
  bladeTech?: string | null;
  rpm?: number | null;
  runTimeMinutes?: number | null;
  cordless?: boolean | null;
  buildMaterial?: string | null;
  // Heat/Plate Technology tool types (flat iron/curling iron/hot brush) —
  // plate material itself is the PRIMARY criterion (see
  // lib/heat-tech-taxonomy.ts), scored separately from this feature
  // overlap. Heater type and max temp class are ordinary comparable
  // features, same tier as bladeTech/buildMaterial, so they never
  // double-count the primary-criterion match.
  heaterType?: string | null;
  maxTempClass?: string | null;
}

function normalizeStr(s: string): string {
  return s.trim().toLowerCase();
}

// Equal-weighted overlap of grounded, comparable specs. A value missing on
// either side never counts as a mismatch — it simply doesn't contribute
// (no invented "0 vs unknown" penalty). Returns 0 (not null) when nothing
// is comparable at all, so it composes cleanly with computeCompositeScore.
//
// `differentiatorMatch` (Part 2 of the motor+price-led discovery plan) is
// optional and backward-compatible: omit it (or pass null/undefined — the
// "no Key Differentiator was given" case) and this returns exactly the
// structural score as before, unchanged. When the analysis form's Key
// Differentiator field IS set, the caller resolves whether this specific
// candidate's real listing text matches it (lib/differentiator-match.ts)
// and passes that boolean here — blended in at a fixed 30% weight so a
// differentiator match can meaningfully move the score without ever fully
// overriding grounded structural spec overlap.
export function computeFeatureScore(ours: FeatureComparable, theirs: FeatureComparable, differentiatorMatch?: boolean | null): number {
  const checks: boolean[] = [];

  if (ours.bladeTech && theirs.bladeTech) checks.push(normalizeStr(ours.bladeTech) === normalizeStr(theirs.bladeTech));
  if (ours.rpm != null && theirs.rpm != null && ours.rpm > 0) checks.push(Math.abs(ours.rpm - theirs.rpm) / ours.rpm <= 0.2);
  if (ours.runTimeMinutes != null && theirs.runTimeMinutes != null && ours.runTimeMinutes > 0) {
    checks.push(Math.abs(ours.runTimeMinutes - theirs.runTimeMinutes) / ours.runTimeMinutes <= 0.25);
  }
  if (ours.cordless != null && theirs.cordless != null) checks.push(ours.cordless === theirs.cordless);
  if (ours.buildMaterial && theirs.buildMaterial) checks.push(normalizeStr(ours.buildMaterial) === normalizeStr(theirs.buildMaterial));
  if (ours.heaterType && theirs.heaterType) checks.push(normalizeStr(ours.heaterType) === normalizeStr(theirs.heaterType));
  if (ours.maxTempClass && theirs.maxTempClass) checks.push(normalizeStr(ours.maxTempClass) === normalizeStr(theirs.maxTempClass));

  const structuralScore = checks.length === 0 ? 0 : checks.filter(Boolean).length / checks.length;
  if (differentiatorMatch === undefined || differentiatorMatch === null) return structuralScore;
  return structuralScore * 0.7 + (differentiatorMatch ? 1 : 0) * 0.3;
}

// Weights are entered as free-form relative-importance numbers (any
// non-negative scale, no sum-to-1 constraint) — normalization happens HERE,
// at use-time, so every caller (and the stored/snapshotted `matching_weights`
// audit trail) keeps the raw values the user actually typed. Guards against
// a zero/invalid sum (should never happen given scoring-profiles.ts's own
// "at least one > 0" validation, but a composite score must never divide by
// zero) by falling back to DEFAULT_WEIGHTS, which already sums to 1.
function normalizeWeights(weights: MatchingWeights): MatchingWeights {
  const sum = weights.motor + weights.price + weights.feature;
  if (!sum || !isFinite(sum)) return DEFAULT_WEIGHTS;
  return { motor: weights.motor / sum, price: weights.price / sum, feature: weights.feature / sum };
}

export function computeCompositeScore(motorScore: number, priceScore: number, featureScore: number, weights: MatchingWeights = DEFAULT_WEIGHTS): number {
  const w = normalizeWeights(weights);
  return w.motor * motorScore + w.price * priceScore + w.feature * featureScore;
}

// "Fill in priority order, max 1 product per brand until every listed
// brand has had a chance" (legacy only) — assumes `candidates` is already
// sorted by descending composite score. Keeps the highest-scoring
// candidate per distinct brand on a first pass; only reaches into a
// second candidate from an already-used brand if fewer distinct brands
// than `limit` exist at all.
export function dedupeToOnePerBrand<T extends { brand?: string }>(candidates: T[], limit: number): T[] {
  const seenBrands = new Set<string>();
  const firstPass: T[] = [];
  const leftover: T[] = [];

  for (const c of candidates) {
    const brandKey = (c.brand || "").trim().toLowerCase();
    if (brandKey && !seenBrands.has(brandKey)) {
      seenBrands.add(brandKey);
      firstPass.push(c);
    } else {
      leftover.push(c);
    }
  }

  return [...firstPass, ...leftover].slice(0, limit);
}
