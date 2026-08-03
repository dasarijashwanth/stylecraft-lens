// lib/gtm-workbook-data-mapper.ts
// GTM workbook export work — maps our GTM_FIELD_SCHEMA field answers onto
// the official workbook template's real row labels (Product Knowledge/BOX
// ONLY/Product FAQ), then drives lib/gtm-workbook-render.ts's writer.
//
// Labels below are the REAL template text (confirmed via a raw OOXML dump
// of the actual uploaded file, including its own typos — "Our
// Differrentiators", "Cam Follower Qtr", "Intial Quantities ordered: #" —
// which is why these are hand-transcribed here rather than derived from
// GTM_FIELD_SCHEMA's own (correctly-spelled) `question` text: the two serve
// different purposes and must be allowed to drift independently. Fields are
// listed in the template's own top-to-bottom row order — findRowByLabel's
// cursor walks forward through that order, which is what disambiguates a
// label reused across sections (Lids/Lever/Guards all have their own
// "Qty"/"Type"/"Color" row) without ever hardcoding a row number.
import { isRealAnswer } from "./field-answer-state";
import {
  openGtmWorkbook,
  generateGtmWorkbookBuffer,
  findRowByLabel,
  findAllRowsByLabel,
  writeCell,
  insertFaqRows,
  OpenGtmWorkbook,
} from "./gtm-workbook-render";

export interface WorkbookFieldSource {
  answer?: string;
  notes?: string | null;
}

export type WorkbookFields = Record<string, WorkbookFieldSource>;

export interface GtmWorkbookMapperInput {
  fields: WorkbookFields;
  headerSku: string | null; // resolved via lib/our-product-position.ts's resolveHeaderSku
  collection: string | null; // resolved via matchCatalogProductByName
  upc: string | null; // resolved via matchCatalogProductByName, or null -> "Awaiting internal input"
}

export interface WorkbookRepair {
  sheet: string;
  addr: string;
  oldFormula: string;
  newValue: string;
}

export interface GtmWorkbookRenderResult {
  buffer: Buffer;
  repairs: WorkbookRepair[];
  unmapped: { sheet: string; label: string }[];
}

function answerOf(fields: WorkbookFields, id: string): string {
  const v = fields[id]?.answer;
  return isRealAnswer(v) ? v!.trim() : (v ?? "").trim();
}

type Step =
  // rowOffset: some labels (e.g. Product FAQ's "Our Differrentiators"/
  // "Selling Position") are pure section headers whose own row has no
  // value cell of its own — the real answer lives on the row right below.
  // Defaults to 0 (value lives on the same row as the label, the common
  // case for Product Knowledge/BOX ONLY's "Item | Answer" rows).
  | { kind: "field"; label: string; fieldId: string; writeNotes?: boolean; rowOffset?: number }
  | { kind: "group"; label: string; fieldIdPrefix: string; total: number; offset: 0 | 1 }
  | { kind: "combinedRow"; label: string; fieldIds: string[] };

