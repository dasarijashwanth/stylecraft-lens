// Deterministic, code-only field derivation for the GTM Product Knowledge
// sheet — runs regardless of whether an AI provider is available/working.
// The AI (app/api/documents/generate/route.ts) still attempts all 74 fields
// and takes priority when it returns something real (after grounding
// verification); this is what backs the sheet when the AI is down/quota-
// exhausted, and what the AI's own answers get checked against as a floor.
// Only maps fields that the project record or TDS/Sales Kit/Active Report
// genuinely contain structured data for — everything else is left for the
// AI or "N/A", never guessed.
//
// Source hierarchy (highest authority first): the project record itself
// (name, description, category, motorTech, keyDiff, pricePoint,
// companyContext — entered directly by the team) > project documents
// (Competitive Analysis, TDS, Sales Kit) > web (deferred, see
// WEB_ELIGIBLE_FIELD_IDS in gtm-field-schema.ts) > N/A.
import { GtmFieldAnswer, GtmFieldSource } from "./gtm-field-schema";

export interface ProjectRecord {
  productName: string;
  description?: string | null;
  category?: string | null;
  motorTech?: string | null;
  keyDiff?: string | null;
  pricePoint?: string | null;
  companyContext?: string | null;
}

function pick(answer: string | undefined | null, source: GtmFieldSource): GtmFieldAnswer | null {
  const trimmed = (answer ?? "").toString().trim();
  if (!trimmed) return null;
  return { answer: trimmed, source };
}

// First non-empty of a list of (value, source) candidates, in priority order.
function firstOf(...candidates: [string | undefined | null, GtmFieldSource][]): GtmFieldAnswer | null {
  for (const [value, source] of candidates) {
    const p = pick(value, source);
    if (p) return p;
  }
  return null;
}

export function deriveFieldsFromSources(
  project: ProjectRecord,
  salesKit: any | null,
  tds: any | null,
  activeReport: { competitive_analysis?: any; pricing_analysis?: any; content_form?: any } | null
): Record<string, GtmFieldAnswer> {
  const fields: Record<string, GtmFieldAnswer> = {};
  const set = (id: string, value: GtmFieldAnswer | null) => {
    if (value) fields[id] = value;
  };

  const specs = tds?.specifications || {};
  const ca = activeReport?.competitive_analysis || {};
  const pricing = activeReport?.pricing_analysis || {};

  // General — project record wins where it directly answers the field.
  set("item", firstOf([project.productName, "project_record"]));
  set("product_title", firstOf([project.productName, "project_record"], [tds?.product_name, "tds"]));
  set("core_consumer", pick((salesKit?.target_customers || []).join("; "), "sales_kit"));
  set("positioning_statement", pick(ca.positioning_recommendation, "active_report"));
  set("approved_pricing", firstOf([project.pricePoint, "project_record"], [tds?.msrp, "tds"], [pricing.price_positioning, "active_report"]));
  set("performance", firstOf(
    [[project.motorTech, specs.motor?.rpm ?? specs.motor?.speed_rpm].filter(Boolean).join(" · "), "project_record"],
    [[specs.motor?.type, specs.motor?.rpm ?? specs.motor?.speed_rpm, specs.motor?.torque].filter(Boolean).join(" · "), "tds"]
  ));
  set("features_full_list", pick((salesKit?.key_features || []).map((f: any) => f.headline).filter(Boolean).join("; "), "sales_kit"));
  // upsell_cross_sell has no structured source today — left for AI/N/A.
  set("reason_to_buy", firstOf([salesKit?.elevator_pitch, "sales_kit"], [project.keyDiff, "project_record"]));
  const compNames = [...(ca.large_brand_competitors || []), ...(ca.indie_emerging_competitors || [])].map((c: any) => c.name).filter(Boolean);
  set("comps", pick(compNames.join("; "), "active_report"));
  set("comps_buying_guide", pick(compNames.join("; "), "active_report"));
  set("warranty", pick([tds?.warranty?.duration, tds?.warranty?.coverage].filter(Boolean).join(" — "), "tds"));
  set("certification_needed", pick((tds?.certifications || []).join(", "), "tds"));

  // Packaging & Logistics — TDS carries product (not box/pallet) dimensions
  set("product_lwh", pick(
    specs.dimensions ? `${specs.dimensions.length_mm ?? "—"} x ${specs.dimensions.width_mm ?? "—"} mm` : null,
    "tds"
  ));
  set("product_weight", pick(specs.dimensions?.weight_g ? `${specs.dimensions.weight_g} g` : null, "tds"));

  // Tool Description
  set("material", pick(specs.housing_material, "tds"));
  set("top_6_features", pick((salesKit?.key_features || []).slice(0, 6).map((f: any) => f.headline).filter(Boolean).join("; "), "sales_kit"));
  set("care_directions", pick((tds?.safety_notes || []).join(" "), "tds"));

  // Motor — project.motorTech (team-entered) outranks TDS's generated specs.
  set("motor_type", firstOf([project.motorTech, "project_record"], [specs.motor?.type, "tds"]));
  set("motor_rpm", pick(specs.motor?.speed_rpm ?? specs.motor?.rpm, "tds"));
  set("motor_run_time", pick(specs.battery?.runtime_minutes, "tds"));
  set("motor_speed", pick(specs.motor?.speed_rpm ?? specs.motor?.rpm, "tds"));

  // Blades
  set("blade_name", pick(specs.blade?.type, "tds"));
  set("cutting_blade", pick(specs.blade?.material, "tds"));

  return fields;
}
