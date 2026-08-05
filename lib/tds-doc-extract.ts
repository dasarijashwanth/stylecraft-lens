// lib/tds-doc-extract.ts
// Uploaded TDS Ingestion, Part 1 — format-dispatching text/table extraction
// for an externally-authored source document (PDF/XLSX/DOCX). Produces a
// single `fullText` (+ location-indexed breakdown) regardless of input
// format, which lib/tds-doc-facts.ts then turns into structured facts.
// This is NOT the app's own (disabled) TDS-generation feature — no
// scraping, no AI product-identification, just reading a file a human
// already wrote.
// MUST be the first import in this file, before "pdf-parse" — sets the
// DOMMatrix global pdfjs-dist's Node build otherwise crashes on at module
// load. See that file's own header comment for the full story.
import "./pdf-dommatrix-polyfill";
import PizZip from "pizzip";
import * as XLSX from "xlsx";
import { PDFParse } from "pdf-parse";
import { createResponseWithRetry, hasOpenAIKey, OPENAI_MODEL } from "./openai";
import { genAI, hasGeminiKey, GEMINI_MODEL } from "./gemini";
import { sanitizeText } from "./sanitize";

export type SourceDocFormat = "pdf" | "xlsx" | "docx" | "doc" | "xls" | "csv";

export interface ExtractedLocation {
  label: string; // e.g. "p.3", "Motor sheet, row 12"
  text: string;
}

export interface ExtractedDocContent {
  fullText: string;
  locations: ExtractedLocation[];
  extractionStatus: "complete" | "failed";
  extractionMethod: "text-layer" | "ocr" | "spreadsheet" | "docx" | "failed";
}

// A real text-layer PDF page routinely has hundreds of characters; well
// under this per-page average means the PDF is scanned/image-based and the
// text layer is empty or near-empty — falls back to vision-based OCR.
const SCANNED_PDF_MIN_CHARS_PER_PAGE = 40;

async function extractPdfTextViaOpenAiVision(buffer: Buffer): Promise<string | null> {
  if (!hasOpenAIKey) return null;
  try {
    const response: any = await createResponseWithRetry(
      {
        model: OPENAI_MODEL,
        reasoning: { effort: "low" },
        input: [
          {
            role: "user",
            content: [
              { type: "input_file", filename: "document.pdf", file_data: `data:application/pdf;base64,${buffer.toString("base64")}` },
              { type: "input_text", text: "Transcribe every page of this document verbatim, in order. Prefix each page with a line reading exactly \"[PAGE N]\" (N = 1-indexed page number). Do not summarize, translate, or omit any text — this is a scanned technical data sheet and every spec/number matters." },
            ],
          },
        ],
      },
      45_000
    );
    const message = (response.output || []).find((o: any) => o.type === "message");
    const textBlock = message?.content?.find((c: any) => c.type === "output_text");
    return textBlock?.text || response.output_text || null;
  } catch (err) {
    console.warn("OpenAI PDF vision transcription failed:", err);
    return null;
  }
}

async function extractPdfTextViaGeminiVision(buffer: Buffer): Promise<string | null> {
  if (!hasGeminiKey) return null;
  try {
    const message = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        { inlineData: { mimeType: "application/pdf", data: buffer.toString("base64") } },
        { text: "Transcribe every page of this document verbatim, in order. Prefix each page with a line reading exactly \"[PAGE N]\" (N = 1-indexed page number). Do not summarize, translate, or omit any text — this is a scanned technical data sheet and every spec/number matters." },
      ],
    });
    return message.text || null;
  } catch (err) {
    console.warn("Gemini PDF vision transcription failed:", err);
    return null;
  }
}

// Splits a "[PAGE N]\n...text..." transcription (from either vision
// fallback) back into per-page locations, mirroring pdf-parse's own
// {num, text} shape so both paths feed the same downstream code.
export function splitVisionTranscriptIntoPages(transcript: string): ExtractedLocation[] {
  const parts = transcript.split(/\[PAGE\s+(\d+)\]/i).slice(1);
  const locations: ExtractedLocation[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const pageNum = parts[i];
    const text = (parts[i + 1] || "").trim();
    if (text) locations.push({ label: `p.${pageNum}`, text });
  }
  return locations.length ? locations : [{ label: "p.1", text: transcript.trim() }];
}