// ---- Product Knowledge (Item=A, Owner=B, Answer=C, Notes=D) ----
const PRODUCT_KNOWLEDGE_STEPS: Step[] = [
  { kind: "field", label: "Core Consumer", fieldId: "core_consumer" },
  { kind: "field", label: "Why are we creating this item?", fieldId: "why_creating_item" },
  { kind: "field", label: "What is the positioning statement?", fieldId: "positioning_statement" },
  { kind: "field", label: "Product Name Origin", fieldId: "product_name_origin" },
  { kind: "field", label: "How does this product name tie to the story?", fieldId: "name_story_tie" },
  { kind: "field", label: "New Line or Current Collection?", fieldId: "new_line_or_current" },
  { kind: "field", label: "New Technology?", fieldId: "new_technology" },
  { kind: "field", label: "Approved Pricing", fieldId: "approved_pricing" },
  { kind: "field", label: "Good Better Best -Lineup", fieldId: "good_better_best" },
  { kind: "field", label: "Good Better Best -Performance", fieldId: "good_better_best_performance" },
  { kind: "field", label: "Hair Type", fieldId: "hair_type" },
  { kind: "group", label: "Features (full list)", fieldIdPrefix: "features_full_list", total: 10, offset: 0 },
  { kind: "field", label: "Up-sell (Sales play opportunity)", fieldId: "up_sell" },
  { kind: "combinedRow", label: "Cross Sell Products", fieldIds: Array.from({ length: 5 }, (_, i) => `cross_sell_${i + 1}`) },
  { kind: "field", label: "Reason to Buy", fieldId: "reason_to_buy" },
  { kind: "field", label: "Expert Tip", fieldId: "expert_tip" },
  { kind: "field", label: "Comparison Chart WEB ONLY", fieldId: "comparison_chart_web_only", writeNotes: false },
  { kind: "field", label: "Comps for Buying Guide", fieldId: "comps_buying_guide" },
  { kind: "field", label: "Trademark Symbol", fieldId: "trademark_symbol" },
  { kind: "field", label: "Warranty", fieldId: "warranty" },
  { kind: "field", label: "Certification Needed", fieldId: "certification_needed" },
  { kind: "field", label: "Rating Label", fieldId: "rating_label" },
  { kind: "field", label: "Dieline", fieldId: "dieline" },
  { kind: "field", label: "Box Type", fieldId: "box_type" },
  { kind: "field", label: "Product LxWxH", fieldId: "product_lwh" },
  { kind: "field", label: "Product Weight", fieldId: "product_weight" },
  { kind: "field", label: "Box LxWxH", fieldId: "box_lwh" },
  { kind: "field", label: "Measurement By", fieldId: "measurement_by" },
  { kind: "field", label: "Box Weight", fieldId: "box_weight" },
  { kind: "field", label: "Pallet Tier (Total)", fieldId: "pallet_tier_total" },
  { kind: "field", label: "Pallets High", fieldId: "pallets_high" },
  { kind: "field", label: "Product Title", fieldId: "product_title" },
  { kind: "field", label: "Material", fieldId: "material" },
  { kind: "group", label: "Top 6 Features in Priority Order", fieldIdPrefix: "top_6_features", total: 6, offset: 0 },
  { kind: "group", label: "6 Icons for the Features", fieldIdPrefix: "feature_icons", total: 6, offset: 0 },
  { kind: "field", label: "Care Directions", fieldId: "care_directions" },
  { kind: "field", label: "Motor Type", fieldId: "motor_type" },
  { kind: "field", label: "RPM", fieldId: "motor_rpm" },
  { kind: "field", label: "Run Time", fieldId: "motor_run_time" },
  { kind: "field", label: "Recharge Time", fieldId: "motor_recharge_time" },
  { kind: "field", label: "Speed", fieldId: "motor_speed" },
  { kind: "field", label: "Noise level", fieldId: "motor_noise_level" },
  { kind: "field", label: "Blade Name", fieldId: "blade_name" },
  { kind: "field", label: "Fixed Blade", fieldId: "fixed_blade" },
  { kind: "field", label: "Cutting Blade", fieldId: "cutting_blade" },
  { kind: "field", label: "Qty", fieldId: "lids_qty" },
  { kind: "field", label: "Colors", fieldId: "lids_colors" },
  { kind: "field", label: "Type", fieldId: "lever_type" },
  { kind: "field", label: "Qty", fieldId: "lever_qty" },
  { kind: "field", label: "Color", fieldId: "lever_color" },
  { kind: "field", label: "Type", fieldId: "guards_type" },
  { kind: "field", label: "Qty", fieldId: "guards_qty" },
  { kind: "field", label: "Color", fieldId: "guards_color" },
  { kind: "field", label: "Light Color", fieldId: "charging_light_color" },
  { kind: "field", label: "Base Color", fieldId: "charging_base_color" },
  { kind: "field", label: "Cord Color", fieldId: "charging_cord_color" },
  { kind: "field", label: "Cord Length", fieldId: "charging_cord_length" },
  { kind: "field", label: "Charging Port", fieldId: "charging_port" },
  { kind: "field", label: "Voltage", fieldId: "charging_voltage" },
  { kind: "field", label: "Logo Color", fieldId: "charging_logo_color" },
  { kind: "field", label: "LED Function", fieldId: "charging_led_function" },
  { kind: "field", label: "Screw Driver Color", fieldId: "screw_driver_color" },
  { kind: "field", label: "Screw Driver Brand", fieldId: "screw_driver_brand" },
  { kind: "field", label: "Screw Driver Other", fieldId: "screw_driver_other" },
  { kind: "field", label: "Stretch Bracket Color", fieldId: "stretch_bracket_color" },
  // The real template's own label is "Cam Follower Qtr" (a typo) — searching
  // on the shorter "Cam Follower" prefix matches it without depending on
  // that typo being reproduced exactly; the cursor then lands correctly on
  // "Cam Follower Color" next since it's searched with its own full (and
  // correctly spelled) text.
  { kind: "field", label: "Cam Follower", fieldId: "cam_follower_qty" },
  { kind: "field", label: "Cam Follower Color", fieldId: "cam_follower_color" },
  { kind: "field", label: "Cleaning Brush Qty", fieldId: "cleaning_brush_qty" },
  { kind: "field", label: "Cleaning Brush Color", fieldId: "cleaning_brush_color" },
  { kind: "field", label: "Oil Bottle Qty", fieldId: "oil_bottle_qty" },
  { kind: "field", label: "Extra Screws Qty", fieldId: "extra_screws_qty" },
  { kind: "field", label: "Extra Screws Color", fieldId: "extra_screws_color" },
  { kind: "field", label: "Included:", fieldId: "included_summary" },
];

