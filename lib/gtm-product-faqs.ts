// lib/gtm-product-faqs.ts
// GTM workbook export work, Part 3 — 10 auto-generated Product FAQs +
// Our Differentiators/Selling Position/Rep Talking Points, run as the new
// "faqs" pipeline phase (lib/project-generation-engine.ts) strictly after
// GTM's own fields have resolved, so every fact this grounds against is
// already-confirmed GTM data, not raw analysis output. OpenAI only — every
// other GTM field already goes through this same callAiForJson pipeline;
// Anthropic/Claude was removed from this codebase after its account ran
// out of credit balance and isn't reintroduced for this one feature.
import { callAiForJson } from "./ai-json-call";
import { GtmFieldAnswer } from "./gtm-field-schema";
import { isRealAnswer } from "./field-answer-state";
import type { GtmSources } from "./gtm-generate";
import { getToneDirective } from "./brand-voice";
import { checkVoiceCompliance, buildVoiceCorrectionInstruction } from "./ai-generation-guard";

// The GTM fields that count as "grounded facts" for FAQ writing — features,
// motor, blades, guards, charging, care, warranty/certification — matching
// the spec's own input list (compatibility is covered by blades/guards,
// "who it's for" by core_consumer, already folded into the prompt itself).
const GROUNDED_FACT_FIELD_IDS = [
  ...Array.from({ length: 10 }, (_, i) => `features_full_list_${i + 1}`),
  "core_consumer",
  "motor_type", "motor_rpm", "motor_run_time", "motor_recharge_time", "motor_speed", "motor_noise_level",
  "blade_name", "fixed_blade", "cutting_blade",
  "lever_type", "guards_type", "guards_qty", "guards_color",
  "charging_port", "charging_cord_length", "charging_voltage", "charging_led_function",
  "care_directions", "warranty", "certification_needed",
];

function buildGroundedFactsBlock(gtmFields: Record<string, string>): string {
  return GROUNDED_FACT_FIELD_IDS
    .filter(id => isRealAnswer(gtmFields[id]))
    .map(id => `${id}: ${gtmFields[id]}`)
    .join("\n");
}

interface CompetitorLike {
  name?: string;
  brand?: string;
  top_positive_review_themes?: string[];
  top_negative_review_themes?: string[];
}

function collectCompetitors(competitiveAnalysis: any): CompetitorLike[] {
  return [...(competitiveAnalysis?.large_brand_competitors || []), ...(competitiveAnalysis?.indie_emerging_competitors || [])];
}

// Built directly from THIS analysis's own resolved competitor set (name +
// brand, confirmed real fields on every competitor row — lib/db/reports.ts's
// saveAnalysisCompetitors) rather than a separate legacy-brand-registry
// lookup — more precise for "never name a brand the buyer would actually be
// comparing against" than a generic global brand list, and needs no extra
// identity-card resolution the FAQ phase doesn't otherwise have.
function collectBrandTokens(competitors: CompetitorLike[]): string[] {
  const tokens = new Set<string>();
  for (const c of competitors) {
    if (c.brand) tokens.add(c.brand.trim().toLowerCase());
    if (c.name) tokens.add(c.name.trim().toLowerCase());
  }
  return Array.from(tokens).filter(t => t.length > 2);
}

function findBrandNameIn(text: string, brandTokens: string[]): string | null {
  const lower = text.toLowerCase();
  return brandTokens.find(t => lower.includes(t)) ?? null;
}

interface FaqPair {
  question: string;
  answer: string;
}

