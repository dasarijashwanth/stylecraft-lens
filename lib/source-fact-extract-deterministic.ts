// lib/source-fact-extract-deterministic.ts
// Automatic Source-Doc Fact Extraction & Cross-Document Fill, Part 2 —
// deterministic spec-table/label-value parsing, run BEFORE the AI sweep
// (lib/tds-doc-facts.ts's extractStructuredFacts) over the same extracted
// plain text (lib/tds-doc-extract.ts). Every match here is a literal
// "label: value" (or "label — value" / "label\tvalue", as a spreadsheet
// flattens to) line — no AI call, no guessing, confidence:"high" always.
// The AI sweep skips any field id this pass already resolved (see its own
// SKIP_FIELD_IDS param) rather than re-deriving the same fact a second,
// slower, less-certain way.
//
// Scope: the exact category list from the feature spec — motor, RPM, run
// time, recharge, voltage, cord length, blade names/materials, dims,
// weights, box contents, warranty, certifications, guard sizes, LED
// behavior, UPC, SKU, pricing rows. Field ids match GTM_FIELD_SCHEMA/
// TDS_FIELD_SCHEMA directly (same vocabulary, zero translation) where a
// real schema field exists; UPC/SKU/pricing have no dedicated GTM field
// (SKU lives on the project record, per lib/gtm-field-schema.ts's own
// comment) so they're recorded as narrative_signal facts under a
// synthesized field id instead — still readable by the catalog back-fill
// confirmation chip (Part 3.6 of the feature).
import type { ExtractedFactCandidate } from "./tds-doc-facts";

export interface DeterministicFactCandidate extends ExtractedFactCandidate {
  fact_type: "grounded_field" | "narrative_signal";
  confidence: "high";
}

interface SynonymRule {
  field_id: string;
  fact_type: "grounded_field" | "narrative_signal";
  // Matched case-insensitively against the LABEL portion of a "label: value"
  // line (word-boundary substring, not a full regex per synonym — keeps the
  // list easy to extend without regex-escaping pitfalls).
  labelSynonyms: string[];
}

// Ordered so a more specific label (e.g. "recharge time") is tried before a
// more generic one that could otherwise false-match (e.g. plain "time").
const SYNONYM_RULES: SynonymRule[] = [
  { field_id: "motor_type", fact_type: "grounded_field", labelSynonyms: ["motor type", "motor", "motor technology"] },
  { field_id: "motor_rpm", fact_type: "grounded_field", labelSynonyms: ["rpm", "speed (rpm)", "revolutions per minute", "motor rpm"] },
  { field_id: "motor_recharge_time", fact_type: "grounded_field", labelSynonyms: ["recharge time", "charge time", "charging time", "time to charge"] },
  { field_id: "motor_run_time", fact_type: "grounded_field", labelSynonyms: ["run time", "runtime", "battery life", "cordless run time", "operating time"] },
  { field_id: "motor_speed", fact_type: "grounded_field", labelSynonyms: ["speed settings", "speeds", "number of speeds"] },
  { field_id: "motor_noise_level", fact_type: "grounded_field", labelSynonyms: ["noise level", "noise", "sound level", "db level", "decibel"] },
  { field_id: "charging_voltage", fact_type: "grounded_field", labelSynonyms: ["voltage", "input voltage", "charging voltage", "volts"] },
  { field_id: "charging_cord_length", fact_type: "grounded_field", labelSynonyms: ["cord length", "cable length", "power cord length"] },
  { field_id: "charging_port", fact_type: "grounded_field", labelSynonyms: ["charging port", "charge port", "port type", "usb port", "usb-c"] },
  { field_id: "charging_led_function", fact_type: "grounded_field", labelSynonyms: ["led function", "led behavior", "led indicator", "light indicator", "charging light"] },
  { field_id: "blade_name", fact_type: "grounded_field", labelSynonyms: ["blade name", "blade", "blade type", "blade material"] },
  { field_id: "fixed_blade", fact_type: "grounded_field", labelSynonyms: ["fixed blade"] },
  { field_id: "cutting_blade", fact_type: "grounded_field", labelSynonyms: ["cutting blade"] },
  { field_id: "product_lwh", fact_type: "grounded_field", labelSynonyms: ["product dimensions", "product lxwxh", "product l x w x h", "product size", "dimensions (product)"] },
  { field_id: "product_weight", fact_type: "grounded_field", labelSynonyms: ["product weight", "net weight", "item weight", "unit weight"] },
  { field_id: "box_lwh", fact_type: "grounded_field", labelSynonyms: ["box dimensions", "box lxwxh", "box l x w x h", "package dimensions", "carton dimensions"] },
  { field_id: "box_weight", fact_type: "grounded_field", labelSynonyms: ["box weight", "gross weight", "package weight", "shipping weight", "carton weight"] },
  { field_id: "included_summary", fact_type: "grounded_field", labelSynonyms: ["included in box", "box contents", "what's included", "whats included", "in the box", "package includes", "included items"] },
  { field_id: "warranty", fact_type: "grounded_field", labelSynonyms: ["warranty", "warranty period", "guarantee"] },
  { field_id: "certification_needed", fact_type: "grounded_field", labelSynonyms: ["certification", "certifications", "certified", "compliance"] },
  { field_id: "guards_qty", fact_type: "grounded_field", labelSynonyms: ["guard sizes", "guard size", "number of guards", "guards included", "combs included"] },
  { field_id: "guards_color", fact_type: "grounded_field", labelSynonyms: ["guard color", "guard colors"] },
  { field_id: "guards_type", fact_type: "grounded_field", labelSynonyms: ["guard type", "guard material"] },
  { field_id: "care_directions", fact_type: "grounded_field", labelSynonyms: ["care instructions", "care directions", "cleaning instructions", "maintenance"] },
  // No dedicated GTM/TDS schema field exists for these (SKU lives on the
  // project record, per lib/gtm-field-schema.ts's own comment) — recorded
  // as narrative_signal facts under a synthesized field id, still readable
  // by the catalog back-fill confirmation chip.
  { field_id: "source_doc_upc", fact_type: "narrative_signal", labelSynonyms: ["upc", "upc code", "universal product code"] },
  { field_id: "source_doc_sku", fact_type: "narrative_signal", labelSynonyms: ["sku", "sku code", "item number", "model number", "model no"] },
  { field_id: "source_doc_salon_price", fact_type: "narrative_signal", labelSynonyms: ["salon price", "professional price", "salon msrp"] },
  { field_id: "source_doc_retail_price", fact_type: "narrative_signal", labelSynonyms: ["retail price", "msrp", "suggested retail", "retail msrp"] },
];

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
}

