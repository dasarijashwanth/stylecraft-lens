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
//
// Tool Type is now DB-backed (lib/db/tool-types.ts's tool_types table,
// mirroring lib/motor-taxonomy.ts's motor_families pattern exactly) rather
// than a fixed compile-time union — a new tool category can be added
// inline from the analyze/new-project forms without a code deploy. Every
// function below takes the current `toolTypes: ToolTypeRow[]` list
// explicitly (fetched once via `await listToolTypes()` at whatever async
// boundary is natural for the caller — never module-level mutable state,
// which would be a real cross-tenant data-leak risk in this app's
// Vercel serverless environment, where a warm lambda instance can
// interleave requests from different orgs). `ToolType` itself loosens from
// a fixed union to `string` so every existing call site's type annotations
// keep compiling — only genuinely-exhaustive logic (switch statements over
// every type) needed to change.
import type { ToolTypeRow } from "./db/tool-types";

export type ToolType = string;

export function getToolTypeLabel(key: string | null | undefined, toolTypes: ToolTypeRow[]): string {
  if (!key) return "—";
  return toolTypes.find(t => t.type_key === key)?.label || key;
}

// Which tool types are selectable for each of the analyze/new-project
// forms' 2 Industry options — the form previously showed all 9 ToolType
// options regardless of Industry, letting a Hair Care & Styling analysis
// select "Clipper" (and vice versa). Combo is valid either way (family:
// null in the seed data), since a multi-tool kit can combine tools from
// either domain. A custom type's own `family` (set when it's added, per
// the form's industry-family prompt) determines which Industry offers it.
export function toolTypesForIndustry(industry: string, toolTypes: ToolTypeRow[]): ToolTypeRow[] {
  const wantedFamily = industry === "haircare-styling" ? "beauty" : "clipper_trimmer_shaver";
  return toolTypes.filter(t => t.enabled && (t.family === wantedFamily || t.family === null));
}

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
  type: string | null;
  ambiguous: boolean;
  // Populated only when ambiguous — every distinct type whose aliases
  // matched, so a caller (e.g. the pause-and-ask question) can show the
  // user exactly what was found.
  candidates?: string[];
}

// Resolves free text (a product title, an identity card's category+
// subcategory, a competitor's name) to a tool type. Never silently picks
// one type over another when the text itself is genuinely ambiguous —
// this is the actual bug fix (see file header). Returns null when NO
// known tool-type vocabulary appears at all (nothing to resolve from,
// not even an "other_styling" guess — an explicit unmatched text is
// never coerced into a type). "combo"/"other_styling" (and any custom
// type with no aliases) never match via the alias loop below — combo is
// resolved exclusively via COMBO_SIGNALS, other_styling never resolves
// from text at all (it's the "none of the concrete types" catch-all).
export function resolveToolType(text: string | null | undefined, toolTypes: ToolTypeRow[]): ToolTypeResolution | null {
  const lower = (text || "").toLowerCase().trim();
  if (!lower) return null;

  if (COMBO_SIGNALS.some(signal => lower.includes(signal))) {
    return { type: "combo", ambiguous: false };
  }

  const matched: string[] = [];
  for (const t of toolTypes) {
    if (!t.enabled) continue;
    if (t.aliases.some(alias => textContainsPhrase(lower, alias))) {
      matched.push(t.type_key);
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
export function assertToolType(candidateTitleOrText: string, requiredToolType: string, toolTypes: ToolTypeRow[]): AssertToolTypeResult {
  if (requiredToolType === "combo") return { ok: true };

  const resolved = resolveToolType(candidateTitleOrText, toolTypes);
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
export function buildToolTypePromptGuard(toolType: string, toolTypes: ToolTypeRow[]): string {
  const label = getToolTypeLabel(toolType, toolTypes);
  if (toolType === "combo") {
    return `The product is a ${label.toLowerCase()} — it genuinely combines multiple tool types in one kit. Use ONLY information about this exact combo product or other combo/multi-tool kits. Do NOT substitute data about a single-type sibling product (e.g. just the brand's standalone clipper or standalone trimmer) as if it described this combo.`;
  }
  // Excludes combo/other_styling/any alias-less type — same "concrete,
  // resolvable types only" set resolveToolType's alias loop itself matches
  // against, so the guard never warns against a type that could never
  // have been confused with this one in the first place.
  const conflicting = toolTypes.filter(t => t.enabled && t.type_key !== toolType && t.aliases.length > 0).map(t => t.label).join(", ");
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
export function deriveToolTypeFromCatalogProduct(product: { category: string; amazonCategory?: string }, toolTypes: ToolTypeRow[]): string | null {
  const fromAmazonCategory = product.amazonCategory ? resolveToolType(product.amazonCategory, toolTypes) : null;
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
