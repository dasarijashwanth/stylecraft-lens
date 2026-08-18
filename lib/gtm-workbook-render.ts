// lib/gtm-workbook-render.ts
// Surgically fills the 3 target tabs (Product Knowledge, BOX ONLY, Product
// FAQ) of an uploaded official GTM workbook template, leaving every other
// zip part byte-for-byte untouched. Same discipline as lib/deck-render.ts:
// open the OOXML zip with PizZip, do targeted string/regex surgery on only
// the exact spans that change, never a full DOM parse/rebuild. New values
// are written as inline strings (t="inlineStr"), never appended to
// xl/sharedStrings.xml — that file (and therefore every OTHER sheet that
// also references it) is never touched.
import PizZip from "pizzip";
import { mapSheetNamesToParts } from "./gtm-workbook-template-parser";

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function xmlEscapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function xmlUnescapeText(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, "&");
}

function normalizeLabel(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// One row's raw XML span, with its absolute position within the FULL sheet
// string it was parsed from (so callers can splice the sheet string using
// these offsets directly).
interface ParsedRow {
  rowNum: number;
  startIndex: number;
  endIndex: number;
  xml: string;
}

const ROW_REGEX = /<row r="(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/row>)/g;

function parseRows(sheetXml: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const re = new RegExp(ROW_REGEX);
  let m: RegExpExecArray | null;
  while ((m = re.exec(sheetXml))) {
    rows.push({ rowNum: parseInt(m[1], 10), startIndex: m.index, endIndex: m.index + m[0].length, xml: m[0] });
  }
  return rows;
}

function cellRegex(addr: string): RegExp {
  return new RegExp(`<c r="${escapeRegex(addr)}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
}

// Resolves a cell's display text regardless of encoding (shared string,
// inline string, or a formula's cached string/numeric result) — scoped to
// ANY xml string containing the cell (a full sheet, or a single row's XML).
export function readCellText(scopeXml: string, sharedStrings: string[], addr: string): string {
  const match = scopeXml.match(cellRegex(addr));
  if (!match) return "";
  const tag = match[0];
  const type = attr(tag, "t");

  if (type === "s") {
    const idxMatch = tag.match(/<v>(\d+)<\/v>/);
    if (!idxMatch) return "";
    return sharedStrings[parseInt(idxMatch[1], 10)] ?? "";
  }
  if (type === "inlineStr") {
    const texts = Array.from(tag.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map(m => xmlUnescapeText(m[1]));
    return texts.join("");
  }
  // t="str" (formula cached string result), or untyped (bare number) — both
  // carry their display value in <v>.
  const vMatch = tag.match(/<v>([\s\S]*?)<\/v>/);
  return vMatch ? xmlUnescapeText(vMatch[1]) : "";
}

// Scans every row's label-column cell for a normalized match against
// `needle` — returns the FIRST matching row number AFTER `afterRow`
// (default 0, i.e. the first match anywhere), or null. Tolerant of a
// shifted row (never a hardcoded row number) and of the template's own
// trailing spaces/line breaks in labels (e.g. "Core Consumer "). The
// `afterRow` cursor is what disambiguates a label reused across sections
// (e.g. "Qty"/"Type"/"Color" under Lids/Lever/Guards) — the data mapper
// walks its field list in the template's own known top-to-bottom order,
// always searching forward from wherever the previous field resolved, so
// the 2nd "Qty" search naturally lands on Lever's row, never Lids' again.
export function findRowByLabel(sheetXml: string, sharedStrings: string[], labelColumn: string, needle: string, afterRow = 0): number | null {
  const target = normalizeLabel(needle);
  for (const row of parseRows(sheetXml)) {
    if (row.rowNum <= afterRow) continue;
    const text = readCellText(row.xml, sharedStrings, `${labelColumn}${row.rowNum}`);
    if (!text) continue;
    const normalized = normalizeLabel(text);
    if (normalized === target || normalized.startsWith(target)) return row.rowNum;
  }
  return null;
}

// Same as findRowByLabel but returns EVERY match in row order — needed for
// Product FAQ's repeated "Q:"/"A:" labels, where only position (1st match =
// pair 1, 2nd = pair 2, ...) disambiguates which pair a row belongs to.
export function findAllRowsByLabel(sheetXml: string, sharedStrings: string[], labelColumn: string, needle: string): number[] {
  const target = normalizeLabel(needle);
  const rowNums: number[] = [];
  for (const row of parseRows(sheetXml)) {
    const text = readCellText(row.xml, sharedStrings, `${labelColumn}${row.rowNum}`);
    if (!text) continue;
    if (normalizeLabel(text) === target) rowNums.push(row.rowNum);
  }
  return rowNums;
}

export interface CellWriteReport {
  hadFormula: boolean;
  oldFormula?: string;
}

// Replaces exactly one cell's XML span with a fresh inlineStr cell (or an
// empty self-closing cell for ""), preserving its existing `s` (style)
// attribute untouched — wrap/font/border/color survive because the style
// index itself is never touched, only the cell's value/type. Any existing
// formula (<f>...</f>, e.g. BOX ONLY's =#REF!/mis-pointed cross-sheet refs)
// is dropped entirely, never repaired — the caller can inspect the
// returned report to log a repair.
export function writeCell(sheetXml: string, addr: string, value: string): { xml: string; report: CellWriteReport } {
  const match = sheetXml.match(cellRegex(addr));
  if (!match) return { xml: sheetXml, report: { hadFormula: false } };

  const tag = match[0];
  const style = attr(tag, "s");
  const formulaMatch = tag.match(/<f>([\s\S]*?)<\/f>/);
  const report: CellWriteReport = formulaMatch ? { hadFormula: true, oldFormula: formulaMatch[1] } : { hadFormula: false };

  const styleAttr = style != null ? ` s="${style}"` : "";
  const trimmed = value ?? "";
  const newCell = trimmed === ""
    ? `<c r="${addr}"${styleAttr}/>`
    : `<c r="${addr}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEscapeText(trimmed)}</t></is></c>`;

  const xml = sheetXml.slice(0, match.index) + newCell + sheetXml.slice((match.index as number) + tag.length);
  return { xml, report };
}

export function writeCells(sheetXml: string, writes: { addr: string; value: string }[]): { xml: string; reports: ({ addr: string } & CellWriteReport)[] } {
  let xml = sheetXml;
  const reports: ({ addr: string } & CellWriteReport)[] = [];
  for (const w of writes) {
    const result = writeCell(xml, w.addr, w.value);
    xml = result.xml;
    if (result.report.hadFormula) reports.push({ addr: w.addr, ...result.report });
  }
  return { xml, reports };
}

// Renumbers one row's `r` attribute and every child cell's `r="{COL}{N}"`
// reference by `delta` — used both to shift existing rows out of the way
// and to place cloned template rows at their new position.
function renumberRow(rowXml: string, oldNum: number, newNum: number): string {
  let xml = rowXml.replace(new RegExp(`^<row r="${oldNum}"`), `<row r="${newNum}"`);
  xml = xml.replace(new RegExp(`r="([A-Z]+)${oldNum}"`, "g"), (_, col) => `r="${col}${newNum}"`);
  return xml;
}

// The one structural edit in this module: grows Product FAQ's 3 existing
// Q:/A:/blank-row triads to `3 + newPairCount` by (1) shifting every row
// after `afterRow` down by `3*newPairCount`, (2) cloning the LAST existing
// triad's styles for each new triad and splicing them in at the vacated
// range. Confirmed safe against the real template: no <dimension> element
// to fix, its one <dataValidation> sits above the insertion point, and its
// leftover empty <drawing> part has zero row-anchored content — nothing
// else in this sheet references an absolute row number in the shifted zone.
export function insertFaqRows(sheetXml: string, afterRow: number, newPairCount: number): string {
  if (newPairCount <= 0) return sheetXml;
  const shiftAmount = 3 * newPairCount;
  const rows = parseRows(sheetXml);

  const templateQRow = rows.find(r => r.rowNum === afterRow - 2);
  const templateARow = rows.find(r => r.rowNum === afterRow - 1);
  const templateBlankRow = rows.find(r => r.rowNum === afterRow);
  if (!templateQRow || !templateARow || !templateBlankRow) {
    throw new Error(`insertFaqRows: could not find the Q/A/blank template triad ending at row ${afterRow}`);
  }

  let newRowsXml = "";
  for (let i = 0; i < newPairCount; i++) {
    const qRowNum = afterRow + 1 + i * 3;
    const aRowNum = qRowNum + 1;
    const blankRowNum = qRowNum + 2;
    newRowsXml += renumberRow(templateQRow.xml, templateQRow.rowNum, qRowNum);
    newRowsXml += renumberRow(templateARow.xml, templateARow.rowNum, aRowNum);
    newRowsXml += renumberRow(templateBlankRow.xml, templateBlankRow.rowNum, blankRowNum);
  }

  const firstRowStart = rows.length ? rows[0].startIndex : sheetXml.length;
  const lastRowEnd = rows.length ? rows[rows.length - 1].endIndex : firstRowStart;

  let body = "";
  for (const row of rows) {
    if (row.rowNum <= afterRow) {
      body += row.xml;
      if (row.rowNum === afterRow) body += newRowsXml;
    } else {
      body += renumberRow(row.xml, row.rowNum, row.rowNum + shiftAmount);
    }
  }

  return sheetXml.slice(0, firstRowStart) + body + sheetXml.slice(lastRowEnd);
}

function parseSharedStrings(zip: PizZip): string[] {
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

export interface OpenGtmWorkbook {
  zip: PizZip;
  sharedStrings: string[];
  sheetParts: Record<string, string>;
  getSheetXml(sheetName: string): string;
  setSheetXml(sheetName: string, xml: string): void;
}

export function openGtmWorkbook(templateBuffer: Buffer): OpenGtmWorkbook {
  const zip = new PizZip(templateBuffer);
  const sheetParts = mapSheetNamesToParts(zip);
  const sharedStrings = parseSharedStrings(zip);

  return {
    zip,
    sharedStrings,
    sheetParts,
    getSheetXml(sheetName: string): string {
      const part = sheetParts[sheetName];
      if (!part) throw new Error(`GTM workbook template has no sheet named "${sheetName}"`);
      const xml = zip.file(part)?.asText();
      if (xml == null) throw new Error(`GTM workbook template's "${sheetName}" part (${part}) could not be read`);
      return xml;
    },
    setSheetXml(sheetName: string, xml: string): void {
      const part = sheetParts[sheetName];
      if (!part) throw new Error(`GTM workbook template has no sheet named "${sheetName}"`);
      zip.file(part, xml);
    },
  };
}

export function generateGtmWorkbookBuffer(workbook: OpenGtmWorkbook): Buffer {
  return workbook.zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

// Reorders + relabels a tab in the OUTPUT file only — xl/workbook.xml's
// <sheets> list order is what Excel actually uses for left-to-right tab
// position (independent of sheetId/the physical sheetN.xml part number), so
// this never touches the sheet's own worksheet XML, styles, or any other
// zip part. Every OTHER call site in this module (applySteps,
// mapSheetNamesToParts, etc.) still looks the sheet up by its ORIGINAL name
// via workbook.sheetParts (resolved once at openGtmWorkbook() time) — this
// must therefore run LAST, after every getSheetXml/setSheetXml call for that
// sheet has already completed, matching how renderGtmWorkbook calls it.
// A no-op (never throws) if either sheet name isn't found — a future
// template re-upload that renamed/removed a tab degrades to "unchanged
// order" rather than a broken export.
export function repositionAndRenameSheet(zip: PizZip, sheetName: string, afterSheetName: string, newDisplayName: string): void {
  const workbookXml = zip.file("xl/workbook.xml")?.asText();
  if (!workbookXml) return;

  const sheetTagPattern = (name: string) => new RegExp(`<sheet\\b[^>]*name="${escapeRegex(name)}"[^>]*/>`);
  const targetMatch = workbookXml.match(sheetTagPattern(sheetName));
  const afterMatch = workbookXml.match(sheetTagPattern(afterSheetName));
  if (!targetMatch || !afterMatch) return;

  const targetTag = targetMatch[0];
  const afterTag = afterMatch[0];
  const renamedTag = targetTag.replace(`name="${sheetName}"`, `name="${newDisplayName}"`);

  const withoutTarget = workbookXml.replace(targetTag, "");
  const reordered = withoutTarget.replace(afterTag, `${afterTag}${renamedTag}`);

  zip.file("xl/workbook.xml", reordered);
}
