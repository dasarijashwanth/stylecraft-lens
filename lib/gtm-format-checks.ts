// lib/gtm-format-checks.ts
// Lightweight, pure format checks for GTM Schema v3's per-field style
// conventions — distinct from lib/gtm-elaboration.ts (depth/length) and
// lib/gtm-reference-exemplars.ts (anti-boilerplate similarity). These check
// the shape of a line, not how long or generic it is: does it lead with an
// ALL-CAPS claim, does it cite a real spec value.
const STOP_WORDS = new Set(["A", "AN", "THE", "OF", "FOR", "TO", "IN", "ON", "WITH", "AND", "OR"]);

// True when the first 1-4 words of the line are ALL CAPS (ignoring a small
// stop-word — "THE"/"OF"/etc. — inside that leading run), matching the
// "CAPS-lead" convention (e.g. "ZERO-GAP PRECISION — cuts closer without
// snagging" or "FULL METAL BODY: won't crack under daily use").
export function hasCapsLead(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const words = trimmed.split(/\s+/);
  const leadWords: string[] = [];
  for (const w of words) {
    if (leadWords.length >= 4) break;
    // A standalone dash/em-dash token ends the lead phrase without itself
    // counting as a word (e.g. "ZERO-GAP PRECISION — cuts closer...").
    if (/^[—-]+$/.test(w)) break;
    const bare = w.replace(/[^A-Za-z]/g, "");
    if (!bare) break; // any other punctuation-only token also ends the lead phrase
    leadWords.push(bare);
    // A word ending in ":" is the last word of the lead phrase (e.g.
    // "FULL METAL BODY: won't crack...").
    if (/:$/.test(w)) break;
  }
  if (leadWords.length === 0) return false;
  return leadWords.every(w => w === w.toUpperCase() && w !== w.toLowerCase());
}

// True when the line cites a real spec value — a number immediately
// followed (or preceded) by a unit/qualifier token, e.g. "7,800rpm",
// "3.5 hours", "1 year warranty". Deliberately permissive on the unit set
// since these lines cover motor/blade/battery/dimension specs alike.
const SPEC_UNIT_PATTERN = /\d[\d,.]*\s?-?\s?(rpm|hour|hr|min|volt|v\b|mm|in\.?|inch|oz|lb|ft|day|year|month|watt|w\b|amp|mah)/i;

export function hasExactSpecValue(line: string): boolean {
  return SPEC_UNIT_PATTERN.test(line);
}
