// The "Product Knowledge" spec sheet for the Go-To-Market tab — GTM Schema
// v3's full field inventory (see the repo owner's own numbered spec, GTM
// Schema v3). Single source of truth for both the generation pipeline
// (app/api/documents/generate, lib/gtm-derive.ts, lib/gtm-grounding.ts) and
// the UI grid (ProductKnowledgeSection in
// app/(app)/dashboard/projects/[id]/page.tsx) — every consumer must iterate
// this list, never hardcode the field count or IDs elsewhere.

export type GtmFieldKind = "grounded" | "written" | "internal";

export interface GtmField {
  id: string;
  section: string;
  question: string;
  // grounded = spec/number/color/qty fact — must trace back to an actual
  // source or become N/A (see lib/gtm-grounding.ts). written = narrative
  // copy that should be specific to this product, checked for
  // boilerplate/duplication against other products (see lib/text-similarity.ts).
  // internal = a genuine human/team decision (packaging engineering, final
  // approved price) that no source document, web search, or derivation can
  // ever answer — AI/web/derived/category tiers are skipped entirely for
  // these; unresolved ones surface as "Awaiting internal input", never N/A.
  kind: GtmFieldKind;
  // Default team owner for internal-kind fields only — shown next to the
  // "Awaiting internal input" chip so it's clear who to ask.
  owner?: string;
  // Muted caption rendered under the question label — for instructions that
  // must appear verbatim (e.g. Comparison Chart WEB ONLY's exact spec text),
  // rather than folded into the question itself.
  helperText?: string;
  // Marks a field whose UI control is NOT the default plain textarea — the
  // render loop in ProductKnowledgeSection special-cases these ids/kinds.
  // Every other field (the vast majority) is left undefined and renders the
  // generic textarea. "select" is generic (keyed off uiControl+options, not
  // a per-field-id branch); "sku_picker" is the one per-field-id exception
  // (Comparison Chart WEB ONLY).
  uiControl?: "sku_picker" | "select";
  // Fixed choices for uiControl:"select" fields — an AI/derived answer not
  // exactly matching one of these (case-insensitive) is treated as
  // unresolved rather than accepted as free text.
  options?: string[];
  // Marks one row of a repeatable-row group (Features/Cross Sell/Top 6/
  // Icons) — same document_fields row shape as every other field (own
  // Owner/Notes/history), just tagged so the UI can render row groups and
  // CSV/PDF can trim trailing empty rows. See lib/gtm-group-fields.ts.
  group?: { id: string; index: number; total: number };
  // GTM workbook export work — the official template has NO Axis Shield
  // rows at all (confirmed against the real file), so these 4 fields are
  // "legacy": still generated normally if a product genuinely has real
  // data for them, but hidden from the UI (and excluded from completion %)
  // when empty, rather than always showing an empty row. See
  // visibleGtmSchema() below.
  legacyOptional?: boolean;
}

// Narrative fields — the rest of the schema defaults to "grounded".
const WRITTEN_FIELD_IDS = new Set([
  "why_creating_item",
  "positioning_statement",
  "product_name_origin",
  "name_story_tie",
  "new_line_or_current",
  "new_technology",
  "up_sell",
  "reason_to_buy",
  "expert_tip",
  // Product FAQ section (GTM workbook export work)
  "our_differentiators",
  "selling_position",
  "rep_talking_point_1",
  "rep_talking_point_2",
  "rep_talking_point_3",
  // faq_question_N/faq_answer_N are written too — added via WRITTEN_FIELD_IDS
  // below once the group ids are known (see the groupFields loop further
  // down), rather than listing all 20 ids by hand here.
  // Box Only section
  "box_main_statement",
]);
for (let i = 1; i <= 10; i++) {
  WRITTEN_FIELD_IDS.add(`faq_question_${i}`);
  WRITTEN_FIELD_IDS.add(`faq_answer_${i}`);
}
for (let i = 1; i <= 6; i++) {
  WRITTEN_FIELD_IDS.add(`box_feature_${i}`);
}

