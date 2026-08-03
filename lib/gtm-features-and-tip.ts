// lib/gtm-features-and-tip.ts
// Tier 6.5 — Features (full list) 3-source merge (Change 3) + Expert Tip
// generated from the now-resolved Features (Change 4). Both need real AI
// calls (unlike lib/gtm-tier6-inference.ts's pure functions), so they live
// in their own module, run after Tier 6 in lib/gtm-generate.ts so
// Expert Tip has a real resolved Features list to ground against.
//
// Diagnosis for why features_full_list was chronically empty (Change 3):
// the old Tier-1 fill (lib/gtm-derive.ts) only ever read
// salesKit?.key_features — a Sales Kit project OUTPUT that frequently
// doesn't exist yet for a given project (Sales Kit generates separately,
// later, with no guarantee it exists before GTM's first run). When absent,
// the field fell straight through to the generic whole-document AI call
// with no field-specific instruction (unlike expert_tip, which already had
// one) and no deterministic floor to catch the miss — riding entirely on
// general AI reliability with zero redundancy. Fixed here with a
// deterministic floor that never depends on the Sales Kit existing at all,
// plus an AI competitor-informed top-up only when still short.
import { callAiForJson } from "./ai-json-call";
import { GtmField, GtmFieldAnswer } from "./gtm-field-schema";
import { isRealAnswer } from "./field-answer-state";
import { extractOurSpecsFromTds } from "./spec-extraction";
import type { FeatureComparable } from "./competitor-scoring";
import { matchesDifferentiator } from "./differentiator-match";
import type { CompetitorSpecSource } from "./gtm-tier6-inference";
import type { GtmSources } from "./gtm-generate";

export type FeatureBulletSource = "input" | "our_listing" | "competitor_informed" | "unconfirmed";
export interface FeatureBullet {
  text: string;
  source: FeatureBulletSource;
}

const SOURCE_TAGS: Record<FeatureBulletSource, string> = {
  input: "Input",
  our_listing: "Our listing",
  competitor_informed: "Competitor-informed",
  unconfirmed: "Unconfirmed",
};

function dedupeAgainst(existing: string[], candidate: string): boolean {
  const lc = candidate.toLowerCase();
  return existing.some(e => {
    const el = e.toLowerCase();
    return el.includes(lc) || lc.includes(el);
  });
}

// Source #1 — our own input: the catalog/product description's "3 main
// callouts", split on commas/semicolons (how these short phrase lists are
// actually written — see lib/memoryDb.ts's seedCatalogProductDefaults).
function buildInputBullets(description: string | null | undefined): string[] {
  if (!description) return [];
  return description.split(/[,;]/).map(s => s.trim()).filter(s => s.length > 3);
}

// Source #2 — our own listing: spec-derived sentences from TDS's own
// motor/blade/heat-tech fields (no dedicated TDS "feature_bullets" array
// field exists — product_description is the closest real analog to a raw
// Amazon feature-bullets list, so its sentences count as "our listing" too).
const TDS_SPEC_BULLET_FIELDS: { id: string; format: (v: string) => string }[] = [
  { id: "motor_type", format: v => v },
  { id: "motor_rpm", format: v => `${v} motor speed` },
  { id: "motor_run_time", format: v => `${v} run time` },
  { id: "blade_name", format: v => `${v} blade` },
  { id: "material", format: v => `${v} construction` },
  { id: "plate_material", format: v => `${v} plates` },
  { id: "heater_type", format: v => `${v} heating element` },
  { id: "max_temp_class", format: v => `Up to ${v} heat` },
];

function buildOurListingBullets(tds: Record<string, string> | null): string[] {
  if (!tds) return [];
  const bullets: string[] = [];
  for (const { id, format } of TDS_SPEC_BULLET_FIELDS) {
    const v = tds[id];
    if (isRealAnswer(v)) bullets.push(format(v));
  }
  if (isRealAnswer(tds.product_description)) {
    const sentences = tds.product_description!.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 12);
    bullets.push(...sentences.slice(0, 4));
  }
  return bullets;
}

// GTM Schema v3 — Features (full list) is a 10-row repeatable group
// (features_full_list_1..10, see lib/gtm-field-schema.ts's groupFields)
// rather than one multi-line field. Each bullet becomes its own row/answer,
// tagged with its source exactly like before; trailing unused rows are
// simply never written (lib/gtm-group-fields.ts trims them from CSV/PDF).
export const FEATURES_FULL_LIST_GROUP_SIZE = 10;

function renderFeatureRowAnswer(bullet: FeatureBullet): string {
  return `${bullet.text} [${SOURCE_TAGS[bullet.source]}]`;
}

function stripSourceTag(rowAnswer: string): string {
  return rowAnswer.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
}

