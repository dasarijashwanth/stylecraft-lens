// lib/grooming-industry-gate.ts
// Hard, fail-closed grooming/beauty industry gate — runs BEFORE motor/price
// scoring in lib/analysisEngine.ts's selectByCompositeScore/
// filterCandidatesByCategoryAndIdentity. Fixes a real pre-launch bug:
// competitor discovery scored candidates on motor-keyword match alone, with
// zero category/industry awareness, so an "Electric Weed Wacker with Wheel"
// (lawn/garden) and a "Waterproof Brushless DC Motor... for Efoil Electric
// Surfboard" (a bare motor/component) both scored as strong "competitors"
// for a hair clipper. Plain TS, no server imports — fully offline-testable,
// mirrors lib/tool-type-taxonomy.ts's shape.
import type { ToolTypeRow } from "./db/tool-types";
import type { GroomingGateRuleRow } from "./db/grooming-gate-rules";
import type { FeatureComparable } from "./competitor-scoring";
import type { GroomingTag } from "./grooming-tag-taxonomy";
import { assertToolType, textContainsPhrase } from "./tool-type-taxonomy";
import { areTagsCompatible, computeGroomingTagConfidence, DEFAULT_GROOMING_TAG_CONFIDENCE_THRESHOLD } from "./grooming-tag-taxonomy";

export type GroomingGateFailedRule =
  | "block_category"
  | "inconclusive_category_and_keywords"
  | "disqualifying_keyword"
  | "trimmer_missing_cosignal"
  | "tool_type_mismatch"
  | "ambiguous_source"
  | "component_disqualifier"
  | "cross_domain_use_phrase"
  | "missing_structural_spec"
  | "low_same_tool_kind_confidence";

export interface GroomingGateResult {
  ok: boolean;
  reason?: GroomingGateFailedRule;
  detail?: string;
  categoryPath?: string | null;
}

export interface GroomingGateCandidateInput {
  name: string;
  description?: string | null;
  feature_bullets?: string[] | null;
  categories?: string[] | null;
  bestsellers_rank_full?: { category: string }[] | null;
}

export interface GroomingGateOpts {
  stage: "pre_enrichment" | "post_enrichment";
  toolTypes: ToolTypeRow[];
  requiredToolType?: string | null;
  ourIsPetGrooming?: boolean;
  // Only meaningfully available post_enrichment — spec extraction runs
  // synchronously right before the gate call in selectByCompositeScore.
  theirSpecs?: FeatureComparable | null;
  ourSpecs?: FeatureComparable | null;
  ourTag?: GroomingTag | null;
  candidateTag?: GroomingTag | null;
  confidenceThreshold?: number;
}

function rulesByType(rules: GroomingGateRuleRow[], ruleType: string): GroomingGateRuleRow[] {
  return rules.filter(r => r.enabled && r.rule_type === ruleType);
}

function candidateText(candidate: GroomingGateCandidateInput): string {
  return [candidate.name, candidate.description || "", ...(candidate.feature_bullets || [])].join(" ");
}

function candidateCategorySegments(candidate: GroomingGateCandidateInput): string[] {
  return [...(candidate.categories || []), ...(candidate.bestsellers_rank_full || []).map(b => b.category)].filter(Boolean);
}

// Reuses `toolTypes` aliases as the "is this actually named as a grooming
// appliance" co-occurrence check for 1F's component-disqualifier rule — an
// honest keyword-co-occurrence approximation of the ticket's "head noun"
// heuristic, not real NLP, stated as such.
function textNamesAGroomingAppliance(text: string, toolTypes: ToolTypeRow[]): boolean {
  return toolTypes.some(t => t.enabled && t.aliases.some(alias => textContainsPhrase(text, alias)));
}

const STRUCTURAL_NOUNS = ["blade", "guard", "foil", "barrel", "plate", "comb"];