// Genuine internal-decision fields — never answerable by AI, web search, or
// derivation, only by a real team decision. See GtmFieldKind above.
export const INTERNAL_FIELD_IDS = new Set([
  "dieline",
  "box_type",
  "measurement_by",
  "pallet_tier_total",
  "pallets_high",
  "approved_pricing",
  "trademark_symbol",
  "rating_label",
  // Product FAQ section's margin/quantity rows — genuine business decisions
  // made after FAQ generation, not derivable from any source or web search.
  "dealer_gross_margin_pct",
  "retail_gross_margin_pct",
  "initial_quantities_ordered",
]);

const INTERNAL_FIELD_OWNERS: Record<string, string> = {
  dieline: "Ops",
  box_type: "Ops",
  measurement_by: "Ops",
  pallet_tier_total: "Ops",
  pallets_high: "Ops",
  approved_pricing: "Sales",
  trademark_symbol: "Legal",
  rating_label: "Product Marketing",
  dealer_gross_margin_pct: "Sales",
  retail_gross_margin_pct: "Sales",
  initial_quantities_ordered: "Sales",
};

interface FieldExtra {
  helperText?: string;
  uiControl?: "sku_picker" | "select";
  options?: string[];
  group?: { id: string; index: number; total: number };
  legacyOptional?: boolean;
}

function field(id: string, section: string, question: string, extra?: FieldExtra): GtmField {
  const kind: GtmFieldKind = WRITTEN_FIELD_IDS.has(id) ? "written" : INTERNAL_FIELD_IDS.has(id) ? "internal" : "grounded";
  return { id, section, question, kind, ...(kind === "internal" ? { owner: INTERNAL_FIELD_OWNERS[id] } : {}), ...extra };
}

// Builds one repeatable-row group — N field entries sharing an id prefix,
// each independently editable (own Owner/Notes/history via the normal
// document_fields row) but visually and export-wise treated as one group
// (lib/gtm-group-fields.ts's filterTrailingEmptyGroupRows, the UI's group
// render branch in ProductKnowledgeSection).
function groupFields(idPrefix: string, section: string, rowLabel: string, total: number): GtmField[] {
  return Array.from({ length: total }, (_, i) => {
    const index = i + 1;
    return field(`${idPrefix}_${index}`, section, `${rowLabel} #${index}`, { group: { id: idPrefix, index, total } });
  });
}