// ---- BOX ONLY (Item=A, Owner=B, Copy=C, Notes=D) — most values re-export
// an existing Product Knowledge/catalog fact rather than needing their own
// storage; see supplyBoxOnlyFields() below for how those get folded in
// under a synthetic field id this step list can reference like any other.
const BOX_ONLY_STEPS: Step[] = [
  { kind: "field", label: "Product Name", fieldId: "box_product_name" },
  { kind: "field", label: "Collection Name", fieldId: "box_collection_name" },
  { kind: "field", label: "Main Statement", fieldId: "box_main_statement" },
  { kind: "group", label: "Features (6 Max)", fieldIdPrefix: "box_feature", total: 6, offset: 1 },
  { kind: "group", label: "Icons (6 Max)", fieldIdPrefix: "feature_icons", total: 6, offset: 1 },
  { kind: "field", label: "UPC", fieldId: "box_upc" },
  { kind: "field", label: "Warranty", fieldId: "warranty" },
  { kind: "field", label: "Includes", fieldId: "included_summary" },
  { kind: "field", label: "Certifications", fieldId: "certification_needed" },
  { kind: "field", label: "Charger Voltage", fieldId: "charging_voltage" },
];

// ---- Product FAQ (Item=A, Value=B) — Q:/A: pairs are matched by position
// (Nth "Q:" -> faq_question_N) since the label itself repeats 10x after
// row insertion; every other row here has its own unique label.
const FAQ_LABELED_STEPS: Step[] = [
  // Real template typo, transcribed verbatim so the label search matches.
  // "Our Differrentiators"/"Selling Position" are pure section headers —
  // their own row has no value cell, the real answer lives one row below.
  { kind: "field", label: "Our Differrentiators", fieldId: "our_differentiators", rowOffset: 1 },
  { kind: "field", label: "Dealer Gross Margins: %", fieldId: "dealer_gross_margin_pct" },
  { kind: "field", label: "Retail Gross Margin: %", fieldId: "retail_gross_margin_pct" },
  // Real template typo ("Intial") + lowercase "ordered", transcribed verbatim.
  { kind: "field", label: "Intial Quantities ordered: #", fieldId: "initial_quantities_ordered" },
  { kind: "field", label: "Selling Position", fieldId: "selling_position", rowOffset: 1 },
  { kind: "field", label: "1:", fieldId: "rep_talking_point_1" },
  { kind: "field", label: "2:", fieldId: "rep_talking_point_2" },
  { kind: "field", label: "3:", fieldId: "rep_talking_point_3" },
];

