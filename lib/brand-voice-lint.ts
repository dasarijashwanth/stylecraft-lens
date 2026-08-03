// lib/brand-voice-lint.ts
// Automated Voice Lint, Part 4 — deterministic rules only, no AI, no
// external state. Content-type-aware since several rules (CAPS placement,
// "users"/"consumers", "the Fam"/"drop") are register-conditional, not
// universal bans — see lib/brand-voice.ts's VoiceContentType/tone spectrum.
import { VoiceContentType } from "./brand-voice";

export interface VoiceFix {
  rule: string;
  before: string;
  after: string;
}

export interface DeterministicFixResult {
  text: string;
  fixes: VoiceFix[];
}

// S|C standardization — the guide's own watch-out ("Product listings show
// variants ('SIC Pro' mat). Standardize on S|C.") is the one rule that's
// safe to auto-fix rather than merely flag: it's a pure find-replace with
// no risk of changing meaning.
export function applyDeterministicFixes(text: string): DeterministicFixResult {
  const fixes: VoiceFix[] = [];
  let result = text;

  const sicMatch = result.match(/\bSIC\b/);
  if (sicMatch) {
    fixes.push({ rule: "sc_standardization", before: sicMatch[0], after: "S|C" });
    result = result.replace(/\bSIC\b/g, "S|C");
  }
  const scMatch = result.match(/\bSC\b(?!\|)/);
  if (scMatch) {
    fixes.push({ rule: "sc_standardization", before: scMatch[0], after: "S|C" });
    result = result.replace(/\bSC\b(?!\|)/g, "S|C");
  }

  return { text: result, fixes };
}

const CAPS_PERMITTED_CONTENT_TYPES: VoiceContentType[] = ["launch"];

// Content-type-conditional word lists — these are only violations OUTSIDE
// their sanctioned register (per the guide's own terminology table).
const COMMUNITY_ONLY_TERMS = ["the fam", "drop", "new drop"];

const BANNED_PHRASES = [
  { phrase: "valued customer", rule: "corporate_distance" },
  { phrase: "valued customers", rule: "corporate_distance" },
  { phrase: "our organization", rule: "corporate_distance" },
];

const GENERIC_PRAISE_PHRASES = ["high quality", "great performance"];
const SUPERLATIVE_PATTERNS = [
  /\bbest in the world\b/i,
  /\bfastest (?:ever|growing)\b/i,
  /\b#1\b/,
  /\bsince the industrial revolution\b/i,
  /\brivaling billion-dollar\b/i,
];

export interface LintViolation {
  rule: string;
  detail: string;
}

// `hasCitation` — whether THIS specific field/answer already has a real
// citation/source attached (e.g. sourceDetail.conflict-free web citation) —
// a superlative is only a violation when nothing backs it.
export function findDeterministicViolations(
  text: string,
  contentType: VoiceContentType,
  opts?: { hasCitation?: boolean }
): LintViolation[] {
  const violations: LintViolation[] = [];
  const lower = text.toLowerCase();

  for (const { phrase, rule } of BANNED_PHRASES) {
    if (lower.includes(phrase)) violations.push({ rule, detail: phrase });
  }

  // Generic praise is only a violation when NO spec/number appears in the
  // same sentence — "great performance — 7,800rpm brushless motor" is
  // spec-anchored and fine; "great performance" alone is not.
  const hasSpecNearby = /\d/.test(text);
  for (const phrase of GENERIC_PRAISE_PHRASES) {
    if (lower.includes(phrase) && !hasSpecNearby) {
      violations.push({ rule: "unanchored_generic_praise", detail: phrase });
    }
  }

  if (lower.includes("cutting-edge") && !/\b[A-Z][a-zA-Z0-9]*\s+(?:Motor|Technology|Blade)\b/.test(text)) {
    violations.push({ rule: "unanchored_generic_praise", detail: "cutting-edge" });
  }

  if (contentType !== "corporate") {
    if (/\busers?\b/i.test(text) || /\bconsumers?\b/i.test(text)) {
      violations.push({ rule: "wrong_terminology", detail: "users/consumers outside corporate register" });
    }
  }

  const exclamationCount = (text.match(/!/g) || []).length;
  if (exclamationCount > 1) {
    violations.push({ rule: "too_many_exclamations", detail: `${exclamationCount} exclamation marks (max 1)` });
  }

  if (!CAPS_PERMITTED_CONTENT_TYPES.includes(contentType)) {
    // A "run" = 2+ consecutive all-caps words (3+ letters each, to avoid
    // flagging acronyms like "USB" or "LED" on their own) — a real
    // ALL-CAPS phrase/sentence, not just one abbreviation.
    const capsRun = text.match(/\b[A-Z]{3,}(?:\s+[A-Z]{3,}){1,}\b/);
    if (capsRun) violations.push({ rule: "caps_outside_launch", detail: capsRun[0] });
  }

  if (contentType !== "social") {
    for (const term of COMMUNITY_ONLY_TERMS) {
      if (lower.includes(term)) violations.push({ rule: "community_term_outside_social", detail: term });
    }
  }

  if (!opts?.hasCitation) {
    for (const pattern of SUPERLATIVE_PATTERNS) {
      const match = text.match(pattern);
      if (match) violations.push({ rule: "uncited_superlative", detail: match[0] });
    }
  }

  return violations;
}