export const GTM_FIELD_SCHEMA: GtmField[] = [
  // General
  field("item", "General", "Item"),
  field("core_consumer", "General", "Core Consumer", { uiControl: "select", options: ["Pro", "Retail", "Both"] }),
  field("why_creating_item", "General", "Why are we creating this item? (consumer need, competitive product, etc.)"),
  field("positioning_statement", "General", "What is the positioning statement? (story)"),
  field("product_name_origin", "General", "Product Name Origin"),
  field("name_story_tie", "General", "How does this product name tie to the story?"),
  field("new_line_or_current", "General", "New Line or Current Collection?"),
  field("new_technology", "General", "New Technology?"),
  field("approved_pricing", "General", "Approved Pricing", { helperText: "Format: Salon: $X   Retail: $Y" }),
  field("good_better_best", "General", "Good Better Best (Lineup)"),
  field("good_better_best_performance", "General", "Good Better Best (Performance)"),
  field("hair_type", "General", "Hair Type"),
  ...groupFields("features_full_list", "General", "Feature", 10),
  field("up_sell", "General", "Up-sell (Sales play opportunity)"),
  ...groupFields("cross_sell", "General", "Cross Sell Product", 5),
  field("reason_to_buy", "General", "Reason to Buy (Unique Selling Points)"),
  field("expert_tip", "General", "Expert Tip"),
  field("comparison_chart_web_only", "General", "Comparison Chart WEB ONLY", {
    helperText: "Select two products to feature as comparisons on the DTC site and provide the SKUs. You may include products from either StyleCraft or Gamma+.",
    uiControl: "sku_picker",
  }),
  // Revived per GTM Schema v3 as a plain link/URL text field — distinct
  // from Comparison Chart WEB ONLY above (a picker), and from the removed
  // COMPS field from GTM Schema v2 (not restored; this is a fresh field).
  field("comps_buying_guide", "General", "Comps for Buying Guide"),
  field("trademark_symbol", "General", "Trademark Symbol"),
  field("warranty", "General", "Warranty"),
  field("certification_needed", "General", "Certification Needed"),
  field("rating_label", "General", "Rating Label"),
  field("manufacturer", "General", "Manufacturer"),

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
  // Header renders "{Product Title} — {SKU}" in the UI/CSV/PDF once a SKU is
  // set — SKU itself lives on the project record (lib/db/projects.ts), not
  // as its own GTM field, since it's not part of the 76-item inventory.
  field("product_title", "Tool Description", "Product Title"),
  field("material", "Tool Description", "Material"),
  ...groupFields("top_6_features", "Tool Description", "Top Feature", 6),
  ...groupFields("feature_icons", "Tool Description", "Icon", 6),
  field("care_directions", "Tool Description", "Care Directions"),
  // Grounded (verbatim from the Amazon listing), not written — see kind
  // classification above. Deliberately excluded from WRITTEN_FIELD_IDS.
  // Kept even though it isn't itemized in GTM Schema v3's inventory (same
  // "don't silently drop an existing valuable field" call as Heat/Plate
  // Technology below).
  field("product_description", "Tool Description", "Product Description"),

  // Motor
  field("motor_type", "Motor", "Motor Type"),
  field("motor_rpm", "Motor", "RPM"),
  field("motor_run_time", "Motor", "Run Time"),
  field("motor_recharge_time", "Motor", "Recharge Time"),
  field("motor_speed", "Motor", "Speed"),
  field("motor_noise_level", "Motor", "Noise level", { uiControl: "select", options: ["Ultra Quiet", "Low", "Moderate"] }),

  // Heat/Plate Technology — the parallel section for motorless styling
  // tools (flat iron/curling iron/hot brush, see lib/db/tool-types.ts's
  // primary_criterion column). Present in the schema for every product
  // like Motor is; resolves to "Not listed"/N/A for tool types where it
  // doesn't apply, the same way Motor already does for non-motorized ones.
  field("plate_material", "Heat/Plate Technology", "Plate Material"),
  field("heater_type", "Heat/Plate Technology", "Heater Type"),
  field("max_temp_class", "Heat/Plate Technology", "Max Temp"),

  // Blades
  field("blade_name", "Blades", "Blade Name"),
  field("fixed_blade", "Blades", "Fixed Blade"),
  field("cutting_blade", "Blades", "Cutting Blade", { helperText: "Select the closest match, or choose Other and describe it in Notes." }),

  // Lids / Customizable Parts — renamed to match the official GTM workbook
  // template's own section header (cosmetic label only, GTM_SECTIONS
  // derives from this automatically).
  field("lids_qty", "Lids / Customizable Parts", "Qty"),
  field("lids_colors", "Lids / Customizable Parts", "Colors"),

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
  // legacyOptional — the official GTM workbook template has zero Axis
  // Shield rows (confirmed against the real file); still generated
  // normally when a product genuinely has real data, but hidden from the
  // UI/completion-% when empty rather than always showing an empty row.
  field("axis_shield_qty", "Included in Box", "Axis Shield Qty", { legacyOptional: true }),
  field("axis_shield_color", "Included in Box", "Axis Shield Color", { legacyOptional: true }),
  field("axis_shield_material", "Included in Box", "Axis Shield Material", { legacyOptional: true }),
  field("axis_shield_description", "Included in Box", "Axis Shield Description", { legacyOptional: true }),
  field("cam_follower_qty", "Included in Box", "Cam Follower Qty"),
  field("cam_follower_color", "Included in Box", "Cam Follower Color"),
  field("cleaning_brush_qty", "Included in Box", "Cleaning Brush Qty"),
  field("cleaning_brush_color", "Included in Box", "Cleaning Brush Color"),
  field("oil_bottle_qty", "Included in Box", "Oil Bottle Qty"),
  field("extra_screws_qty", "Included in Box", "Extra Screws Qty"),
  field("extra_screws_color", "Included in Box", "Extra Screws Color"),
  // Generic aggregate from Amazon's whats_in_the_box[] — kept alongside the
  // hand-tailored fields above (which are precise per-component slots for
  // this catalog's clipper products) rather than folded into them, since a
  // flat vendor list can't be reliably decomposed into those specific slots
  // without guessing. Serves non-clipper products and anything the
  // tailored fields miss.
  field("whats_in_box_list", "Included in Box", "What's in the Box (full list)"),
  // A one-line, comma-separated summary of whichever Included-in-Box fields
  // above have real values (e.g. "Clipper, USB-C cord, 2 guards, cleaning
  // brush, oil") — matches the official GTM workbook template's own
  // "Included:" row (102) and BOX ONLY's "Includes" row. Derived, not
  // written by AI — see lib/gtm-derive.ts's deriveIncludedSummary.
  field("included_summary", "Included in Box", "Included:"),

  // Product FAQ — generated automatically after GTM's own fields resolve
  // (new "faqs" pipeline phase, lib/gtm-product-faqs.ts), matching the
  // official GTM workbook template's "Product FAQ" tab.
  ...groupFields("faq_question", "Product FAQ", "Q", 10),
  ...groupFields("faq_answer", "Product FAQ", "A", 10),
  field("our_differentiators", "Product FAQ", "Our Differentiators"),
  field("selling_position", "Product FAQ", "Selling Position"),
  field("rep_talking_point_1", "Product FAQ", "Rep Talking Point 1"),
  field("rep_talking_point_2", "Product FAQ", "Rep Talking Point 2"),
  field("rep_talking_point_3", "Product FAQ", "Rep Talking Point 3"),
  field("dealer_gross_margin_pct", "Product FAQ", "Dealer Gross Margins: %"),
  field("retail_gross_margin_pct", "Product FAQ", "Retail Gross Margin: %"),
  field("initial_quantities_ordered", "Product FAQ", "Initial Quantities Ordered: #"),

  // Box Only — matches the official GTM workbook template's "BOX ONLY" tab.
  // Product Name/Collection Name/Icons/Warranty/Certifications/Includes/
  // Charger Voltage all re-export existing fields directly (product_title,
  // collection, feature_icons_1..6, warranty, certification_needed,
  // included_summary, charging_voltage) — only the box-length condensations
  // below need their own storage (lib/gtm-box-only.ts).
  field("box_main_statement", "Box Only", "Main Statement", { helperText: "One punchy box-front statement, ≤15 words, distilled from the Positioning Statement." }),
  ...groupFields("box_feature", "Box Only", "Box Feature", 6),
];

