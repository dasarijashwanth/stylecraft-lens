// lib/gtm-workbook-inspection.ts
// GTM Multi-Template work, Part 1.2 — "template inspection on upload."
// Orchestrates lib/gtm-workbook-template-parser.ts's low-level label reader
// against lib/gtm-workbook-data-mapper.ts's known barber reference labels.
// Lives in its own file (rather than in either of those two) because it
// needs BOTH — template-parser.ts and gtm-workbook-render.ts (which
// data-mapper.ts itself depends on) already import from each other, so
// pulling data-mapper.ts's reference labels directly into template-parser.ts
// would create a circular import.
import PizZip from "pizzip";
import { inspectGtmWorkbookLabels, diffTemplateLabels, LabelDiff } from "./gtm-workbook-template-parser";
import { getReferenceLabelsForSheet } from "./gtm-workbook-data-mapper";

// The 5 tabs the export engine actually fills — see
// lib/gtm-workbook-render.ts/gtm-workbook-data-mapper.ts. Only run for a
// BEAUTY upload; a barber upload IS the reference, nothing to diff it
// against.
const CONTENT_TABS = ["Product Knowledge", "BOX ONLY", "Marketing Direction", "Product FAQ", "Final Copy"] as const;

export type GtmTemplateFieldInspection = Record<string, LabelDiff>;

// Called at upload/finalize time for a beauty-industry template (see
// app/api/admin/gtm-workbook-templates/route.ts and .../finalize/route.ts).
// Stored on gtm_workbook_templates.field_inspection and rendered in Settings
// so an admin can see exactly what shares a label with barber, what's new
// to this template, and what barber has that this template is missing —
// before ever trusting the export.
export function buildGtmTemplateFieldInspection(buffer: Buffer): GtmTemplateFieldInspection {
  const zip = new PizZip(buffer);
  const result: GtmTemplateFieldInspection = {};
  for (const sheetName of CONTENT_TABS) {
    const candidateLabels = inspectGtmWorkbookLabels(zip, sheetName, "A").map(l => l.text);
    const referenceLabels = getReferenceLabelsForSheet(sheetName);
    result[sheetName] = diffTemplateLabels(candidateLabels, referenceLabels);
  }
  return result;
}
