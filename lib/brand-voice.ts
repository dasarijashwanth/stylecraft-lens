// lib/brand-voice.ts
// Brand Voice Guide system — resolves which brand a product belongs to,
// fetches its active versioned voice guide (lib/db/brand-voice-guides.ts),
// condenses it into a reusable prompt block, and routes a per-content-type
// tone directive. Injected into every AI call across the app that produces
// user-facing prose (GTM narrative fields, Product FAQs, Sales Kit,
// deck-copy condensation, analysis synthesis) — see each call site's own
// buildSystemInstruction-equivalent for how this attaches, matching the
// exact precedent lib/gtm-style-exemplars.ts's renderStyleExemplarBlock
// already set (each caller's own prompt-builder appends a block, not a
// shared-wrapper architecture).
import { getActiveGuideRow } from "./db/brand-voice-guides";
import { listCatalogProducts } from "./db/catalog-products";
import { matchCatalogProductByName } from "./our-product-position";
import { motorLabel } from "./gtm-derive";

export type VoiceContentType =
  | "product_detail"
  | "launch"
  | "peer_selling"
  | "education"
  | "support"
  | "corporate"
  | "social";

export interface ResolvedVoiceGuide {
  brand: string;
  id: string | null;
  version: number | null;
  noGuideOnFile: boolean;
  content: string;
}

// A brand with no active guide (Gamma+, until a real one is provided) never
// blocks generation — it falls back to this and is flagged so the gap is
// visible, never silently treated as "voice doesn't matter here."
const NEUTRAL_FALLBACK_CONTENT = `Write in a clear, confident, professional tone. Anchor every claim to a real spec or feature — never generic praise without a fact behind it. Address the reader directly and warmly, avoid corporate distance ("valued customers", "our organization"), and never disparage competitors by name.`;

// Resolves StyleCraft vs. Gamma+ the SAME way the Manufacturer auto-detect
// cascade already does (lib/gtm-tier6-inference.ts's deriveManufacturer
// cascade reads the catalog's own `brand` column via this identical
// fuzzy-match function) — no new brand-detection logic, just reads the
// same resolved value.
export async function resolveBrandForProduct(productName: string): Promise<string> {
  const catalogProducts = await listCatalogProducts();
  const matched = matchCatalogProductByName(productName, catalogProducts);
  return matched?.brand || "StyleCraft";
}

// Cached per brand+process — a guide changes rarely (an admin edit), so
// every field's AI call reusing the same generation run shouldn't each pay
// a DB round-trip for it. clearVoiceGuideCache() exists for admin
// activation / tests that need to observe a change within the same process.
const guideCache = new Map<string, ResolvedVoiceGuide>();

export async function getActiveVoiceGuide(brand: string): Promise<ResolvedVoiceGuide> {
  const cached = guideCache.get(brand);
  if (cached) return cached;

  const row = await getActiveGuideRow(brand);
  const resolved: ResolvedVoiceGuide = row
    ? { brand, id: row.id, version: row.version, noGuideOnFile: false, content: row.content }
    : { brand, id: null, version: null, noGuideOnFile: true, content: NEUTRAL_FALLBACK_CONTENT };
  guideCache.set(brand, resolved);
  return resolved;
}

export function clearVoiceGuideCache(): void {
  guideCache.clear();
}

// ---- Condensing the stored markdown guide into a ~400-token prompt block ----
// Parses the guide's OWN known section structure (not a hand-duplicated
// copy) so an admin's edit is reflected immediately, not stuck behind a
// stale hardcoded excerpt. Gracefully degrades (skips a section) if a
// future edit doesn't follow the expected heading structure, rather than
// throwing.

function extractBetween(content: string, startMarker: string, endMarkers: string[]): string {
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) return "";
  const from = startIdx + startMarker.length;
  let endIdx = content.length;
  for (const marker of endMarkers) {
    const idx = content.indexOf(marker, from);
    if (idx !== -1 && idx < endIdx) endIdx = idx;
  }
  return content.slice(from, endIdx).trim();
}

interface ParsedAttribute {
  name: string;
  soundsLike: string;
  doesNotSoundLike: string;
}

function parsePersonalityLine(content: string): string {
  const match = content.match(/\*\*In one line:\*\*\s*(.+)/);
  return match ? match[1].trim() : "";
}