async function callFaqGeneration(
  productName: string,
  factsBlock: string,
  reviewThemes: string[],
  voiceBlock: string,
  retryInstruction?: string
): Promise<FaqPair[]> {
  const systemInstruction = `Write 10 consumer/barber FAQs for ${productName}. Cover, at minimum: 1-2 usage/technique questions, battery/charging, blade care/maintenance and replacement, compatibility (blades/guards/ecosystem), warranty/support, who it's for (pro vs home), noise/comfort where relevant, and 1-2 differentiation questions a buyer comparing it to competitors would ask (informed by the category review themes below — never name competitor brands in answers; frame as category comparisons). Answers: 2-4 sentences, factual, grounded ONLY in the facts below. Each question must read like a real customer question.

FACTS:
${factsBlock}

CATEGORY REVIEW THEMES (for framing differentiation questions only — never state these as our own product's claims):
${reviewThemes.length ? reviewThemes.join("; ") : "(none available)"}
${retryInstruction ? `\n${retryInstruction}` : ""}

Return ONLY valid JSON: { "faqs": [{ "question": "...", "answer": "..." }] } — exactly 10 entries.${voiceBlock}\n${getToneDirective("support")}`;

  const raw = await callAiForJson<{ faqs?: FaqPair[] }>(systemInstruction, `Product: ${productName}`, "GTM-ProductFAQs", { timeoutMs: 30_000 });
  return (raw?.faqs || []).filter(f => f && typeof f.question === "string" && typeof f.answer === "string").slice(0, 10);
}

async function deriveDifferentiatorsAndTalkingPoints(
  productName: string,
  reasonToBuy: string,
  brandTokens: string[],
  voiceBlock: string
): Promise<Record<string, GtmFieldAnswer>> {
  const systemInstruction = `From these confirmed selling points for ${productName}:
${reasonToBuy}

Produce:
1. "differentiators": 3-5 short bullet phrases — grounded only in the selling points above, no competitor brand names, framed as category comparisons where relevant.
2. "talking_points": exactly 3 one-line rep talking points, each condensing one of the top selling points into a single confident sales line.

Return ONLY valid JSON: { "differentiators": ["..."], "talking_points": ["...", "...", "..."] }${voiceBlock}\n${getToneDirective("peer_selling")}`;

  const raw = await callAiForJson<{ differentiators?: string[]; talking_points?: string[] }>(
    systemInstruction,
    `Product: ${productName}`,
    "GTM-DifferentiatorsTalkingPoints",
    { timeoutMs: 20_000 }
  );

  const result: Record<string, GtmFieldAnswer> = {};
  const cleanDiffs = (raw?.differentiators || []).filter(d => typeof d === "string" && d.trim() && !findBrandNameIn(d, brandTokens));
  if (cleanDiffs.length > 0) {
    const check = checkVoiceCompliance(cleanDiffs.map(d => `• ${d.trim()}`).join("\n"), "peer_selling");
    result["our_differentiators"] = {
      answer: check.text,
      source: "derived",
      flagged: check.violations.length > 0,
      sourceDetail: check.violations.length > 0
        ? { reason: "voice_violation", voiceReview: true, voiceViolations: check.violations.map(v => v.rule) }
        : (check.autoFixed ? { voiceAutoFixed: true } : undefined),
    };
  }

  const cleanPoints = (raw?.talking_points || []).filter(p => typeof p === "string" && p.trim() && !findBrandNameIn(p, brandTokens)).slice(0, 3);
  cleanPoints.forEach((p, i) => {
    const check = checkVoiceCompliance(p.trim(), "peer_selling");
    result[`rep_talking_point_${i + 1}`] = {
      answer: check.text,
      source: "derived",
      flagged: check.violations.length > 0,
      sourceDetail: check.violations.length > 0
        ? { reason: "voice_violation", voiceReview: true, voiceViolations: check.violations.map(v => v.rule) }
        : (check.autoFixed ? { voiceAutoFixed: true } : undefined),
    };
  });

  return result;
}

