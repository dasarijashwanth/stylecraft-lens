// The 74-field "Product Knowledge" spec sheet for the Go-To-Market tab.
// Single source of truth for both the generation prompt (app/api/projects/[id]/gtm/route.ts)
// and the UI grid (GoToMarketTab in app/(app)/dashboard/projects/[id]/page.tsx) — every
// consumer must iterate this list, never hardcode the field count or IDs elsewhere.

export interface GtmField {
  id: string;
  section: string;
  question: string;
}

export const GTM_FIELD_SCHEMA: GtmField[] = [
  // General
  { id: "item", section: "General", question: "Item" },
  { id: "core_consumer", section: "General", question: "Core Consumer" },
  { id: "why_creating_item", section: "General", question: "Why are we creating this item? (consumer need, competitive product, etc.)" },
  { id: "positioning_statement", section: "General", question: "What is the positioning statement? (story)" },
  { id: "product_name_origin", section: "General", question: "Product Name Origin" },
  { id: "name_story_tie", section: "General", question: "How does this product name tie to the story?" },
  { id: "new_line_or_current", section: "General", question: "New Line or Current Collection?" },
  { id: "new_technology", section: "General", question: "New Technology?" },
  { id: "approved_pricing", section: "General", question: "Approved Pricing" },
  { id: "good_better_best", section: "General", question: "Good Better Best $" },
  { id: "performance", section: "General", question: "Performance" },
  { id: "hair_type", section: "General", question: "Hair Type" },
  { id: "features_full_list", section: "General", question: "Features (full list)" },
  { id: "upsell_cross_sell", section: "General", question: "Up-sell / Cross-sell products" },
  { id: "reason_to_buy", section: "General", question: "Reason to Buy (Unique Selling Points)" },
  { id: "expert_tip", section: "General", question: "Expert Tip" },
  { id: "comps", section: "General", question: "COMPS" },
  { id: "comps_buying_guide", section: "General", question: "Comps for Buying Guide" },
  { id: "trademark_symbol", section: "General", question: "Trademark Symbol" },
  { id: "warranty", section: "General", question: "Warranty" },
  { id: "certification_needed", section: "General", question: "Certification Needed" },
  { id: "rating_label", section: "General", question: "Rating Label" },

  // Packaging & Logistics
  { id: "dieline", section: "Packaging & Logistics", question: "Dieline" },
  { id: "box_type", section: "Packaging & Logistics", question: "Box Type" },
  { id: "product_lwh", section: "Packaging & Logistics", question: "Product LxWxH (in.)" },
  { id: "product_weight", section: "Packaging & Logistics", question: "Product Weight (lbs.)" },
  { id: "box_lwh", section: "Packaging & Logistics", question: "Box LxWxH (in.)" },
  { id: "measurement_by", section: "Packaging & Logistics", question: "Measurement By" },
  { id: "box_weight", section: "Packaging & Logistics", question: "Box Weight (lbs.)" },
  { id: "pallet_tier_total", section: "Packaging & Logistics", question: "Pallet Tier (Total)" },
  { id: "pallets_high", section: "Packaging & Logistics", question: "Pallets High" },

  // Tool Description
  { id: "product_title", section: "Tool Description", question: "Product Title" },
  { id: "material", section: "Tool Description", question: "Material" },
  { id: "top_6_features", section: "Tool Description", question: "Top 6 Features in Priority Order" },
  { id: "feature_icons", section: "Tool Description", question: "6 Icons for the Features" },
  { id: "care_directions", section: "Tool Description", question: "Care Directions" },

  // Motor
  { id: "motor_type", section: "Motor", question: "Motor Type" },
  { id: "motor_rpm", section: "Motor", question: "RPM" },
  { id: "motor_run_time", section: "Motor", question: "Run Time" },
  { id: "motor_speed", section: "Motor", question: "Speed" },

  // Blades
  { id: "blade_name", section: "Blades", question: "Blade Name" },
  { id: "fixed_blade", section: "Blades", question: "Fixed Blade" },
  { id: "cutting_blade", section: "Blades", question: "Cutting Blade" },

  // Lids
  { id: "lids_qty", section: "Lids", question: "Qty" },
  { id: "lids_colors", section: "Lids", question: "Colors" },

  // Lever
  { id: "lever_type", section: "Lever", question: "Type" },
  { id: "lever_qty", section: "Lever", question: "Qty" },
  { id: "lever_color", section: "Lever", question: "Color" },

  // Guards
  { id: "guards_type", section: "Guards", question: "Type" },
  { id: "guards_qty", section: "Guards", question: "Qty" },
  { id: "guards_color", section: "Guards", question: "Color" },

  // Charging
  { id: "charging_light_color", section: "Charging", question: "Light Color" },
  { id: "charging_base_color", section: "Charging", question: "Base Color" },
  { id: "charging_cord_color", section: "Charging", question: "Cord Color" },
  { id: "charging_cord_length", section: "Charging", question: "Cord Length" },
  { id: "charging_port", section: "Charging", question: "Charging Port" },
  { id: "charging_voltage", section: "Charging", question: "Voltage" },
  { id: "charging_logo_color", section: "Charging", question: "Logo Color" },
  { id: "charging_led_function", section: "Charging", question: "LED Function" },

  // Included in Box
  { id: "screw_driver_color", section: "Included in Box", question: "Screw Driver Color" },
  { id: "screw_driver_brand", section: "Included in Box", question: "Screw Driver Brand" },
  { id: "screw_driver_other", section: "Included in Box", question: "Screw Driver Other" },
  { id: "stretch_bracket_color", section: "Included in Box", question: "Stretch Bracket Color" },
  { id: "axis_shield_qty", section: "Included in Box", question: "Axis Shield Qty" },
  { id: "axis_shield_color", section: "Included in Box", question: "Axis Shield Color" },
  { id: "axis_shield_material", section: "Included in Box", question: "Axis Shield Material" },
  { id: "axis_shield_description", section: "Included in Box", question: "Axis Shield Description" },
  { id: "cam_follower_qty", section: "Included in Box", question: "Cam Follower Qty" },
  { id: "cam_follower_color", section: "Included in Box", question: "Cam Follower Color" },
  { id: "cleaning_brush_qty", section: "Included in Box", question: "Cleaning Brush Qty" },
  { id: "cleaning_brush_color", section: "Included in Box", question: "Cleaning Brush Color" },
  { id: "oil_bottle_qty", section: "Included in Box", question: "Oil Bottle Qty" },
  { id: "extra_screws_qty", section: "Included in Box", question: "Extra Screws Qty" },
  { id: "extra_screws_color", section: "Included in Box", question: "Extra Screws Color" },
];

export const GTM_SECTIONS = Array.from(new Set(GTM_FIELD_SCHEMA.map(f => f.section)));

export type GtmFieldSource = "sales_kit" | "tds" | "active_report" | "multiple" | "none";

export interface GtmFieldAnswer {
  answer: string;
  source: GtmFieldSource;
}

export interface ProductKnowledge {
  fields: Record<string, GtmFieldAnswer>;
  completedCount: number;
  generatedAt: string;
}
