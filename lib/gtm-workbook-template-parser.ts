// lib/gtm-workbook-template-parser.ts
// Upload-time validation for the official GTM workbook .xlsx template — maps
// each sheet's display name to its worksheet XML part path inside the
// OOXML zip, resolved fresh from xl/workbook.xml + its .rels every time
// (never a hardcoded "sheet3.xml" — a re-saved/re-exported workbook can
// renumber these). Same "regex over raw XML, no full parse" discipline as
// lib/deck-template-parser.ts's getPresentationOrderSlides.
import PizZip from "pizzip";
import { assertZipSafe } from "./zip-safety";

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
// Security audit fix — assertZipSafe (thrown ZipBombError propagates to the
// caller's try/catch, which the upload/finalize routes already have) runs
// before buildSheetSummary ever reads any entry's content.
export function parseGtmWorkbookTemplate(buffer: Buffer): GtmWorkbookSheetSummary {
  const zip = new PizZip(buffer);
  assertZipSafe(zip);
  return buildSheetSummary(zip);
}

// ---- GTM Multi-Template work — Part 1.2 "template inspection on upload" ----
// Small self-contained cell/row readers, deliberately NOT imported from
// lib/gtm-workbook-render.ts (which itself imports mapSheetNamesToParts from
// THIS file) — sharing them would create a circular import. Same "each file
// keeps its own narrow XML helpers" precedent this file's own `attr()`
// already follows relative to gtm-workbook-render.ts's separate copy.
function xmlUnescapeText(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, "&");
}

function parseSharedStringsForInspection(zip: PizZip): string[] {
  const xml = zip.file("xl/sharedStrings.xml")?.asText();
  if (!xml) return [];
  const result: string[] = [];
  const siRegex = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRegex.exec(xml))) {
    const texts = Array.from(m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map(x => xmlUnescapeText(x[1]));
    result.push(texts.join(""));
  }
  return result;
}

function readInspectionCellText(rowXml: string, sharedStrings: string[], addr: string): string {
  const match = rowXml.match(new RegExp(`<c r="${addr}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`));
  if (!match) return "";
  const tag = match[0];
  const type = attr(tag, "t");
  if (type === "s") {
    const idxMatch = tag.match(/<v>(\d+)<\/v>/);
    return idxMatch ? sharedStrings[parseInt(idxMatch[1], 10)] ?? "" : "";
  }
  if (type === "inlineStr") {
    return Array.from(tag.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map(m2 => xmlUnescapeText(m2[1])).join("");
  }
  const vMatch = tag.match(/<v>([\s\S]*?)<\/v>/);
  return vMatch ? xmlUnescapeText(vMatch[1]) : "";
}

export interface InspectedLabel {
  row: number;
  text: string;
}

// Every non-empty label found in `labelColumn`, in row order — the
// inspection counterpart to gtm-workbook-render.ts's findRowByLabel (which
// searches FOR one label instead of listing all of them).
export function inspectGtmWorkbookLabels(zip: PizZip, sheetName: string, labelColumn: string): InspectedLabel[] {
  const parts = mapSheetNamesToParts(zip);
  const part = parts[sheetName];
  if (!part) return [];
  const sheetXml = zip.file(part)?.asText();
  if (!sheetXml) return [];

  const sharedStrings = parseSharedStringsForInspection(zip);
  const out: InspectedLabel[] = [];
  const rowRegex = /<row r="(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/row>)/g;
  let m: RegExpExecArray | null;
  while ((m = rowRegex.exec(sheetXml))) {
    const rowNum = parseInt(m[1], 10);
    const text = readInspectionCellText(m[0], sharedStrings, `${labelColumn}${rowNum}`).trim();
    if (text) out.push({ row: rowNum, text });
  }
  return out;
}

export interface LabelDiff {
  shared: string[];
  candidateOnly: string[];
  referenceOnly: string[];
}

function normalizeForDiff(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

// Prefix-tolerant match — mirrors gtm-workbook-render.ts's findRowByLabel
// exactly (`normalized === target || normalized.startsWith(target)`, tried
// in both directions here since either side could be the shorter one). The
// reference labels passed in are themselves SHORT SEARCH PREFIXES (e.g.
// "Primary Goal", not the real template's full multi-line cell text "Primary
// Goal \n(ex: Drive trial, awareness...)") — an exact-string diff would
// therefore mark almost every real field as mismatched even when it's the
// exact row findRowByLabel would happily resolve at export time.
function labelsMatch(a: string, b: string): boolean {
  const na = normalizeForDiff(a);
  const nb = normalizeForDiff(b);
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

// Plain, deterministic diff (no fuzzy/ML matching, just prefix tolerance)
// between a newly-inspected template's labels and a reference template's
// known (search-prefix) labels — surfaces exactly what's shared,
// candidate-only (new to this template), and reference-only (present in
// the reference but missing here) for an admin to review before trusting
// the export. A genuine rename (e.g. beauty's "Collection" vs barber's
// "New Line or Current Collection?", which share no common prefix) still
// shows up as one entry in each of candidateOnly/referenceOnly —
// informational, not auto-resolved.
export function diffTemplateLabels(candidateLabels: string[], referenceLabels: string[]): LabelDiff {
  return {
    shared: candidateLabels.filter(l => referenceLabels.some(r => labelsMatch(l, r))),
    candidateOnly: candidateLabels.filter(l => !referenceLabels.some(r => labelsMatch(l, r))),
    referenceOnly: referenceLabels.filter(r => !candidateLabels.some(l => labelsMatch(l, r))),
  };
}
