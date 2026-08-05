// Emoji must never appear in generated document content (GTM/Content Form/
// TDS field answers, PDF/export output) — per the brand typography spec's
// icon-system rules. Wired into lib/db/documents.ts's saveDocumentFields(),
// the one shared persistence chokepoint every document type's field-save
// path (AI-generated, derived, or human-edited) funnels through, so this
// applies uniformly without each generator needing its own check.
//
// Range list covers the common emoji blocks (misc symbols/pictographs,
// transport, supplemental symbols, dingbats, variation selectors, the
// regional-indicator flag pairs, and skin-tone modifiers) — deliberately
// NOT matching ordinary punctuation/typographic symbols (·, —, ×, ★ handled
// separately by the icon-system work) that legitimately appear in generated
// copy.
const EMOJI_RANGES = [
  "\u{1F300}-\u{1FAFF}", // misc symbols & pictographs through symbols/extended-A
  "\u{2600}-\u{27BF}", // misc symbols, dingbats
  "\u{1F1E6}-\u{1F1FF}", // regional indicators (flag pairs)
  "\u{2190}-\u{21FF}", // arrows (many emoji-rendered on most platforms)
  "\u{2B00}-\u{2BFF}", // misc symbols and arrows
  "\u{FE0F}", // variation selector-16 (emoji presentation)
  "\u{200D}", // zero-width joiner (multi-codepoint emoji sequences)
  "\u{1F3FB}-\u{1F3FF}", // skin-tone modifiers
].join("");

const EMOJI_RE = new RegExp(`[${EMOJI_RANGES}]`, "gu");

export function containsEmoji(text: string): boolean {
  EMOJI_RE.lastIndex = 0;
  return EMOJI_RE.test(text);
}

// Strips emoji and logs (server-console only, matching this codebase's
// existing lib/obs.ts logCall convention) when something was actually
// removed — callers pass enough context (document id / field id) to trace
// which generation run produced it.
export function stripEmoji(text: string, context?: { documentId?: string; fieldId?: string }): string {
  if (!containsEmoji(text)) return text;
  const stripped = text.replace(EMOJI_RE, "").replace(/ {2,}/g, " ").trim();
  console.warn(
    `[emoji-strip] Removed emoji from generated content${context?.documentId ? ` (document ${context.documentId}` : ""}${context?.fieldId ? `, field ${context.fieldId}` : ""}${context?.documentId ? ")" : ""}`
  );
  return stripped;
}
