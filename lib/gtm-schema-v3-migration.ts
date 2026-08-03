// lib/gtm-schema-v3-migration.ts
// Pure planning logic for scripts/migrate-gtm-schema-v3.ts, split out so
// it's directly unit-testable (scripts/verify-gtm-schema-v3.ts) without a
// real Supabase connection — same split as lib/gtm-schema-v2-migration.ts.
// Migrates 3 fields removed/split by GTM Schema v3 (`upsell_cross_sell`,
// `top_6_features`, `feature_icons`) plus the 3-source-merge single-blob
// `features_full_list` (from GTM Schema v2) into their new repeatable-row
// groups, and flags a one-time owner backfill for `trademark_symbol`'s new
// internal-kind classification.
import { splitNumberedList } from "./deck-field-registry";
import { isRealMigratableAnswer } from "./gtm-schema-v2-migration";

export { isRealMigratableAnswer };

export interface OldGtmFieldRowV3 {
  field_id: string;
  answer: string | null;
  source?: string | null;
  owner?: string | null;
}

export interface GroupSeedStep {
  fieldId: string;
  answer: string;
  source: string;
}

export interface V3MigrationPlan {
  // Old field ids to delete entirely (removed/split by v3).
  toDelete: string[];
  // Real value (if any) stashed into up_sell's Notes — upsell_cross_sell
  // mixed both up-sell and cross-sell concepts inseparably, so unlike
  // top_6_features/feature_icons/features_full_list it can't be split into
  // real row answers, only preserved as a reference note.
  upSellNotesStep: { notesText: string } | null;
  // Real per-row answers seeded directly into the new repeatable groups —
  // a genuine 1:1 content migration (these old fields were already
  // ranked/delimited lists in the same spirit as the new rows).
  groupSeeds: GroupSeedStep[];
  // trademark_symbol moved into INTERNAL_FIELD_IDS with owner "Legal" —
  // true when an existing row is still at the generic "Product Marketing"
  // default (or has no owner at all) and should be backfilled.
  trademarkOwnerFix: boolean;
}

const TOP_6_FEATURES_GROUP_SIZE = 6;
const FEATURE_ICONS_GROUP_SIZE = 6;
const FEATURES_FULL_LIST_GROUP_SIZE = 10;

export function planV3Migration(fields: OldGtmFieldRowV3[]): V3MigrationPlan {
  const byId = new Map(fields.map(f => [f.field_id, f]));
  const toDelete: string[] = [];
  const groupSeeds: GroupSeedStep[] = [];
  let upSellNotesStep: { notesText: string } | null = null;

  const upsellRow = byId.get("upsell_cross_sell");
  if (upsellRow) {
    toDelete.push("upsell_cross_sell");
    if (isRealMigratableAnswer(upsellRow.answer)) {
      upSellNotesStep = { notesText: `Previous value: ${upsellRow.answer}` };
    }
  }

  const top6Row = byId.get("top_6_features");
  if (top6Row) {
    toDelete.push("top_6_features");
    if (isRealMigratableAnswer(top6Row.answer)) {
      const parts = splitNumberedList(top6Row.answer!, TOP_6_FEATURES_GROUP_SIZE).slice(0, TOP_6_FEATURES_GROUP_SIZE);
      parts.forEach((text, i) => groupSeeds.push({ fieldId: `top_6_features_${i + 1}`, answer: text, source: top6Row.source || "derived" }));
    }
  }

  const iconsRow = byId.get("feature_icons");
  if (iconsRow) {
    toDelete.push("feature_icons");
    if (isRealMigratableAnswer(iconsRow.answer)) {
      const parts = iconsRow.answer!.split(/[;,]/).map(s => s.trim()).filter(Boolean).slice(0, FEATURE_ICONS_GROUP_SIZE);
      parts.forEach((text, i) => groupSeeds.push({ fieldId: `feature_icons_${i + 1}`, answer: text, source: iconsRow.source || "derived" }));
    }
  }

  const featuresRow = byId.get("features_full_list");
  if (featuresRow) {
    toDelete.push("features_full_list");
    if (isRealMigratableAnswer(featuresRow.answer)) {
      const parts = featuresRow.answer!.split("\n").map(s => s.trim()).filter(Boolean).slice(0, FEATURES_FULL_LIST_GROUP_SIZE);
      parts.forEach((text, i) => groupSeeds.push({ fieldId: `features_full_list_${i + 1}`, answer: text, source: featuresRow.source || "derived" }));
    }
  }

  const trademarkRow = byId.get("trademark_symbol");
  const trademarkOwnerFix = !!trademarkRow && (!trademarkRow.owner || trademarkRow.owner === "Product Marketing");

  return { toDelete, upSellNotesStep, groupSeeds, trademarkOwnerFix };
}
