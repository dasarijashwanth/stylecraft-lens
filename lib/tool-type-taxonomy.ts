// lib/tool-type-taxonomy.ts
// Strict tool-type isolation — replaces lib/category-synonyms.ts entirely.
//
// Root cause this fixes: a trimmer analysis was found containing clipper
// competitors/specs/reviews. There was no discrete "tool type" concept
// anywhere in the pipeline — only two free-text AI-generated strings
// (IdentityCard.category/subcategory) with no guaranteed relationship
// between them, so a category string like "Hair Clippers & Trimmers"
// would satisfy a "does this competitor match the category" check for
// EITHER tool. The old category-synonyms.ts's competitorMatchesCategory
// was itself conceptually correct (it kept clipper/trimmer/shaver as
// separate synonym sets) but had a first-match-wins bug: its
// synonymsFor() looped candidates in a fixed order and returned on the
// FIRST substring hit, silently discarding a second matching entry in the
// same string (e.g. "clipper" matched before "trimmer" was ever checked).
//
// This module fixes that mechanically: resolveToolType() checks ALL
// entries (never returns early), and if MORE THAN ONE type's aliases
// appear in the same text, it is honest about that — "ambiguous", never a
// silent pick of whichever entry happened to be checked first. A
// genuinely combined/multi-tool product (a clipper+trimmer kit) gets its
// own explicit "combo" bucket instead of falsely resolving to one of its
// constituent types.
export type ToolType =
  | "clipper"
  | "trimmer"
  | "shaver"
  | "dryer"
  | "flat_iron"
  | "curling_iron"
  | "hot_brush"
  | "other_styling"
  | "combo";

export const TOOL_TYPE_LABELS: Record<ToolType, string> = {
  clipper: "Clipper",
  trimmer: "Trimmer",
  shaver: "Shaver",
  dryer: "Hair Dryer",
  flat_iron: "Flat Iron",
  curling_iron: "Curling Iron",
  hot_brush: "Hot Brush",
  other_styling: "Other Styling Tool",
  combo: "Combo / Multi-Tool Kit",
};

// Which tool types are selectable for each of the analyze/new-project
// forms' 2 Industry options — the form previously showed all 9 ToolType
// options regardless of Industry, letting a Hair Care & Styling analysis
// select "Clipper" (and vice versa). Combo is valid either way, since a
// multi-tool kit can combine tools from either domain.
export const GROOMING_TOOL_TYPES: ToolType[] = ["clipper", "trimmer", "shaver", "combo"];
export const BEAUTY_TOOL_TYPES: ToolType[] = ["dryer", "flat_iron", "curling_iron", "hot_brush", "other_styling", "combo"];

export function toolTypesForIndustry(industry: string): ToolType[] {
  return industry === "haircare-styling" ? BEAUTY_TOOL_TYPES : GROOMING_TOOL_TYPES;
}

type SingleToolType = Exclude<ToolType, "combo" | "other_styling">;

interface ToolTypeAliasEntry {
  type: SingleToolType;
  aliases: string[];
}

// Ordered SPECIFIC types before the generic "clipper" bucket — copies the
// already-correct ordering lib/market-data.ts's getMarketData uses
// (trimmer/shaver/dryer/styling checked before the clipper/barber/
// grooming fallback). Order only matters for readability here (every
// entry is checked regardless of order, never "first match wins"), but
// keeping it matches the established convention.
const TOOL_TYPE_ALIASES: ToolTypeAliasEntry[] = [
  { type: "trimmer", aliases: ["trimmer", "beard trimmer", "detailer", "outliner", "liner", "edger"] },
  { type: "shaver", aliases: ["shaver", "foil shaver", "rotary shaver", "electric shaver", "razor"] },
  { type: "dryer", aliases: ["dryer", "blow dryer", "diffuser"] },
  { type: "flat_iron", aliases: ["flat iron", "straightener", "hair iron"] },
  { type: "curling_iron", aliases: ["curling iron", "curling wand", "curler", "wand"] },
  { type: "hot_brush", aliases: ["hot brush", "styling brush", "heated brush"] },
  { type: "clipper", aliases: ["clipper"] },
];

