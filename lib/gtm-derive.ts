// Deterministic, code-only field derivation for the GTM Product Knowledge
// sheet — runs regardless of whether an AI provider is available/working.
// The AI (app/api/projects/[id]/gtm/route.ts) still attempts all 74 fields
// and takes priority when it returns something real; this is what backs
// the sheet when the AI is down/quota-exhausted, and what the AI's own
// answers get checked against as a floor. Only maps fields that TDS/Sales
// Kit/Active Report genuinely contain structured data for — everything
// else is left for the AI or "N/A", never guessed.
import { GtmFieldAnswer, GtmFieldSource } from "./gtm-field-schema";

function pick(answer: string | undefined | null, source: GtmFieldSource): GtmFieldAnswer | null {
  const trimmed = (answer ?? "").toString().trim();
  if (!trimmed) return null;
  return { answer: trimmed, source };
}

export function deriveFieldsFromSources(
  productName: string,
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
  const cf = activeReport?.content_form || {};

  // General
  set("item", pick(productName, "multiple"));
  set("core_consumer", pick((salesKit?.target_customers || []).join("; "), "sales_kit"));
  set("positioning_statement", pick(ca.positioning_recommendation, "active_report"));
  set("approved_pricing", pick(tds?.msrp || pricing.price_positioning, tds?.msrp ? "tds" : "active_report"));
  set("performance", pick(
    [specs.motor?.type, specs.motor?.rpm ?? specs.motor?.speed_rpm, specs.motor?.torque].filter(Boolean).join(" · "),
    "tds"
  ));
  set("features_full_list", pick((salesKit?.key_features || []).map((f: any) => f.headline).filter(Boolean).join("; "), "sales_kit"));
  set("reason_to_buy", pick(salesKit?.elevator_pitch, "sales_kit"));
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
  set("product_title", pick(tds?.product_name || productName, tds?.product_name ? "tds" : "multiple"));
  set("material", pick(specs.housing_material, "tds"));
  set("top_6_features", pick((salesKit?.key_features || []).slice(0, 6).map((f: any) => f.headline).filter(Boolean).join("; "), "sales_kit"));
  set("care_directions", pick((tds?.safety_notes || []).join(" "), "tds"));

  // Motor
  set("motor_type", pick(specs.motor?.type, "tds"));
  set("motor_rpm", pick(specs.motor?.speed_rpm ?? specs.motor?.rpm, "tds"));
  set("motor_run_time", pick(specs.battery?.runtime_minutes, "tds"));
  set("motor_speed", pick(specs.motor?.speed_rpm ?? specs.motor?.rpm, "tds"));

  // Blades
  set("blade_name", pick(specs.blade?.type, "tds"));
  set("cutting_blade", pick(specs.blade?.material, "tds"));

  return fields;
}
