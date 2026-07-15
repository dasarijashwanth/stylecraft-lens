// The 74-field "Product Knowledge" spec sheet for the Go-To-Market tab.
// Single source of truth for both the generation pipeline (app/api/documents/generate,
// lib/gtm-derive.ts, lib/gtm-grounding.ts) and the UI grid (ProductKnowledgeSection in
// app/(app)/dashboard/projects/[id]/page.tsx) — every consumer must iterate this list,
// never hardcode the field count or IDs elsewhere.

export type GtmFieldKind = "grounded" | "written";

export interface GtmField {
  id: string;
  section: string;
  question: string;
  // grounded = spec/number/color/qty fact — must trace back to an actual
  // source or become N/A (see lib/gtm-grounding.ts). written = narrative
  // copy that should be specific to this product, checked for
  // boilerplate/duplication against other products (see lib/text-similarity.ts).
  kind: GtmFieldKind;
}

// Narrative fields — the rest of the schema defaults to "grounded".
const WRITTEN_FIELD_IDS = new Set([
  "core_consumer",
  "why_creating_item",
  "positioning_statement",
  "product_name_origin",
  "name_story_tie",
  "new_line_or_current",
  "new_technology",
  "reason_to_buy",
  "expert_tip",
]);

function field(id: string, section: string, question: string): GtmField {
  return { id, section, question, kind: WRITTEN_FIELD_IDS.has(id) ? "written" : "grounded" };
}

export const GTM_FIELD_SCHEMA: GtmField[] = [
  // General
  field("item", "General", "Item"),
  field("core_consumer", "General", "Core Consumer"),
  field("why_creating_item", "General", "Why are we creating this item? (consumer need, competitive product, etc.)"),
  field("positioning_statement", "General", "What is the positioning statement? (story)"),
  field("product_name_origin", "General", "Product Name Origin"),
  field("name_story_tie", "General", "How does this product name tie to the story?"),
  field("new_line_or_current", "General", "New Line or Current Collection?"),
  field("new_technology", "General", "New Technology?"),
  field("approved_pricing", "General", "Approved Pricing"),
  field("good_better_best", "General", "Good Better Best $"),
  field("performance", "General", "Performance"),
  field("hair_type", "General", "Hair Type"),
  field("features_full_list", "General", "Features (full list)"),
  field("upsell_cross_sell", "General", "Up-sell / Cross-sell products"),
  field("reason_to_buy", "General", "Reason to Buy (Unique Selling Points)"),
  field("expert_tip", "General", "Expert Tip"),
  field("comps", "General", "COMPS"),
  field("comps_buying_guide", "General", "Comps for Buying Guide"),
  field("trademark_symbol", "General", "Trademark Symbol"),
  field("warranty", "General", "Warranty"),
  field("certification_needed", "General", "Certification Needed"),
  field("rating_label", "General", "Rating Label"),

  // Packaging & Logistics
  field("dieline", "Packaging & Logistics", "Dieline"),
  field("box_type", "Packaging & Logistics", "Box Type"),
  field("product_lwh", "Packaging & Logistics", "Product LxWxH (in.)"),
  field("product_weight", "Packaging & Logistics", "Product Weight (lbs.)"),
  field("box_lwh", "Packaging & Logistics", "Box LxWxH (in.)"),
  field("measurement_by", "Packaging & Logistics", "Measurement By"),
  field("box_weight", "Packaging & Logistics", "Box Weight (lbs.)"),
  field("pallet_tier_total", "Packaging & Logistics", "Pallet Tier (Total)"),
  field("pallets_high", "Packaging & Logistics", "Pallets High"),

  // Tool Description
  field("product_title", "Tool Description", "Product Title"),
  field("material", "Tool Description", "Material"),
  field("top_6_features", "Tool Description", "Top 6 Features in Priority Order"),
  field("feature_icons", "Tool Description", "6 Icons for the Features"),
  field("care_directions", "Tool Description", "Care Directions"),

  // Motor
  field("motor_type", "Motor", "Motor Type"),
  field("motor_rpm", "Motor", "RPM"),
  field("motor_run_time", "Motor", "Run Time"),
  field("motor_speed", "Motor", "Speed"),

  // Blades
  field("blade_name", "Blades", "Blade Name"),
  field("fixed_blade", "Blades", "Fixed Blade"),
  field("cutting_blade", "Blades", "Cutting Blade"),

  // Lids
  field("lids_qty", "Lids", "Qty"),
  field("lids_colors", "Lids", "Colors"),

  // Lever
  field("lever_type", "Lever", "Type"),
  field("lever_qty", "Lever", "Qty"),
  field("lever_color", "Lever", "Color"),

  // Guards
  field("guards_type", "Guards", "Type"),
  field("guards_qty", "Guards", "Qty"),
  field("guards_color", "Guards", "Color"),

  // Charging
  field("charging_light_color", "Charging", "Light Color"),
  field("charging_base_color", "Charging", "Base Color"),
  field("charging_cord_color", "Charging", "Cord Color"),
  field("charging_cord_length", "Charging", "Cord Length"),
  field("charging_port", "Charging", "Charging Port"),
  field("charging_voltage", "Charging", "Voltage"),
  field("charging_logo_color", "Charging", "Logo Color"),
  field("charging_led_function", "Charging", "LED Function"),

  // Included in Box
  field("screw_driver_color", "Included in Box", "Screw Driver Color"),
  field("screw_driver_brand", "Included in Box", "Screw Driver Brand"),
  field("screw_driver_other", "Included in Box", "Screw Driver Other"),
  field("stretch_bracket_color", "Included in Box", "Stretch Bracket Color"),
  field("axis_shield_qty", "Included in Box", "Axis Shield Qty"),
  field("axis_shield_color", "Included in Box", "Axis Shield Color"),
  field("axis_shield_material", "Included in Box", "Axis Shield Material"),
  field("axis_shield_description", "Included in Box", "Axis Shield Description"),
  field("cam_follower_qty", "Included in Box", "Cam Follower Qty"),
  field("cam_follower_color", "Included in Box", "Cam Follower Color"),
  field("cleaning_brush_qty", "Included in Box", "Cleaning Brush Qty"),
  field("cleaning_brush_color", "Included in Box", "Cleaning Brush Color"),
  field("oil_bottle_qty", "Included in Box", "Oil Bottle Qty"),
  field("extra_screws_qty", "Included in Box", "Extra Screws Qty"),
  field("extra_screws_color", "Included in Box", "Extra Screws Color"),
];

export const GTM_SECTIONS = Array.from(new Set(GTM_FIELD_SCHEMA.map(f => f.section)));

export type GtmFieldSource = "project_record" | "sales_kit" | "tds" | "active_report" | "web" | "multiple" | "none";

// Human-readable provenance labels — shared by the field-grid UI
// (ProductKnowledgeSection) and the CSV export route so both present the
// same "Source" wording instead of maintaining two copies of this map.
export const GTM_SOURCE_LABELS: Record<string, string> = {
  project_record: "Project",
  sales_kit: "Sales Kit",
  tds: "TDS",
  active_report: "Active Report",
  web: "Web — verify",
  multiple: "Multiple",
  none: "N/A",
};

export interface GtmFieldAnswer {
  answer: string;
  source: GtmFieldSource;
  sourceDetail?: any;
  flagged?: boolean;
}

export interface ProductKnowledge {
  fields: Record<string, GtmFieldAnswer>;
  completedCount: number;
  generatedAt: string;
}