// Regression fix — a live "Server took too long to respond" report for a
// large (10-15MB), NORMAL text-layer PDF (not scanned, so the OCR fallback
// below never even triggers). withDeadline can only race away genuinely
// async/network-bound work; it can't interrupt pdf-parse's own page-by-page
// text extraction if that work is CPU-heavy enough to not yield back to the
// event loop for long stretches — for a many-page, visually complex PDF,
// this can run long enough on Vercel's constrained runtime to blow the
// platform's own 60s hard cap regardless of what our OWN deadline constant
// says (shrinking that number doesn't reduce the actual work being done).
// The real fix: bound the amount of WORK itself, not just how long we're
// willing to wait for it — pdf-parse's own `first` option caps parsing to
// the document's first N pages. A real technical data sheet/spec document
// is virtually always well under this cap; a genuinely huge multi-hundred-
// page manual gets a partial-but-fast extraction (still enough real text
// for fact-extraction to work with) instead of a slow, all-or-nothing
// attempt at the entire document.
const MAX_PDF_PAGES_FOR_TEXT_EXTRACTION = 60;

export async function extractPdfContent(buffer: Buffer): Promise<ExtractedDocContent> {
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText({ first: MAX_PDF_PAGES_FOR_TEXT_EXTRACTION });
    await parser.destroy();

    const pages = result.pages || [];
    if (result.total > pages.length) {
      console.warn(`[tds-doc-extract] PDF has ${result.total} pages — only the first ${pages.length} were parsed (MAX_PDF_PAGES_FOR_TEXT_EXTRACTION cap) to keep extraction time bounded.`);
    }
    const avgCharsPerPage = pages.length ? result.text.length / pages.length : result.text.length;

    if (pages.length > 0 && avgCharsPerPage >= SCANNED_PDF_MIN_CHARS_PER_PAGE) {
      return {
        fullText: result.text,
        locations: pages.map(p => ({ label: `p.${p.num}`, text: p.text })),
        extractionStatus: "complete",
        extractionMethod: "text-layer",
      };
    }

    // Scanned/image-based PDF (or empty) — OpenAI-first per this app's
    // established provider order (lib/openai.ts), Gemini as the legacy
    // secondary fallback, matching every other AI call site in this repo.
    const transcript = (await extractPdfTextViaOpenAiVision(buffer)) ?? (await extractPdfTextViaGeminiVision(buffer));
    if (transcript) {
      return {
        fullText: transcript,
        locations: splitVisionTranscriptIntoPages(transcript),
        extractionStatus: "complete",
        extractionMethod: "ocr",
      };
    }

    // Text layer was too thin AND no vision provider was available/worked —
    // still return whatever thin text-layer content exists rather than
    // nothing at all.
    return {
      fullText: result.text,
      locations: pages.map(p => ({ label: `p.${p.num}`, text: p.text })),
      extractionStatus: result.text.trim() ? "complete" : "failed",
      extractionMethod: "text-layer",
    };
  } catch (err) {
    console.warn("PDF extraction failed:", err);
    return { fullText: "", locations: [], extractionStatus: "failed", extractionMethod: "failed" };
  }
}

// Generic 2-column (label, value) heuristic for a sheet that isn't our own
// known Item/Answer layout — most real-world spec-sheet exports look like
// this (a "Spec" column and a "Value" column, or similar).
function sheetToText(sheetName: string, rows: any[][]): string {
  const lines: string[] = [];
  for (const row of rows) {
    const cells = row.map(c => (c == null ? "" : String(c).trim())).filter(Boolean);
    if (cells.length) lines.push(cells.join(": "));
  }
  return lines.length ? `[Sheet: ${sheetName}]\n${lines.join("\n")}` : "";
}

export async function extractXlsxContent(buffer: Buffer): Promise<ExtractedDocContent> {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const locations: ExtractedLocation[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
      if (rows.length === 0) continue;

      const text = sheetToText(sheetName, rows);
      if (text) locations.push({ label: `${sheetName} sheet`, text });
    }

    const fullText = locations.map(l => l.text).join("\n\n");
    return {
      fullText,
      locations,
      extractionStatus: fullText.trim() ? "complete" : "failed",
      extractionMethod: "spreadsheet",
    };
  } catch (err) {
    console.warn("XLSX extraction failed:", err);
    return { fullText: "", locations: [], extractionStatus: "failed", extractionMethod: "failed" };
  }
}

