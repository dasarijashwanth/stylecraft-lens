// lib/gtm-workbook-template-parser.ts
// Upload-time validation for the official GTM workbook .xlsx template — maps
// each sheet's display name to its worksheet XML part path inside the
// OOXML zip, resolved fresh from xl/workbook.xml + its .rels every time
// (never a hardcoded "sheet3.xml" — a re-saved/re-exported workbook can
// renumber these). Same "regex over raw XML, no full parse" discipline as
// lib/deck-template-parser.ts's getPresentationOrderSlides.
import PizZip from "pizzip";

export interface GtmWorkbookSheetSummary {
  sheetNames: string[];
  missingRequiredSheets: string[];
}

// The 3 tabs this export feature fills — every other tab in the workbook
// (Product, Product Testing, Austin Review, Product Purchasing, Creative
// Playbook, GTM Plan Deliverables/Asana Proj, Sampling Program) is exported
// byte-for-byte untouched.
export const REQUIRED_GTM_WORKBOOK_SHEETS = ["Product Knowledge", "BOX ONLY", "Product FAQ", "Final Copy"];

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

// Sheet display name -> its worksheet XML part path (e.g. "xl/worksheets/sheet3.xml").
export function mapSheetNamesToParts(zip: PizZip): Record<string, string> {
  const workbookXml = zip.file("xl/workbook.xml")?.asText();
  const relsXml = zip.file("xl/_rels/workbook.xml.rels")?.asText();
  if (!workbookXml || !relsXml) return {};

  const relIdToTarget = new Map<string, string>();
  const relTagRegex = /<Relationship\b[^>]*\/>/g;
  let relMatch: RegExpExecArray | null;
  while ((relMatch = relTagRegex.exec(relsXml))) {
    const tag = relMatch[0];
    const id = attr(tag, "Id");
    const target = attr(tag, "Target");
    if (id && target) relIdToTarget.set(id, target);
  }

  const result: Record<string, string> = {};
  const sheetTagRegex = /<sheet\b[^>]*\/>/g;
  let sheetMatch: RegExpExecArray | null;
  while ((sheetMatch = sheetTagRegex.exec(workbookXml))) {
    const tag = sheetMatch[0];
    const name = attr(tag, "name");
    const rId = attr(tag, "r:id");
    if (!name || !rId) continue;
    const target = relIdToTarget.get(rId);
    if (!target) continue;
    const partPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    result[name] = partPath;
  }
  return result;
}

export function buildSheetSummary(zip: PizZip): GtmWorkbookSheetSummary {
  const sheetNames = Object.keys(mapSheetNamesToParts(zip));
  const missingRequiredSheets = REQUIRED_GTM_WORKBOOK_SHEETS.filter(s => !sheetNames.includes(s));
  return { sheetNames, missingRequiredSheets };
}

// Called at upload/finalize time — a template missing any of the 3 required
// sheets is rejected before it's ever stored as a candidate active template.
export function parseGtmWorkbookTemplate(buffer: Buffer): GtmWorkbookSheetSummary {
  const zip = new PizZip(buffer);
  return buildSheetSummary(zip);
}
