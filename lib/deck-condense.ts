// lib/deck-condense.ts
// Length-fitting for deck text tokens that exceed their admin-set
// max_length. The only AI call this feature makes — a single "shorten to
// fit, preserve every fact" instruction, never new free-writing. Any
// failure/timeout/still-too-long result falls back to a deterministic
// word-boundary truncate, so a slow or broken OpenAI call can never hang
// or fail deck generation.
import { callOpenAiForJson } from "./openai";

// Up-front budget check (mirrors lib/gtm-generate.ts's guardWrittenFieldsQuality
// "flag as-is on timeout" discipline) — past this, skip AI entirely and
// truncate everything deterministically rather than risk pushing deck
// generation past Vercel's 60s function ceiling.
export const DECK_CONDENSE_TIME_BUDGET_MS = 20_000;

const NUMERIC_CHAR = /[0-9.,$%]/;

// Deterministic, never-fails fallback: cuts at the nearest word boundary at
// or before maxLength, and never inside a run of digits/currency/percent
// characters (so "$149.99" never becomes "$149.9"). Appends an ellipsis
// only when text actually got shorter.
export function truncateDeterministic(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;

  let cut = maxLength;
  if (NUMERIC_CHAR.test(trimmed[cut - 1] || "") && NUMERIC_CHAR.test(trimmed[cut] || "")) {
    while (cut > 0 && NUMERIC_CHAR.test(trimmed[cut - 1] || "")) cut--;
  }
  while (cut > 0 && !/\s/.test(trimmed[cut] || " ") && !/\s/.test(trimmed[cut - 1] || " ")) cut--;

  const sliced = trimmed.slice(0, cut).replace(/[\s.,;:-]+$/, "").trim();
  return sliced ? `${sliced}…` : trimmed.slice(0, maxLength);
}

interface CondenseTask {
  token: string;
  text: string;
  maxLength: number;
}

async function condenseOne(task: CondenseTask): Promise<string> {
  const system =
    "You condense marketing copy for a slide so it fits a strict character budget. " +
    "Preserve every fact and number exactly as given — never invent, add, or change any claim, number, or spec. " +
    "Preserve the original text's tone and register too — don't flatten confident/warm brand voice into generic corporate phrasing just to save characters. " +
    'Only shorten wording. Return strict JSON: {"condensed": string}.';
  const user = `Shorten the following text to ${task.maxLength} characters or fewer, preserving every fact and number exactly:\n\n"""${task.text}"""`;

  const result = await callOpenAiForJson<{ condensed?: string }>(system, user, `deck-condense:${task.token}`, { timeoutMs: 10_000 });
  const condensed = result?.condensed?.trim();
  if (condensed && condensed.length <= task.maxLength) return condensed;
  return truncateDeterministic(task.text, task.maxLength);
}

// Condenses every text value whose admin-set max_length is exceeded, all
// concurrently. `budgetStart` should be the deck generation run's own start
// time (Date.now() at the top of generateProjectDeck), not this call's own
// start, so the budget reflects total time spent so far, not just this step.
export async function condenseDeckText(
  values: Record<string, string>,
  maxLengths: Record<string, number | undefined>,
  budgetStart: number
): Promise<Record<string, string>> {
  const tasks: CondenseTask[] = [];
  for (const [token, text] of Object.entries(values)) {
    const maxLength = maxLengths[token];
    if (maxLength && text.length > maxLength) tasks.push({ token, text, maxLength });
  }
  if (tasks.length === 0) return values;

  const overBudget = Date.now() - budgetStart > DECK_CONDENSE_TIME_BUDGET_MS;
  const results = await Promise.all(
    tasks.map(task => (overBudget ? Promise.resolve(truncateDeterministic(task.text, task.maxLength)) : condenseOne(task)))
  );

  const out: Record<string, string> = { ...values };
  tasks.forEach((task, i) => { out[task.token] = results[i]; });
  return out;
}
