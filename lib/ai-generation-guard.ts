// lib/ai-generation-guard.ts
// Shared voice-guard retry core — generalizes the detect -> single retry ->
// re-validate -> ship-or-flag shape lib/gtm-generate.ts's own
// guardWrittenFieldsQuality already uses for its 4 quality checks (and
// lib/gtm-product-faqs.ts's own brand-name-violation retry already uses
// ad hoc), so lib/gtm-product-faqs.ts/lib/gtm-box-only.ts/the Sales Kit
// route don't each hand-roll a bespoke retry loop for the voice check.
// GTM's guardWrittenFieldsQuality adds its voice check directly into its
// own existing loop instead of routing through this module — it already
// has an equivalent shape, see that function's own comments.
import { VoiceContentType } from "./brand-voice";
import { applyDeterministicFixes, findDeterministicViolations, LintViolation } from "./brand-voice-lint";
import { callOpenAiForJson } from "./openai";

export interface VoiceCheckResult {
  text: string;
  violations: LintViolation[];
  autoFixed: boolean;
}

// Applies the always-safe auto-fixes (S|C standardization) then checks for
// remaining violations. Call on a fresh generation result before deciding
// whether a retry is warranted.
export function checkVoiceCompliance(
  text: string,
  contentType: VoiceContentType,
  opts?: { hasCitation?: boolean }
): VoiceCheckResult {
  const fixed = applyDeterministicFixes(text);
  const violations = findDeterministicViolations(fixed.text, contentType, opts);
  return { text: fixed.text, violations, autoFixed: fixed.fixes.length > 0 };
}

export function buildVoiceCorrectionInstruction(violations: LintViolation[]): string {
  const detail = violations.map(v => `${v.rule} ("${v.detail}")`).join("; ");
  return `The previous draft violated brand voice rules: ${detail}. Rewrite it to fix these specific issues — keep every fact/spec/number exactly as given, change only the voice/tone problem.`;
}

export interface VoiceGuardOutcome {
  text: string;
  flagged: boolean;
  sourceDetail: Record<string, any>;
}

function outcomeFor(result: VoiceCheckResult): VoiceGuardOutcome {
  if (result.violations.length === 0) {
    return { text: result.text, flagged: false, sourceDetail: result.autoFixed ? { voiceAutoFixed: true } : {} };
  }
  return {
    text: result.text,
    flagged: true,
    sourceDetail: {
      voiceReview: true,
      voiceViolations: result.violations.map(v => v.rule),
      ...(result.autoFixed ? { voiceAutoFixed: true } : {}),
    },
  };
}

// One-shot retry-with-validation for a single piece of text. `regenerate`
// is the caller's own AI call, bound so a correction instruction can be
// folded into whatever prompt it already builds. Ships the clean retry, or
// the deterministically-fixed original flagged for review — never blocks.
export async function runVoiceGuardedText(
  initialText: string,
  contentType: VoiceContentType,
  regenerate: (correctionInstruction: string) => Promise<string | null>,
  opts?: { hasCitation?: boolean; skipRetry?: boolean }
): Promise<VoiceGuardOutcome> {
  const first = checkVoiceCompliance(initialText, contentType, opts);
  if (first.violations.length === 0 || opts?.skipRetry) return outcomeFor(first);

  const retryRaw = await regenerate(buildVoiceCorrectionInstruction(first.violations));
  if (retryRaw) {
    const retry = checkVoiceCompliance(retryRaw, contentType, opts);
    if (retry.violations.length === 0) return outcomeFor(retry);
  }
  return outcomeFor(first);
}

// Batched fast-model compliance pass — one call covering several already
// deterministic-clean texts, catching tone/register mismatches the
// deterministic rules can't (e.g. technically-clean text that still reads
// off-brand for its assigned register). Never blocks the pipeline: a
// missing API key, timeout, or parse failure just yields no findings.
export interface FastVoiceCheckItem {
  id: string;
  text: string;
  contentType: VoiceContentType;
  voiceBlock: string;
}

export interface FastVoiceCheckFinding {
  violatedAttribute: string;
  rewrite?: string;
}

export async function runFastVoiceComplianceBatch(items: FastVoiceCheckItem[]): Promise<Map<string, FastVoiceCheckFinding>> {
  const findings = new Map<string, FastVoiceCheckFinding>();
  if (items.length === 0) return findings;

  const system = `You check short pieces of product/marketing copy against a brand voice guide and an assigned tone register. For each item, decide whether the text matches the voice attributes AND its tone register. Return ONLY strict JSON: {"results": [{"id": "...", "pass": true|false, "violatedAttribute": "...", "rewrite": "..."}]}. Omit "violatedAttribute"/"rewrite" when pass is true. When pass is false, "rewrite" must preserve every fact/number/spec exactly and stay close to the original length — fix only the voice/tone problem. Never invent a violation just to have something to say — most well-written copy should pass.`;
  const user = items
    .map(it => `ID: ${it.id}\nTONE REGISTER: ${it.contentType}\n${it.voiceBlock}\n\nTEXT:\n"""${it.text}"""`)
    .join("\n\n---\n\n");

  const response = await callOpenAiForJson<{ results?: { id: string; pass: boolean; violatedAttribute?: string; rewrite?: string }[] }>(
    system,
    user,
    "voice-compliance-batch",
    { timeoutMs: 15_000 }
  );
  for (const r of response?.results || []) {
    if (r && r.id && r.pass === false) {
      findings.set(r.id, { violatedAttribute: r.violatedAttribute || "voice mismatch", rewrite: r.rewrite });
    }
  }
  return findings;
}