// The source guide is inconsistent about whether "sounds like"/"does NOT
// sound like" values are already wrapped in their own quote marks (some are
// pure quoted taglines, others are descriptive sentences with an embedded
// example quote) — strip any pre-existing surrounding quotes so this
// module can wrap them consistently itself, instead of nesting quotes.
function stripSurroundingQuotes(s: string): string {
  return s.replace(/^["']+|["']+$/g, "").trim();
}

function parseAttributes(content: string): ParsedAttribute[] {
  const section = extractBetween(content, "## 2. Voice Attributes", ["## 3."]);
  if (!section) return [];
  return section
    .split(/^### /m)
    .filter(Boolean)
    .map(block => {
      const name = block.split("\n")[0].trim();
      const soundsLike = stripSurroundingQuotes(block.match(/\*\*Sounds like:\*\*\s*(.+)/)?.[1]?.trim() ?? "");
      const doesNotSoundLike = stripSurroundingQuotes(block.match(/\*\*Does NOT sound like:\*\*\s*(.+)/)?.[1]?.trim() ?? "");
      return { name, soundsLike, doesNotSoundLike };
    })
    .filter(a => a.name && (a.soundsLike || a.doesNotSoundLike));
}

function parseBulletSection(content: string, startMarker: string, endMarkers: string[]): string[] {
  const section = extractBetween(content, startMarker, endMarkers);
  if (!section) return [];
  return section
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.startsWith("-"))
    .map(l => l.replace(/^-\s*/, "").trim());
}

// The 3 hard rules from your Part 2.1.c — the app's own synthesis of the
// guide's spec-anchoring/competitor/superlative rules into fixed prompt
// instructions, not parsed from the guide text (the guide states them as
// prose/watch-outs, not a literal 3-item list to extract verbatim).
const HARD_RULES = [
  'Every claim anchors to a spec or design feature — no generic praise ("high quality", "great performance") standing alone.',
  "Swagger about the tools, never at anyone's expense — never dismiss or name competitors negatively.",
  "No unsubstantiated superlatives — a bold claim needs a real citation/source behind it in this document, or must be softened.",
];

const voiceBlockCache = new Map<string, string>();

export function buildVoiceBlock(guide: ResolvedVoiceGuide): string {
  const cacheKey = `${guide.brand}:${guide.version ?? "fallback"}`;
  const cached = voiceBlockCache.get(cacheKey);
  if (cached) return cached;

  let block: string;
  if (guide.noGuideOnFile) {
    block = `\n\nBRAND VOICE (${guide.brand} — no brand voice guide on file yet, using a neutral professional fallback):\n${guide.content}\n`;
  } else {
    const personality = parsePersonalityLine(guide.content);
    const attributes = parseAttributes(guide.content);
    const avoidTerms = parseBulletSection(guide.content, "**Avoid**", ["## 8.", "---"]);
    const styleRules = parseBulletSection(guide.content, "## 6. Style Rules", ["## 7."]);

    const lines: string[] = [`BRAND VOICE (${guide.brand}, v${guide.version}) — every sentence you write must sound like this brand, never generic marketing copy:`];
    if (personality) lines.push(personality);
    for (const a of attributes) {
      lines.push(`- ${a.name}: sounds like "${a.soundsLike}" — never like "${a.doesNotSoundLike}"`);
    }
    lines.push("Hard rules:");
    HARD_RULES.forEach(r => lines.push(`- ${r}`));
    if (avoidTerms.length) lines.push(`Avoid: ${avoidTerms.join("; ")}`);
    if (styleRules.length) lines.push(`Style: ${styleRules.join(" ")}`);

    block = `\n\n${lines.join("\n")}\n`;
  }

  voiceBlockCache.set(cacheKey, block);
  return block;
}

// ---- Tone spectrum routing ----

const TONE_DIRECTIVES: Record<VoiceContentType, string> = {
  product_detail: "Product detail register: specs-first, benefit-driven, punchy — dial down slang.",
  launch: "Launch register: boldness/hype/culture allowed in the CAPS lead; the body completion stays tech-credible.",
  peer_selling: "Peer-to-peer selling register: confident, warm, price framed plainly.",
  education: "Education register: craft pride + clarity, peer-to-peer teaching, no hype.",
  support: "Support register: warm, patient, plain, human — no attitude, no swagger.",
  corporate: "Corporate register: confident but polished; no street slang; heritage OK.",
  social: "Social register: Fam language allowed, playful, celebrate the pro.",
};

export function getToneDirective(contentType: VoiceContentType): string {
  return TONE_DIRECTIVES[contentType];
}

// Field-id/group-id -> tone-register mapping for GTM fields, matching your
// Part 3 spectrum table exactly.
const TONE_BY_GTM_FIELD_ID: Record<string, VoiceContentType> = {
  positioning_statement: "product_detail",
  product_name_origin: "product_detail",
  name_story_tie: "product_detail",
  reason_to_buy: "product_detail",
  up_sell: "peer_selling",
  rep_talking_point_1: "peer_selling",
  rep_talking_point_2: "peer_selling",
  rep_talking_point_3: "peer_selling",
  our_differentiators: "peer_selling",
  selling_position: "peer_selling",
  expert_tip: "education",
  care_directions: "education",
  box_main_statement: "launch",
};

const TONE_BY_GTM_GROUP_ID: Record<string, VoiceContentType> = {
  features_full_list: "launch",
  top_6_features: "launch",
  box_feature: "launch",
  feature_icons: "launch",
  faq_question: "support",
  faq_answer: "support",
};

export function getToneForGtmField(fieldId: string, groupId?: string): VoiceContentType | null {
  if (TONE_BY_GTM_FIELD_ID[fieldId]) return TONE_BY_GTM_FIELD_ID[fieldId];
  if (groupId && TONE_BY_GTM_GROUP_ID[groupId]) return TONE_BY_GTM_GROUP_ID[groupId];
  return null;
}

// A single chunk of GTM_FIELD_SCHEMA can span multiple tone registers (a
// fixed 4-field chunk mixes grounded specs with written fields from
// different sections) — never one blanket document-wide tone. Dedupes by
// group id so a 10-row group doesn't repeat the same line 10 times.
export function buildToneDirectivesForFields(fields: { id: string; group?: { id: string } }[]): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    const tone = getToneForGtmField(f.id, f.group?.id);
    if (!tone) continue;
    const label = f.group?.id || f.id;
    if (seen.has(label)) continue;
    seen.add(label);
    lines.push(`- For ${label}: ${getToneDirective(tone)}`);
  }
  return lines.length ? `\nTone per field:\n${lines.join("\n")}\n` : "";
}

// "Named technology in full on first use" — no new resolution mechanism,
// wraps the already-existing motorLabel() (lib/gtm-derive.ts), which
// already produces e.g. "Brushless Motor (EON Digital Brushless Motor)".
export function namedTechForFirstUse(motorFamily: string | null | undefined, motorBrandedName: string | null | undefined): string | null {
  return motorLabel(motorFamily, motorBrandedName) || null;
}