// Explicit combo/multi-groomer signal phrases — deliberately specific
// (not bare "kit"/"set", which also show up in unrelated product names
// like "cleaning kit" or "guard set") per the spec's own examples
// ("clipper & trimmer kit", "all-in-one groomer").
const COMBO_SIGNALS = [
  "combo",
  "duo",
  "2-in-1",
  "2 in 1",
  "all-in-one",
  "all in one",
  "multi-groomer",
  "multi groomer",
  "grooming kit",
  "clipper & trimmer",
  "clipper and trimmer",
  "trimmer & clipper",
  "trimmer and clipper",
  "clipper/trimmer",
];

function normalizeToken(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritic combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function singularize(word: string): string {
  return word.replace(/ies$/, "y").replace(/s$/, "");
}

function tokenSet(text: string): Set<string> {
  return new Set(normalizeToken(text).split(/\s+/).filter(Boolean).map(singularize));
}

// Whole-word/phrase containment (every token of `phrase` must appear as a
// whole word in `text`, after singularizing) — same token-set approach
// already proven in lib/legacy-brand-discovery.ts's brandMatchesTitle,
// applied here instead of raw substring matching so "clipper" as an alias
// can still match the plural "Clippers" in real text without also risking
// a false-positive substring hit inside an unrelated longer word.
function textContainsPhrase(text: string, phrase: string): boolean {
  const textTokens = tokenSet(text);
  const phraseTokens = normalizeToken(phrase).split(/\s+/).filter(Boolean).map(singularize);
  return phraseTokens.length > 0 && phraseTokens.every(t => textTokens.has(t));
}

export interface ToolTypeResolution {
  type: ToolType | null;
  ambiguous: boolean;
  // Populated only when ambiguous — every distinct type whose aliases
  // matched, so a caller (e.g. the pause-and-ask question) can show the
  // user exactly what was found.
  candidates?: SingleToolType[];
}

// Resolves free text (a product title, an identity card's category+
// subcategory, a competitor's name) to a tool type. Never silently picks
// one type over another when the text itself is genuinely ambiguous —
// this is the actual bug fix (see file header). Returns null when NO
// known tool-type vocabulary appears at all (nothing to resolve from,
// not even an "other_styling" guess — an explicit unmatched text is
// never coerced into a type).
export function resolveToolType(text: string | null | undefined): ToolTypeResolution | null {
  const lower = (text || "").toLowerCase().trim();
  if (!lower) return null;

  if (COMBO_SIGNALS.some(signal => lower.includes(signal))) {
    return { type: "combo", ambiguous: false };
  }

  const matched: SingleToolType[] = [];
  for (const entry of TOOL_TYPE_ALIASES) {
    if (entry.aliases.some(alias => textContainsPhrase(lower, alias))) {
      matched.push(entry.type);
    }
  }

  if (matched.length === 0) return null;
  if (matched.length === 1) return { type: matched[0], ambiguous: false };
  return { type: null, ambiguous: true, candidates: matched };
}

export type AssertToolTypeReason = "tool_type_mismatch" | "ambiguous_source";

export interface AssertToolTypeResult {
  ok: boolean;
  reason?: AssertToolTypeReason;
}

// The shared strict validator — every point where external data enters
// the pipeline (competitor discovery, ASIN resolution, reviews, news,
// key features, GTM/TDS web-fallback grounding) runs candidate text
// through this before accepting it.
//
// `combo`-required slots are deliberately permissive (a combo product's
// own competitive set can reasonably include other combos AND
// single-type products from the same category) — the strict direction
// the spec actually requires is the reverse: a combo/multi-groomer must
// NEVER fill a single-type slot (a trimmer analysis showing a "clipper &
// trimmer kit" as a "trimmer competitor" is exactly the kind of
// contamination this whole module exists to stop).
export function assertToolType(candidateTitleOrText: string, requiredToolType: ToolType): AssertToolTypeResult {
  if (requiredToolType === "combo") return { ok: true };

  const resolved = resolveToolType(candidateTitleOrText);
  // Unrecognized text (no tool-type vocabulary at all) isn't rejected —
  // this validator's job is to catch a KNOWN mismatch, never to invent a
  // rejection from missing information (a candidate's title might simply
  // be a brand/model name with no type word in it, e.g. "Wahl Detailer").
  if (!resolved) return { ok: true };

  if (resolved.type === "combo") return { ok: false, reason: "tool_type_mismatch" };
  if (resolved.ambiguous) return { ok: false, reason: "ambiguous_source" };
  if (resolved.type !== requiredToolType) return { ok: false, reason: "tool_type_mismatch" };

  return { ok: true };
}

// One shared paragraph, interpolated into every system prompt in the
// pipeline (Phase 0 identification, Phase 1/2 discovery, Phase 3
// synthesis, GTM generation, web-search fallback, key-features
// extraction, review/news theme extraction) — a single place to tune the
// exact wording rather than re-writing similar guard text per call site.
const ALL_SINGLE_TYPES: SingleToolType[] = TOOL_TYPE_ALIASES.map(e => e.type);

export function buildToolTypePromptGuard(toolType: ToolType): string {
  const label = TOOL_TYPE_LABELS[toolType];
  if (toolType === "combo") {
    return `The product is a ${label.toLowerCase()} — it genuinely combines multiple tool types in one kit. Use ONLY information about this exact combo product or other combo/multi-tool kits. Do NOT substitute data about a single-type sibling product (e.g. just the brand's standalone clipper or standalone trimmer) as if it described this combo.`;
  }
  const conflicting = ALL_SINGLE_TYPES.filter(t => t !== toolType).map(t => TOOL_TYPE_LABELS[t]).join(", ");
  return `The product is a ${label}. Use ONLY ${label.toLowerCase()} information. Do NOT use, reference, or borrow data about ${conflicting} or any other conflicting tool type — including sibling products from the same brand or collection, even ones sharing the same motor technology or model line. If provided source material describes a different tool type, ignore that material entirely. If you cannot complete the task with ${label.toLowerCase()}-specific data, say so rather than substituting data from a different tool type.`;
}

// Maps the StyleCraft catalog's own already-correct product.category
// ("Clippers"|"Trimmers"|"Shavers"|"Hair Dryers"|"Styling Tools"|
// "Brushes"|"Sets"|"Apparel"|"Accessories" — see lib/stylecraft-products.ts)
// to a ToolType, for the analyze/new-project forms' catalog quick-fill.
// Falls back to resolving the more specific amazonCategory text first
// (e.g. "Professional Foil Shavers" resolves cleanly to "shaver"), since
// the coarse catalog bucket alone can't distinguish flat iron/curling
// iron/hot brush within "Styling Tools".
export function deriveToolTypeFromCatalogProduct(product: { category: string; amazonCategory?: string }): ToolType | null {
  const fromAmazonCategory = product.amazonCategory ? resolveToolType(product.amazonCategory) : null;
  if (fromAmazonCategory && !fromAmazonCategory.ambiguous && fromAmazonCategory.type) return fromAmazonCategory.type;

  switch (product.category) {
    case "Clippers": return "clipper";
    case "Trimmers": return "trimmer";
    case "Shavers": return "shaver";
    case "Hair Dryers": return "dryer";
    case "Sets": return "combo";
    case "Styling Tools": return "other_styling";
    case "Brushes": return "hot_brush";
    default: return null; // Apparel/Accessories aren't analyzable tool types
  }
}
