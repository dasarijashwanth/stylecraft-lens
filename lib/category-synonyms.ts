// Category-match validation guardrail — a competitor discovered for a
// beard trimmer must actually be a trimmer, not a clipper, shaver, or any
// adjacent tool. Used server-side to drop mismatched candidates that slip
// past the AI's own category-filtering instruction, so a clipper can
// never appear in a hair-dryer analysis.
const CATEGORY_SYNONYMS: { keys: string[]; synonyms: string[] }[] = [
  { keys: ["clipper"], synonyms: ["clipper"] },
  { keys: ["trimmer"], synonyms: ["trimmer", "beard trimmer", "detailer", "outliner"] },
  { keys: ["dryer"], synonyms: ["dryer", "blow dryer", "blow-dryer"] },
  { keys: ["straighten", "flat iron", "hair iron"], synonyms: ["straightener", "flat iron", "hair iron", "flat-iron"] },
  { keys: ["curling iron", "curler", "wand"], synonyms: ["curling iron", "curler", "wand", "curling wand"] },
  { keys: ["shaver"], synonyms: ["shaver", "electric shaver"] },
  { keys: ["razor"], synonyms: ["razor"] },
  { keys: ["brush"], synonyms: ["brush", "hot brush", "styling brush"] },
];

function synonymsFor(category: string): string[] {
  const key = category.toLowerCase().trim();
  for (const entry of CATEGORY_SYNONYMS) {
    if (entry.keys.some(k => key.includes(k))) return entry.synonyms;
  }
  return key ? [key] : [];
}

// True if the competitor's own name/description text contains the
// identified category or subcategory (or a known synonym) — the
// server-side check backing "reject any candidate whose category doesn't
// match" from the discovery prompt instruction.
export function competitorMatchesCategory(competitorText: string, category: string, subcategory?: string): boolean {
  const text = (competitorText || "").toLowerCase();
  const syns = [...synonymsFor(category), ...(subcategory ? synonymsFor(subcategory) : [])];
  if (syns.length === 0) return true; // no known category to validate against — don't block
  return syns.some(s => text.includes(s));
}