// Deterministic floor — never depends on the Sales Kit or an AI call
// succeeding. Returns null only when literally nothing is available from
// either the catalog input or TDS (a brand-new project with no data yet).
export function deriveFeaturesFullListDeterministic(
  catalogDescription: string | null | undefined,
  tds: Record<string, string> | null
): FeatureBullet[] {
  const inputBullets = buildInputBullets(catalogDescription);
  const listingBulletsRaw = buildOurListingBullets(tds);
  const listingBullets = listingBulletsRaw.filter(b => !dedupeAgainst(inputBullets, b));

  return [
    ...inputBullets.map((text): FeatureBullet => ({ text, source: "input" })),
    ...listingBullets.map((text): FeatureBullet => ({ text, source: "our_listing" })),
  ];
}

const FEATURE_TARGET_COUNT = 6;

interface CompetitorTopUpBullet { text: string; confirmed: boolean }

// Source #3 — competitor-informed top-up. Only called when still short of
// ~6 bullets after the deterministic floor. Phrases a competitor-mentioned
// feature as OUR spec-grounded equivalent ONLY where our own specs confirm
// it; anything unconfirmed is tagged "Category-expected (confirm): …" and
// flagged, never stated as fact.
async function topUpFeaturesWithCompetitors(
  productName: string,
  existingBullets: FeatureBullet[],
  ourSpecs: FeatureComparable,
  competitors: CompetitorSpecSource[]
): Promise<FeatureBullet[]> {
  if (existingBullets.length >= FEATURE_TARGET_COUNT || competitors.length === 0) return [];

  const competitorFeatureText = competitors
    .slice(0, 5)
    .map(c => (c.feature_bullets || []).join("; "))
    .filter(Boolean)
    .join("\n");
  if (!competitorFeatureText) return [];

  const needed = FEATURE_TARGET_COUNT - existingBullets.length;
  const systemInstruction = `You are extracting product features for "${productName}", a real physical product. You are given OUR product's CONFIRMED specs and features mentioned in COMPETITOR listings in the same category/price band.

Produce up to ${needed} ADDITIONAL feature bullets not already covered by the "ALREADY LISTED" set below.

Rules:
- If a competitor-mentioned feature is CONFIRMED by our own specs (a matching value), phrase it as OUR spec-grounded equivalent (e.g. competitor "cordless 3hr runtime" + our spec "3.5h run time" -> "Up to 3.5 hours cordless run time"), and set confirmed: true.
- If NOT confirmed by our specs, phrase it plainly as the feature itself (do not add any prefix yourself) and set confirmed: false.
- Never invent a spec value we don't have. Never state an unconfirmed feature as settled fact.

Return ONLY valid JSON: { "bullets": [{ "text": "...", "confirmed": true|false }] }`;

  const userContent = `OUR CONFIRMED SPECS: ${JSON.stringify(ourSpecs)}
ALREADY LISTED (do not repeat): ${existingBullets.map(b => b.text).join("; ") || "(none)"}
COMPETITOR FEATURES:
${competitorFeatureText}`;

  const raw = await callAiForJson<{ bullets?: CompetitorTopUpBullet[] }>(systemInstruction, userContent, "GTM-Features-TopUp", { timeoutMs: 20_000 });
  if (!raw?.bullets?.length) return [];

  return raw.bullets
    .filter(b => b && typeof b.text === "string" && b.text.trim())
    .slice(0, needed)
    .map((b): FeatureBullet =>
      b.confirmed
        ? { text: b.text.trim(), source: "competitor_informed" }
        : { text: `Category-expected (confirm): ${b.text.trim()}`, source: "unconfirmed" }
    );
}

// Returns the merged bullet list (deterministic floor + AI competitor
// top-up when still short), capped at the group's row count — the caller
// (applyFeaturesAndExpertTip) writes one bullet per row.
export async function deriveFeaturesFullList(sources: GtmSources): Promise<FeatureBullet[]> {
  const floor = deriveFeaturesFullListDeterministic(sources.project.description, sources.tds);
  const ca = sources.activeReport?.competitive_analysis || {};
  const competitors: CompetitorSpecSource[] = [...(ca.large_brand_competitors || []), ...(ca.indie_emerging_competitors || [])];
  const ourSpecs = extractOurSpecsFromTds(sources.tds);

  const topUp = await topUpFeaturesWithCompetitors(sources.project.productName, floor, ourSpecs, competitors);
  return [...floor, ...topUp].slice(0, FEATURES_FULL_LIST_GROUP_SIZE);
}

