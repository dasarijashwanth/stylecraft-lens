// lib/tds-doc-extract.ts
// Uploaded TDS Ingestion, Part 1 — format-dispatching text/table extraction
// for an externally-authored source document (PDF/XLSX/DOCX). Produces a
// single `fullText` (+ location-indexed breakdown) regardless of input
// format, which lib/tds-doc-facts.ts then turns into structured facts.
// This is NOT the app's own (disabled) TDS-generation feature — no
// scraping, no AI product-identification, just reading a file a human
// already wrote.
import PizZip from "pizzip";
import * as XLSX from "xlsx";
import { PDFParse } from "pdf-parse";
import { createResponseWithRetry, hasOpenAIKey, OPENAI_MODEL } from "./openai";
import { genAI, hasGeminiKey, GEMINI_MODEL } from "./gemini";
import { sanitizeText } from "./sanitize";

export type SourceDocFormat = "pdf" | "xlsx" | "docx";

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

export async function extractPdfContent(buffer: Buffer): Promise<ExtractedDocContent> {
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    await parser.destroy();

    const pages = result.pages || [];
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

export async function extractSourceDocContent(buffer: Buffer, format: SourceDocFormat): Promise<ExtractedDocContent> {
  const result =
    format === "pdf" ? await extractPdfContent(buffer) :
    format === "xlsx" ? await extractXlsxContent(buffer) :
    await extractDocxContent(buffer);

  return { ...result, fullText: sanitizeText(result.fullText) || "" };
}
