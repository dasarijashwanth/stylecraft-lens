// Minimum-depth guardrail for GTM's narrative fields — a one-word or
// single-clause answer for "positioning statement" or "reason to buy"
// technically isn't wrong, but it's not what a real product marketing
// team would ship. Only the genuinely narrative fields get a bar; short
// factual "written" fields (core_consumer, new_line_or_current,
// new_technology) are meant to be short and are exempt.
const ELABORATION_MIN_WORDS: Record<string, number> = {
  why_creating_item: 30,
  positioning_statement: 40,
  product_name_origin: 12,
  name_story_tie: 12,
  reason_to_buy: 40,
  expert_tip: 12,
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function meetsElaborationBar(fieldId: string, answer: string): boolean {
  const minWords = ELABORATION_MIN_WORDS[fieldId];
  if (!minWords) return true; // no bar for this field
  if (!answer || answer.toUpperCase() === "N/A") return true; // grounding/N-A handled elsewhere
  return wordCount(answer) >= minWords;
}