// Single retry attempt for any FAQ answer that names a known competitor
// brand — same one-retry discipline as lib/gtm-generate.ts's
// guardWrittenFieldsQuality anti-copy check. An answer still violating after
// the retry ships flagged (never silently, and never dropped) rather than
// blocking the other 9 real FAQs.
export async function generateProductFaqs(
  sources: GtmSources,
  gtmFields: Record<string, string>,
  voiceBlock: string = ""
): Promise<Record<string, GtmFieldAnswer>> {
  const result: Record<string, GtmFieldAnswer> = {};
  const productName = sources.project.productName;
  const factsBlock = buildGroundedFactsBlock(gtmFields);
  const competitors = collectCompetitors(sources.activeReport?.competitive_analysis);
  const brandTokens = collectBrandTokens(competitors);
  const reviewThemes = competitors
    .flatMap(c => [...(c.top_positive_review_themes || []), ...(c.top_negative_review_themes || [])])
    .slice(0, 10);

  if (factsBlock) {
    const faqs = await callFaqGeneration(productName, factsBlock, reviewThemes, voiceBlock);
    const voiceChecks = faqs.map(f => checkVoiceCompliance(f.answer, "support"));
    faqs.forEach((f, i) => { f.answer = voiceChecks[i].text; });

    const violatingIndices = faqs
      .map((f, i) => ({ i, brand: findBrandNameIn(f.answer, brandTokens), voice: voiceChecks[i].violations }))
      .filter(v => v.brand || v.voice.length > 0);

    if (violatingIndices.length > 0) {
      const combinedInstructions = [
        violatingIndices.some(v => v.brand) &&
          "The previous draft named a specific competitor brand in at least one answer — describe the category/alternative generically instead, never name a brand.",
        violatingIndices.some(v => v.voice.length > 0) &&
          buildVoiceCorrectionInstruction(violatingIndices.flatMap(v => v.voice)),
      ].filter(Boolean).join(" ");
      const retryFaqs = await callFaqGeneration(productName, factsBlock, reviewThemes, voiceBlock, combinedInstructions);
      violatingIndices.forEach(v => {
        const replacement = retryFaqs[v.i];
        if (!replacement) return;
        const replacementCheck = checkVoiceCompliance(replacement.answer, "support");
        if (!findBrandNameIn(replacement.answer, brandTokens) && replacementCheck.violations.length === 0) {
          faqs[v.i] = { question: replacement.question, answer: replacementCheck.text };
          voiceChecks[v.i] = replacementCheck;
        }
      });
    }

    faqs.forEach((f, i) => {
      const idx = i + 1;
      const stillBrandViolating = findBrandNameIn(f.answer, brandTokens);
      const stillVoiceViolating = voiceChecks[i].violations;
      const stillFlagged = !!stillBrandViolating || stillVoiceViolating.length > 0;
      result[`faq_question_${idx}`] = { answer: f.question, source: "derived" };
      result[`faq_answer_${idx}`] = {
        answer: f.answer,
        source: "derived",
        flagged: stillFlagged,
        sourceDetail: stillFlagged
          ? {
              reason: stillBrandViolating ? "possible-competitor-brand-name" : "voice_violation",
              brand: stillBrandViolating || undefined,
              voiceReview: stillVoiceViolating.length > 0 ? true : undefined,
              voiceViolations: stillVoiceViolating.length > 0 ? stillVoiceViolating.map(v => v.rule) : undefined,
            }
          : (voiceChecks[i].autoFixed ? { voiceAutoFixed: true } : undefined),
      };
    });
  }

  // Selling Position — reuses the EXACT pre-computed sentence the Pricing
  // Analysis section already built (lib/pricing-analysis.ts's
  // buildPricePositioningSentence), never a fresh AI claim about pricing.
  const positioning = sources.activeReport?.pricing_analysis?.price_positioning;
  if (positioning) {
    result["selling_position"] = { answer: positioning, source: "active_report" };
  }

  const reasonToBuy = gtmFields["reason_to_buy"];
  if (isRealAnswer(reasonToBuy)) {
    Object.assign(result, await deriveDifferentiatorsAndTalkingPoints(productName, reasonToBuy, brandTokens, voiceBlock));
  }

  return result;
}