function applyFieldStep(
  workbook: OpenGtmWorkbook,
  sheet: string,
  sheetXml: string,
  labelColumn: string,
  valueColumn: string,
  notesColumn: string | null,
  cursor: number,
  step: Extract<Step, { kind: "field" }>,
  fields: WorkbookFields,
  repairs: WorkbookRepair[],
  unmapped: { sheet: string; label: string }[]
): { xml: string; cursor: number } {
  const labelRow = findRowByLabel(sheetXml, workbook.sharedStrings, labelColumn, step.label, cursor);
  if (labelRow == null) {
    unmapped.push({ sheet, label: step.label });
    return { xml: sheetXml, cursor };
  }
  const valueRow = labelRow + (step.rowOffset ?? 0);
  const answer = answerOf(fields, step.fieldId);
  const { xml: afterAnswer, report } = writeCell(sheetXml, `${valueColumn}${valueRow}`, answer);
  let xml = afterAnswer;
  if (report.hadFormula) repairs.push({ sheet, addr: `${valueColumn}${valueRow}`, oldFormula: report.oldFormula!, newValue: answer });

  if (notesColumn && step.writeNotes !== false) {
    const notes = fields[step.fieldId]?.notes;
    if (notes && notes.trim()) {
      xml = writeCell(xml, `${notesColumn}${valueRow}`, notes.trim()).xml;
    }
  }
  return { xml, cursor: valueRow };
}

function applySteps(
  workbook: OpenGtmWorkbook,
  sheet: string,
  labelColumn: string,
  valueColumn: string,
  notesColumn: string | null,
  steps: Step[],
  fields: WorkbookFields,
  repairs: WorkbookRepair[],
  unmapped: { sheet: string; label: string }[]
): void {
  let xml = workbook.getSheetXml(sheet);
  let cursor = 0;

  for (const step of steps) {
    if (step.kind === "field") {
      const result = applyFieldStep(workbook, sheet, xml, labelColumn, valueColumn, notesColumn, cursor, step, fields, repairs, unmapped);
      xml = result.xml;
      cursor = result.cursor;
    } else if (step.kind === "group") {
      const anchorRow = findRowByLabel(xml, workbook.sharedStrings, labelColumn, step.label, cursor);
      if (anchorRow == null) {
        unmapped.push({ sheet, label: step.label });
        continue;
      }
      for (let i = 0; i < step.total; i++) {
        const rowNum = anchorRow + step.offset + i;
        const answer = answerOf(fields, `${step.fieldIdPrefix}_${i + 1}`);
        xml = writeCell(xml, `${valueColumn}${rowNum}`, answer).xml;
      }
      cursor = anchorRow + step.offset + step.total - 1;
    } else {
      const row = findRowByLabel(xml, workbook.sharedStrings, labelColumn, step.label, cursor);
      if (row == null) {
        unmapped.push({ sheet, label: step.label });
        continue;
      }
      cursor = row;
      const combined = step.fieldIds.map(id => answerOf(fields, id)).filter(v => v && v.toUpperCase() !== "N/A").join("\n");
      xml = writeCell(xml, `${valueColumn}${row}`, combined).xml;
    }
  }

  workbook.setSheetXml(sheet, xml);
}