export const GTM_SECTIONS = Array.from(new Set(GTM_FIELD_SCHEMA.map(f => f.section)));

// Filters out a `legacyOptional` field (the 4 Axis Shield fields) when it
// has no real answer — used by the UI render loop (so an empty Axis Shield
// row simply never renders) and by every completion-percentage call site
// (so an empty legacy field never drags down the denominator). A product
// that genuinely has real Axis Shield data still shows/counts it normally.
export function visibleGtmSchema<T extends { id: string; legacyOptional?: boolean }>(
  schema: T[],
  fields: Record<string, { answer?: string | null } | undefined>
): T[] {
  return schema.filter(f => {
    if (!f.legacyOptional) return true;
    const answer = (fields[f.id]?.answer ?? "").toString().trim();
    return answer !== "" && answer.toUpperCase() !== "N/A";
  });
}

export type GtmFieldSource = "project_record" | "sales_kit" | "tds" | "active_report" | "web" | "multiple" | "none" | "derived" | "category_default" | "manual_edit";

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
  derived: "Derived",
  category_default: "Category Typical",
  manual_edit: "Manual",
};

export interface GtmFieldAnswer {
  answer: string;
  source: GtmFieldSource;
  sourceDetail?: any;
  flagged?: boolean;
  // GTM style-corpus work, Part D — a deriver-written Notes value (e.g.
  // Core Consumer "Both"'s reason, or Part E's deterministic conventions).
  // lib/db/documents.ts's saveDocumentFields only ever uses this to fill a
  // genuinely empty Notes slot — a human's existing Notes always wins.
  notes?: string;
}

export interface ProductKnowledge {
  fields: Record<string, GtmFieldAnswer>;
  completedCount: number;
  generatedAt: string;
}