// A spreadsheet flattens to "label: value" per lib/tds-doc-extract.ts's own
// XLSX handling; a Word table/PDF label-value line is typically
// "Label: Value", "Label — Value", "Label - Value", or tab-separated.
const LABEL_VALUE_LINE = /^\s*([A-Za-z][A-Za-z0-9 /().,'&%-]{1,60}?)\s*(?::|—|-|\t)\s*(.+?)\s*$/;

// Runs the synonym map against every line of `fullText`, matching the FIRST
// rule whose label matches (rules ordered most-specific-first). A field id
// already matched by an earlier line in the SAME document keeps its first
// match — real spec docs don't usually repeat a label with a different
// value, and if they do, the first (usually most prominent, e.g. a summary
// table before a detail section) wins rather than an arbitrary later one.
export function extractDeterministicFacts(fullText: string): DeterministicFactCandidate[] {
  if (!fullText || !fullText.trim()) return [];

  const seenFieldIds = new Set<string>();
  const candidates: DeterministicFactCandidate[] = [];
  const lines = fullText.split(/\r\n|\r|\n/);

  for (const rawLine of lines) {
    const match = LABEL_VALUE_LINE.exec(rawLine);
    if (!match) continue;
    const [, rawLabel, rawValue] = match;
    const value = rawValue.trim();
    if (!value || value.length > 300) continue;

    const normalizedLabel = normalizeLabel(rawLabel);
    const rule = SYNONYM_RULES.find(r => !seenFieldIds.has(r.field_id) && r.labelSynonyms.some(syn => normalizedLabel === syn || normalizedLabel.includes(syn)));
    if (!rule) continue;

    seenFieldIds.add(rule.field_id);
    candidates.push({
      field_id: rule.field_id,
      value,
      raw_text: rawLine.trim(),
      fact_type: rule.fact_type,
      confidence: "high",
    });
  }

  return candidates;
}

// Field ids the deterministic pass already resolved for THIS document —
// the AI sweep (lib/tds-doc-facts.ts) skips these, avoiding a slower,
// lower-confidence re-derivation of the same fact.
export function deterministicallyResolvedFieldIds(candidates: DeterministicFactCandidate[]): Set<string> {
  return new Set(candidates.filter(c => c.fact_type === "grounded_field").map(c => c.field_id));
}