// Folds re-exported/catalog-sourced values (Product Title, Collection,
// UPC) into the same WorkbookFields map under synthetic ids the BOX ONLY
// step list references — keeps applySteps generic (it only ever reads
// `fields[id].answer`), rather than special-casing these 3 rows.
function supplyBoxOnlyFields(input: GtmWorkbookMapperInput): WorkbookFields {
  return {
    ...input.fields,
    box_product_name: { answer: answerOf(input.fields, "product_title") },
    box_collection_name: { answer: input.collection || "" },
    box_upc: { answer: input.upc || "Awaiting internal input" },
  };
}

const FAQ_PAIR_COUNT = 10;
const FAQ_LAST_TEMPLATE_TRIAD_END_ROW = 12; // rows 4/5/6, 7/8/9, 10/11/12 — 3rd pair's blank row

function applyProductTitleHeaderSku(fields: WorkbookFields, headerSku: string | null): WorkbookFields {
  if (!headerSku) return fields;
  const title = answerOf(fields, "product_title");
  if (!title || title.toUpperCase() === "N/A") return fields;
  return { ...fields, product_title: { ...fields.product_title, answer: `${title} — ${headerSku}` } };
}

export function renderGtmWorkbook(templateBuffer: Buffer, input: GtmWorkbookMapperInput): GtmWorkbookRenderResult {
  const workbook = openGtmWorkbook(templateBuffer);
  const repairs: WorkbookRepair[] = [];
  const unmapped: { sheet: string; label: string }[] = [];

  const pkFields = applyProductTitleHeaderSku(input.fields, input.headerSku);
  applySteps(workbook, "Product Knowledge", "A", "C", "D", PRODUCT_KNOWLEDGE_STEPS, pkFields, repairs, unmapped);

  const boxFields = supplyBoxOnlyFields(input);
  applySteps(workbook, "BOX ONLY", "A", "C", null, BOX_ONLY_STEPS, boxFields, repairs, unmapped);

  // Product FAQ needs its 3 existing Q:/A:/blank triads grown to 10 BEFORE
  // any label search runs (row numbers below the growth point shift).
  const faqXmlBeforeInsert = workbook.getSheetXml("Product FAQ");
  const existingQRows = findAllRowsByLabel(faqXmlBeforeInsert, workbook.sharedStrings, "A", "Q:");
  const newPairsNeeded = Math.max(0, FAQ_PAIR_COUNT - existingQRows.length);
  const faqXmlInserted = newPairsNeeded > 0
    ? insertFaqRows(faqXmlBeforeInsert, FAQ_LAST_TEMPLATE_TRIAD_END_ROW, newPairsNeeded)
    : faqXmlBeforeInsert;
  workbook.setSheetXml("Product FAQ", faqXmlInserted);

  let faqXml = workbook.getSheetXml("Product FAQ");
  const qRows = findAllRowsByLabel(faqXml, workbook.sharedStrings, "A", "Q:");
  const aRows = findAllRowsByLabel(faqXml, workbook.sharedStrings, "A", "A:");
  for (let i = 0; i < Math.min(FAQ_PAIR_COUNT, qRows.length); i++) {
    faqXml = writeCell(faqXml, `B${qRows[i]}`, answerOf(input.fields, `faq_question_${i + 1}`)).xml;
  }
  for (let i = 0; i < Math.min(FAQ_PAIR_COUNT, aRows.length); i++) {
    faqXml = writeCell(faqXml, `B${aRows[i]}`, answerOf(input.fields, `faq_answer_${i + 1}`)).xml;
  }
  workbook.setSheetXml("Product FAQ", faqXml);
  applySteps(workbook, "Product FAQ", "A", "B", null, FAQ_LABELED_STEPS, input.fields, repairs, unmapped);

  return { buffer: generateGtmWorkbookBuffer(workbook), repairs, unmapped };
}