export function passesGroomingIndustryGate(
  candidate: GroomingGateCandidateInput,
  rules: GroomingGateRuleRow[],
  opts: GroomingGateOpts
): GroomingGateResult {
  const text = candidateText(candidate);
  const segments = candidateCategorySegments(candidate);
  const categoryPath = segments.length ? segments.join(" > ") : null;

  // 1A — category gate (only ever resolvable post_enrichment; pre_enrichment
  // candidates structurally have no categories/bestsellers_rank_full yet).
  const blockCategoryRules = rulesByType(rules, "block_category_segment");
  const allowCategoryRules = rulesByType(rules, "allow_category_segment");
  let categoryResolved: "block" | "allow" | "inconclusive" = "inconclusive";
  if (segments.length > 0) {
    if (segments.some(seg => blockCategoryRules.some(r => textContainsPhrase(seg, r.value)))) {
      return { ok: false, reason: "block_category", detail: segments.find(seg => blockCategoryRules.some(r => textContainsPhrase(seg, r.value))), categoryPath };
    }
    if (segments.some(seg => allowCategoryRules.some(r => textContainsPhrase(seg, r.value)))) {
      categoryResolved = "allow";
    }
  }

  // 1B — keyword gate, runs whenever 1A didn't conclusively allow (i.e.
  // always pre_enrichment, and post_enrichment whenever category was
  // absent/unrecognized) — per the ticket's own "no category data -> route
  // to stricter title/keyword check" rule, extended to "unrecognized
  // category" too.
  if (categoryResolved !== "allow") {
    const disqualifyingRules = rulesByType(rules, "disqualifying_keyword").filter(r => !(opts.ourIsPetGrooming && /grooming$/.test(r.value) && /pet|dog|animal/.test(r.value)));
    const disqualifyingHit = disqualifyingRules.find(r => textContainsPhrase(text, r.value));
    if (disqualifyingHit) {
      return { ok: false, reason: "disqualifying_keyword", detail: disqualifyingHit.value, categoryPath };
    }

    const requiredRules = rulesByType(rules, "required_keyword");
    const requiredHits = requiredRules.filter(r => textContainsPhrase(text, r.value));
    if (requiredHits.length === 0) {
      return { ok: false, reason: "inconclusive_category_and_keywords", detail: "no allowlisted category and no required grooming/beauty keyword found", categoryPath };
    }

    const onlyTrimmerHit = requiredHits.length === 1 && requiredHits[0].value.toLowerCase() === "trimmer";
    if (onlyTrimmerHit) {
      const outdoorSignal = blockCategoryRules.some(r => textContainsPhrase(text, r.value)) || ["lawn", "garden", "weed", "grass", "hedge"].some(w => textContainsPhrase(text, w));
      if (outdoorSignal) {
        const cosignalRules = rulesByType(rules, "trimmer_cosignal_keyword");
        const hasCosignal = cosignalRules.some(r => textContainsPhrase(text, r.value));
        if (!hasCosignal) {
          return { ok: false, reason: "trimmer_missing_cosignal", detail: "bare 'trimmer' + outdoor/garden signal, no beard/hair/barber/body co-signal", categoryPath };
        }
      }
    }
  }

  // 1C — tool-type agreement (existing, delegated, one code path).
  if (opts.requiredToolType) {
    const toolTypeResult = assertToolType(text, opts.requiredToolType, opts.toolTypes);
    if (!toolTypeResult.ok) {
      return { ok: false, reason: toolTypeResult.reason === "ambiguous_source" ? "ambiguous_source" : "tool_type_mismatch", categoryPath };
    }
  }

  // 1F — components / non-finished-goods.
  const crossDomainRules = rulesByType(rules, "cross_domain_use_phrase");
  const crossDomainHit = crossDomainRules.find(r => textContainsPhrase(text, r.value));
  if (crossDomainHit) {
    return { ok: false, reason: "cross_domain_use_phrase", detail: crossDomainHit.value, categoryPath };
  }

  const componentRules = rulesByType(rules, "component_disqualifier");
  const componentHit = componentRules.find(r => textContainsPhrase(text, r.value));
  if (componentHit && !textNamesAGroomingAppliance(text, opts.toolTypes)) {
    return { ok: false, reason: "component_disqualifier", detail: componentHit.value, categoryPath };
  }

  if (opts.stage === "post_enrichment" && opts.theirSpecs) {
    const hasMotorEvidence = !!componentHit || /motor/i.test(text);
    const hasStructuralSpec =
      !!opts.theirSpecs.bladeType || !!opts.theirSpecs.cutterName || opts.theirSpecs.zeroGap != null ||
      (opts.theirSpecs.guardCombCount != null && opts.theirSpecs.guardCombCount > 0) ||
      (opts.theirSpecs.lengthSettingsCount != null && opts.theirSpecs.lengthSettingsCount > 0);
    const hasStructuralNoun = STRUCTURAL_NOUNS.some(n => textContainsPhrase(text, n));
    if (hasMotorEvidence && !hasStructuralSpec && !hasStructuralNoun) {
      return { ok: false, reason: "missing_structural_spec", detail: "motor evidence present with no blade/guard/foil/barrel/plate/comb signal", categoryPath };
    }
  }

  // Part 2 — same-tool-kind confidence gate (post_enrichment only, after
  // everything above passes).
  if (opts.stage === "post_enrichment" && opts.ourTag && opts.candidateTag) {
    if (!areTagsCompatible(opts.ourTag, opts.candidateTag)) {
      return { ok: false, reason: "low_same_tool_kind_confidence", detail: `${opts.candidateTag} incompatible with ${opts.ourTag}`, categoryPath };
    }
    const confidence = computeGroomingTagConfidence(opts.ourTag, opts.candidateTag, opts.ourSpecs || {}, opts.theirSpecs || {});
    const threshold = opts.confidenceThreshold ?? DEFAULT_GROOMING_TAG_CONFIDENCE_THRESHOLD;
    if (confidence < threshold) {
      return { ok: false, reason: "low_same_tool_kind_confidence", detail: `confidence ${confidence.toFixed(2)} below threshold ${threshold}`, categoryPath };
    }
  }

  return { ok: true, categoryPath };
}