// CHANGE 4 — Expert Tip, generated FROM the now-resolved Features (never
// the other way around) so it can only ever reference a feature that's
// actually in the sheet. Grounding is bespoke (written-kind fields are
// otherwise exempt from lib/gtm-grounding.ts's generic verifyGrounding) —
// reuses lib/differentiator-match.ts's matchesDifferentiator token-overlap
// check rather than a new implementation, treating the referenced feature
// text as the "differentiator" the tip must genuinely be about.
async function generateExpertTip(productName: string, confirmedFeatureLines: string[]): Promise<string | null> {
  if (confirmedFeatureLines.length === 0) return null;
  const topFeatures = confirmedFeatureLines.slice(0, 3);

  const systemInstruction = `Write ONE expert tip (1-2 sentences) for barbers/stylists using ${productName}, built on these confirmed features: ${topFeatures.join("; ")}.

The tip MUST reference a real feature from that list and give actionable technique advice a professional would use. No invented capabilities — only use what's in the confirmed features above.

Return ONLY valid JSON: { "tip": "..." }`;

  const raw = await callAiForJson<{ tip?: string }>(systemInstruction, `Confirmed features: ${topFeatures.join("; ")}`, "GTM-ExpertTip", { timeoutMs: 20_000 });
  const tip = raw?.tip?.trim();
  return tip && tip.toUpperCase() !== "N/A" ? tip : null;
}

export function isGroundedInFeatures(tip: string, confirmedFeatureLines: string[]): boolean {
  return confirmedFeatureLines.some(feature => matchesDifferentiator(feature, tip));
}

// Mutates `fields` in place, same convention as
// lib/gtm-tier6-inference.ts's applyTier6Inference. Only fills fields
// that are part of the passed schema AND still unresolved once every
// earlier tier (AI, web, Tier 6) has had its turn.
function isUnresolved(fields: Record<string, GtmFieldAnswer>, id: string): boolean {
  const current = fields[id];
  return !current || current.source === "none" || current.answer.toUpperCase() === "N/A";
}

export async function applyFeaturesAndExpertTip(
  fields: Record<string, GtmFieldAnswer>,
  schema: GtmField[],
  sources: GtmSources,
  productName: string,
  pipelineStart: number
): Promise<void> {
  // Features (full list) is a 10-row group — gate on row 1 as the
  // representative "still needs deriving" check, same as any other field.
  const wantsFeatures = schema.some(f => f.id === "features_full_list_1") && isUnresolved(fields, "features_full_list_1");
  if (wantsFeatures) {
    const bullets = await deriveFeaturesFullList(sources);
    bullets.forEach((bullet, i) => {
      fields[`features_full_list_${i + 1}`] = {
        answer: renderFeatureRowAnswer(bullet),
        source: "derived",
        sourceDetail: { source: bullet.source },
        flagged: bullet.source === "unconfirmed",
      };
    });
  }

  const wantsTip = schema.some(f => f.id === "expert_tip") && isUnresolved(fields, "expert_tip");
  if (!wantsTip) return;

  // Expert Tip's grounding basis: whichever features_full_list_N rows are
  // real right now — either just-resolved above (full-document generation
  // always resolves Features first in the same pass) or, for a single-field
  // regenerate of ONLY expert_tip (no Features rows in `fields` at all),
  // the document's existing answers (sources.existingFieldAnswers,
  // populated by the regenerate route).
  const confirmedFeatureLines: string[] = [];
  for (let i = 1; i <= FEATURES_FULL_LIST_GROUP_SIZE; i++) {
    const rowAnswer = fields[`features_full_list_${i}`]?.answer ?? sources.existingFieldAnswers?.[`features_full_list_${i}`];
    if (!isRealAnswer(rowAnswer)) continue;
    const line = stripSourceTag(rowAnswer!);
    if (line && !line.startsWith("Category-expected")) confirmedFeatureLines.push(line);
  }
  if (confirmedFeatureLines.length === 0) return;

  const tip = await generateExpertTip(productName, confirmedFeatureLines);
  if (!tip) return;

  if (isGroundedInFeatures(tip, confirmedFeatureLines)) {
    fields["expert_tip"] = { answer: tip, source: "derived", sourceDetail: { label: "Generated from key features" } };
    return;
  }

  // One retry with a stricter, more explicit prompt before giving up —
  // same single-retry discipline as guardWrittenFieldsQuality's written-
  // field quality guard in lib/gtm-generate.ts.
  const retryTip = await generateExpertTip(productName, confirmedFeatureLines.slice(0, 1));
  if (retryTip && isGroundedInFeatures(retryTip, confirmedFeatureLines)) {
    fields["expert_tip"] = { answer: retryTip, source: "derived", sourceDetail: { label: "Generated from key features" } };
  }
  // Otherwise leave unresolved — falls through to the terminal
  // "Not determinable" state in lib/field-finalize.ts, never ships an
  // ungrounded tip.
}
