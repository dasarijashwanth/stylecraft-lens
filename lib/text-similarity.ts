// Dependency-free trigram/Jaccard text similarity — used to catch generic
// boilerplate copy that could apply to any product (see the "written" field
// anti-duplication check in app/api/documents/generate/route.ts). No package
// installed for this; trigram overlap is simple enough to implement directly
// and avoids pulling in a new dependency for one small check.

function trigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const grams = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i++) {
    grams.add(normalized.slice(i, i + 3));
  }
  return grams;
}

// Jaccard similarity of the two strings' trigram sets — 0 (nothing in
// common) to 1 (identical). Short strings (<3 chars, e.g. "N/A") always
// return 0 rather than dividing by zero / producing a meaningless score.
export function textSimilarity(a: string, b: string): number {
  if (!a || !b || a.length < 3 || b.length < 3) return 0;
  const setA = trigrams(a);
  const setB = trigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  setA.forEach(g => { if (setB.has(g)) intersection += 1; });
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export const BOILERPLATE_SIMILARITY_THRESHOLD = 0.85;