// Raw XML regex over the OOXML zip, no full DOM parse — same discipline
// already established for .xlsx/.pptx templates (lib/gtm-workbook-template-parser.ts,
// lib/deck-template-parser.ts). A .docx is the same zip-of-XML shape; body
// text runs live in <w:t> tags inside xl/word/document.xml, tables in
// <w:tbl> blocks.
function extractDocxRunText(xml: string): string {
  const runs: string[] = [];
  const runRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let match: RegExpExecArray | null;
  while ((match = runRegex.exec(xml))) {
    runs.push(match[1]);
  }
  // Paragraph breaks: a </w:p> closes a paragraph in OOXML — insert a
  // newline there so the reconstructed text isn't one giant run-on line.
  return xml
    .split(/<\/w:p>/)
    .map(para => {
      const paraRuns: string[] = [];
      let m: RegExpExecArray | null;
      const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
      while ((m = re.exec(para))) paraRuns.push(m[1]);
      return paraRuns.join("");
    })
    .filter(Boolean)
    .join("\n");
}

function extractDocxTables(xml: string): string[] {
  const tables: string[] = [];
  const tableRegex = /<w:tbl>([\s\S]*?)<\/w:tbl>/g;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRegex.exec(xml))) {
    const tableXml = tableMatch[1];
    const rowTexts: string[] = [];
    const rowRegex = /<w:tr\b[\s\S]*?<\/w:tr>/g;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(tableXml))) {
      const rowXml = rowMatch[0];
      const cellTexts: string[] = [];
      const cellRegex = /<w:tc\b[\s\S]*?<\/w:tc>/g;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowXml))) {
        cellTexts.push(extractDocxRunText(cellMatch[0]).replace(/\n/g, " ").trim());
      }
      if (cellTexts.some(Boolean)) rowTexts.push(cellTexts.join(" | "));
    }
    if (rowTexts.length) tables.push(rowTexts.join("\n"));
  }
  return tables;
}

export async function extractDocxContent(buffer: Buffer): Promise<ExtractedDocContent> {
  try {
    const zip = new PizZip(buffer);
    const documentXml = zip.file("word/document.xml")?.asText();
    if (!documentXml) return { fullText: "", locations: [], extractionStatus: "failed", extractionMethod: "failed" };

    const bodyText = extractDocxRunText(documentXml);
    const tables = extractDocxTables(documentXml);

    const locations: ExtractedLocation[] = [{ label: "document body", text: bodyText }];
    tables.forEach((t, i) => locations.push({ label: `table ${i + 1}`, text: t }));

    const fullText = [bodyText, ...tables].filter(Boolean).join("\n\n");
    return {
      fullText,
      locations,
      extractionStatus: fullText.trim() ? "complete" : "failed",
      extractionMethod: "docx",
    };
  } catch (err) {
    console.warn("DOCX extraction failed:", err);
    return { fullText: "", locations: [], extractionStatus: "failed", extractionMethod: "failed" };
  }
}

// Legacy .doc (Word 97-2003 binary format, a CFB/OLE2 container — NOT
// zip-based like .docx) has no simple XML-regex equivalent to
// extractDocxContent above; a correct parse needs the file's FIB (piece
// table, character/paragraph formatting exceptions), which is a real
// undertaking. Rather than add a new dependency or leave .doc completely
// unextractable, this reuses the CFB parser SheetJS's own `xlsx` package
// already bundles (XLSX.CFB — the same reader that makes legacy .xls work)
// to locate the raw "WordDocument" stream, then sweeps it for runs of
// printable text (ASCII and UTF-16LE, the two encodings Word actually
// stores runs in). This is a best-effort heuristic, not a real Word parser
// — it will miss formatting and may include some binary noise between real
// sentences — but it surfaces genuine document text (numbers, labels,
// sentences) well enough for the downstream fact-extraction AI call to
// work with, matching this module's own "always return SOMETHING rather
// than nothing" philosophy for a failed/degraded extraction elsewhere
// (e.g. extractPdfContent's own OCR-then-thin-text-layer fallback chain).
const MIN_PRINTABLE_RUN_LENGTH = 4;

