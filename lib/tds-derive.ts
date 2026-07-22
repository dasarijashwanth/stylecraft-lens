// Deterministic, code-only floor-fill for the Technical Data Sheet from the
// widened Rainforest Amazon payload (lib/rainforest.ts) — extracted out of
// lib/tds-generate.ts so the field list it fills can grow (see the
// country_of_origin/material/safety_notes additions below, all backed by
// lib/rainforest.ts's widened findSpec search over specifications+attributes)
// without touching the AI-call plumbing around it. Only fills a field the AI
// left at "none" — never overwrites a real answer the AI (or the project
// record) already supplied.
import { TdsFieldAnswer } from "./tds-field-schema";

export function deriveTdsFieldsFromAmazon(
  result: Record<string, TdsFieldAnswer>,
  az: any | null | undefined
): void {
  if (!az) return;

  // Rainforest's real listing URL is a more useful citation than the
  // constructed /dp/{asin} URL when present.
  const sourceUrl = az.link || az.amazon_url;

  const fillFromAmazon = (id: string, value: string | null | undefined) => {
    if (value && result[id]?.source === "none") {
      result[id] = { answer: value, source: "amazon", sourceDetail: { url: sourceUrl, retrieved_at: az.last_updated } };
    }
  };

  fillFromAmazon("manufacturer", az.manufacturer);
  fillFromAmazon("model_number", az.model_number);
  fillFromAmazon("product_description", az.description);
  fillFromAmazon("product_lwh", az.dimensions);
  fillFromAmazon("product_weight", az.weight);
  fillFromAmazon("country_of_origin", az.country_of_origin);
  fillFromAmazon("material", az.material);
  // Amazon's "Important information" block (warnings/compliance/safety
  // copy) is the closest real, verbatim source for safety_notes.
  fillFromAmazon("safety_notes", az.important_information);

  if (Array.isArray(az.whats_in_the_box) && az.whats_in_the_box.length) {
    fillFromAmazon("whats_in_box_list", az.whats_in_the_box.join("; "));
  }

  const specAndAttr = [
    ...(Array.isArray(az.specifications) ? az.specifications : []),
    ...(Array.isArray(az.attributes) ? az.attributes : []),
  ];
  const voltageSpec = specAndAttr.find((s: any) => /voltage/i.test(s?.name || ""))?.value;
  fillFromAmazon("charging_voltage", voltageSpec);
}
