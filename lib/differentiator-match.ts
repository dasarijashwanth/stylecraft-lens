// lib/differentiator-match.ts
// Resolves whether a competitor candidate's real listing text (title +
// feature_bullets + description — the same grounding data
// lib/analysisEngine.ts's enrichCompetitorsWithRainforest now forwards)
// matches the analysis form's optional Key Differentiator field. Feeds
// lib/competitor-scoring.ts's computeFeatureScore as an optional 3rd
// param. Plain TS, no server-only imports — fully offline-testable.
//
// Two phrasings of the same real-world feature rarely share literal
// words ("full metal body" vs "all-metal housing") — a plain textual
// similarity check (lib/text-similarity.ts's trigram/Jaccard, designed
// for comparing two whole paragraphs of similar length) would score this
// pairing low, since a short phrase against a long listing text is a
// length mismatch, not a similarity problem. This module instead: (1)
// checks a small hand-curated table of common phrasing groups so known
// synonyms resolve to the same concept, then (2) falls back to a plain
// token-overlap ratio for anything not covered by that table.
const SYNONYM_GROUPS: string[][] = [
  ["full metal", "all metal", "all-metal", "metal body", "metal housing", "aluminum body", "aluminum housing"],
  ["zero gap", "zero-gap", "close cutting", "close-cutting"],
  ["quiet", "silent", "low noise", "low-noise", "whisper quiet", "whisper-quiet"],
  ["waterproof", "water resistant", "water-resistant", "splash proof", "splash-proof"],
  ["lightweight", "ultra light", "ultra-light", "light weight"],
  ["fast charging", "fast-charging", "quick charge", "quick-charge", "rapid charge"],
  ["long battery", "long-lasting battery", "extended run time", "extended-run time", "extended battery"],
  ["interchangeable", "swappable", "modular", "customizable body", "customizable bodies"],
  ["stays cool", "stay cool", "stayed cool", "cool running", "heat resistant", "heat-resistant"],
];

const STOP_WORDS = new Set(["the", "a", "an", "and", "or", "with", "of", "for", "to", "in", "on", "is", "are"]);

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function matchedSynonymGroups(text: string): Set<number> {
  const normalized = normalize(text);
  const matched = new Set<number>();
  SYNONYM_GROUPS.forEach((group, i) => {
    if (group.some(phrase => normalized.includes(phrase))) matched.add(i);
  });
  return matched;
}

function meaningfulTokens(text: string): string[] {
  return normalize(text).split(/\s+/).filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

// Returns true when `candidateText` (a competitor's title/feature_bullets/
// description joined together) genuinely appears to share the feature
// named by `keyDiff` (the analysis form's Key Differentiator field).
// Returns false — never throws, never "maybe" — on empty input either
// side, so callers can pass this straight through to computeFeatureScore
// without a separate empty-check.
export function matchesDifferentiator(keyDiff: string, candidateText: string): boolean {
  if (!keyDiff.trim() || !candidateText.trim()) return false;

  const keyDiffGroups = matchedSynonymGroups(keyDiff);
  if (keyDiffGroups.size > 0) {
    const candidateGroups = matchedSynonymGroups(candidateText);
    if (Array.from(keyDiffGroups).some(g => candidateGroups.has(g))) return true;
  }

  const keyDiffTokens = meaningfulTokens(keyDiff);
  if (keyDiffTokens.length === 0) return false;
  const candidateTokens = new Set(meaningfulTokens(candidateText));
  const matchedCount = keyDiffTokens.filter(t => candidateTokens.has(t)).length;
  return matchedCount / keyDiffTokens.length >= 0.5;
}