// Hard cap on how much of the stream this synchronous, single-threaded
// byte-sweep will ever scan — regression fix: an uncapped sweep over a
// real, large (multi-MB) WordDocument stream blocks the Node event loop
// for long enough to blow past Vercel's 60s maxDuration, which the
// finalize route's OWN withDeadline/routeStartTime budgeting cannot catch
// (that mechanism only races ASYNC promises via setTimeout — it can't
// interrupt synchronous CPU-bound work, since the event loop is blocked
// the whole time and never gets to check the timer). 3MB of a WordDocument
// stream is already far more raw bytes than any real spec-sheet-style
// document's actual text content, so this cap costs no real coverage in
// practice while making the worst-case runtime provably fast (a few
// hundred ms even on a maximally adversarial 15MB upload).
const MAX_DOC_SWEEP_BYTES = 3 * 1024 * 1024;

function sweepPrintableRuns(buffer: Buffer): string {
  const bounded = buffer.length > MAX_DOC_SWEEP_BYTES ? buffer.subarray(0, MAX_DOC_SWEEP_BYTES) : buffer;
  const runs: string[] = [];
  let asciiRun = "";
  let i = 0;
  while (i < bounded.length) {
    // UTF-16LE run: a printable ASCII byte followed by a 0x00 high byte is
    // Word's most common storage encoding for a plain-Latin text run.
    if (i + 1 < bounded.length && bounded[i + 1] === 0x00 && bounded[i] >= 0x20 && bounded[i] < 0x7f) {
      asciiRun += String.fromCharCode(bounded[i]);
      i += 2;
      continue;
    }
    if (bounded[i] >= 0x20 && bounded[i] < 0x7f) {
      asciiRun += String.fromCharCode(bounded[i]);
      i += 1;
      continue;
    }
    if (asciiRun.length >= MIN_PRINTABLE_RUN_LENGTH) runs.push(asciiRun);
    asciiRun = "";
    i += 1;
  }
  if (asciiRun.length >= MIN_PRINTABLE_RUN_LENGTH) runs.push(asciiRun);
  return runs.join("\n");
}

export async function extractDocContent(buffer: Buffer): Promise<ExtractedDocContent> {
  try {
    const cfb = XLSX.CFB.read(buffer, { type: "buffer" });
    const wordStream = XLSX.CFB.find(cfb, "WordDocument");
    const streamBuffer: Buffer | null = wordStream?.content ? Buffer.from(wordStream.content) : null;
    const fullText = sweepPrintableRuns(streamBuffer || buffer);
    return {
      fullText,
      locations: fullText ? [{ label: "document body (best-effort extraction)", text: fullText }] : [],
      extractionStatus: fullText.trim().length >= 20 ? "complete" : "failed",
      extractionMethod: "docx",
    };
  } catch (err) {
    console.warn("DOC (legacy binary) extraction failed:", err);
    return { fullText: "", locations: [], extractionStatus: "failed", extractionMethod: "failed" };
  }
}

// CSV is already plain text — no parsing library needed. Splits into rows
// so each row can be its own "location" (mirrors XLSX's per-sheet location
// granularity), joins cells with the same "label: value"-ish flattening
// sheetToText already uses for a 2-column spec export, since most uploaded
// CSVs of this kind ARE a 2-column (or narrow) spec export.
export async function extractCsvContent(buffer: Buffer): Promise<ExtractedDocContent> {
  try {
    const text = buffer.toString("utf-8").replace(/^﻿/, ""); // strip a UTF-8 BOM if present
    const lines = text.split(/\r\n|\r|\n/).map(l => l.trim()).filter(Boolean);
    const fullText = lines.join("\n");
    return {
      fullText,
      locations: fullText ? [{ label: "CSV rows", text: fullText }] : [],
      extractionStatus: fullText ? "complete" : "failed",
      extractionMethod: "spreadsheet",
    };
  } catch (err) {
    console.warn("CSV extraction failed:", err);
    return { fullText: "", locations: [], extractionStatus: "failed", extractionMethod: "failed" };
  }
}

export async function extractSourceDocContent(buffer: Buffer, format: SourceDocFormat): Promise<ExtractedDocContent> {
  const result =
    format === "pdf" ? await extractPdfContent(buffer) :
    // Legacy .xls (BIFF binary) needs no separate code path — SheetJS's
    // XLSX.read() auto-detects and transparently parses BIFF/XLS the same
    // way it parses OOXML/XLSX, so extractXlsxContent already handles both.
    format === "xlsx" || format === "xls" ? await extractXlsxContent(buffer) :
    format === "docx" ? await extractDocxContent(buffer) :
    format === "doc" ? await extractDocContent(buffer) :
    await extractCsvContent(buffer);

  return { ...result, fullText: sanitizeText(result.fullText) || "" };
}
