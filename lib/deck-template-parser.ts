// Upload-time token discovery for a company .pptx deck template. Token
// convention (per the product spec): {{token}} for text/date/image values,
// {{#token}}...{{/token}} for a repeating table/loop section — double-brace
// delimiters throughout, NOT docxtemplater's single-brace default. The
// renderer (lib/deck-render.ts, Phase 2) configures Docxtemplater with
// matching custom delimiters so the same template works for both parsing
// and rendering.
//
// Deliberately a plain regex scan over each slide/notes-slide's raw XML
// text rather than depending on docxtemplater's InspectModule internals
// (nullValues/fullInspected shapes are lightly documented and version-
// sensitive) — a direct scan for the exact, known {{...}} syntax is simpler
// and fully reliable for token DISCOVERY. Token CLASSIFICATION (kind) is
// resolved against the registry at buildDefaultPlaceholderMap() time, not
// guessed from XML structure — an unknown token defaults to "text" here and
// is flagged unmapped for an admin to correct if it's actually an image/table.
import PizZip from "pizzip";
import { DeckTokenKind, DeckTokenOccurrence } from "./deck-types";
import { normalizeSplitTokenRuns } from "./deck-run-merge";
import { assertZipSafe } from "./zip-safety";

export interface ParsedDeckToken {
  token: string;
  kind: DeckTokenKind;
  occurrences: DeckTokenOccurrence[];
  imageBoxPx?: { width: number; height: number };
}

export interface ParsedDeckTemplate {
  slideCount: number;
  tokens: ParsedDeckToken[];
}

const EMU_PER_INCH = 914400;
const PX_PER_INCH = 96;
function emuToPx(emu: number): number {
  return Math.round((emu / EMU_PER_INCH) * PX_PER_INCH);
}

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const LOOP_PATTERN = /\{\{#\s*([a-zA-Z0-9_]+)\s*\}\}([\s\S]*?)\{\{\/\s*\1\s*\}\}/g;

// Presentation-order slide list: [{ slideIndex, partPath, relId }], ordered
// by <p:sldIdLst> + its .rels — NOT raw ppt/slides/slideN.xml filename
// order, since PowerPoint reordering desyncs the two. Exported so
// lib/deck-render.ts's fill-or-hide slide removal can key off the same
// relationship IDs (removal must survive slide reordering too).
export function getPresentationOrderSlides(zip: PizZip): { slideIndex: number; partPath: string; relId: string }[] {
  const presentationXml = zip.file("ppt/presentation.xml")?.asText();
  const relsXml = zip.file("ppt/_rels/presentation.xml.rels")?.asText();
  if (!presentationXml || !relsXml) return [];

  const relIdToTarget = new Map<string, string>();
  const relRegex = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let relMatch: RegExpExecArray | null;
  while ((relMatch = relRegex.exec(relsXml))) {
    relIdToTarget.set(relMatch[1], relMatch[2]);
  }

  const sldIdListMatch = presentationXml.match(/<p:sldIdLst[^>]*>([\s\S]*?)<\/p:sldIdLst>/);
  if (!sldIdListMatch) return [];
  const sldIdRegex = /<p:sldId[^>]*r:id="([^"]+)"/g;
  const orderedRelIds: string[] = [];
  let sldMatch: RegExpExecArray | null;
  while ((sldMatch = sldIdRegex.exec(sldIdListMatch[1]))) {
    orderedRelIds.push(sldMatch[1]);
  }

  return orderedRelIds
    .map((relId, i) => {
      const target = relIdToTarget.get(relId);
      if (!target) return null;
      const partPath = target.startsWith("/") ? target.slice(1) : `ppt/${target}`;
      return { slideIndex: i + 1, partPath, relId };
    })
    .filter((x): x is { slideIndex: number; partPath: string; relId: string } => x !== null);
}

// The notes-slide paired with a given slide, found via that slide's own
// _rels file (relationship type ".../notesSlide"). Exported for
// lib/deck-render.ts's fill-or-hide removal (a removed slide's paired
// notes-slide part must be removed too).
export function getNotesSlidePart(zip: PizZip, slidePartPath: string): string | null {
  const slideFileName = slidePartPath.split("/").pop();
  if (!slideFileName) return null;
  const dir = slidePartPath.slice(0, slidePartPath.length - slideFileName.length);
  const relsPath = `${dir}_rels/${slideFileName}.rels`;
  const relsXml = zip.file(relsPath)?.asText();
  if (!relsXml) return null;
  const match = relsXml.match(/<Relationship[^>]*Type="[^"]*notesSlide"[^>]*Target="([^"]+)"/);
  if (!match) return null;
  const normalized = match[1].replace(/^(\.\.\/)+/, "");
  return `ppt/${normalized}`;
}

// Best-effort: find the nearest enclosing shape's real frame geometry
// (<a:ext cx=".." cy="..">) around a token's position in the slide XML.
// Only succeeds when the token sits inside a real picture/text placeholder
// shape with explicit geometry — returns undefined otherwise (the renderer
// falls back to a configured default box).
function findImageBoxPx(slideXml: string, tokenIndex: number, tokenLength: number): { width: number; height: number } | undefined {
  const before = slideXml.slice(0, tokenIndex);
  const spStart = Math.max(before.lastIndexOf("<p:sp>"), before.lastIndexOf("<p:pic>"));
  if (spStart === -1) return undefined;
  const searchWindow = slideXml.slice(spStart, tokenIndex + tokenLength + 500);
  const extMatch = searchWindow.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/);
  if (!extMatch) return undefined;
  return { width: emuToPx(Number(extMatch[1])), height: emuToPx(Number(extMatch[2])) };
}

// Discovery pass only assigns kind:"text" as a placeholder — the real kind
// (text/image/table/date) is resolved against the registry afterward by
// buildDefaultPlaceholderMap() (lib/deck-field-registry.ts), which is also
// where an unrecognized token's kind falls back to whatever was discovered
// here. Image-box geometry is still captured eagerly for every token here
// (cheap, and avoids a second XML pass later once the real kind is known).
function scanPartForTokens(
  xml: string,
  slideIndex: number,
  partPath: string,
  location: "text" | "table" | "notes",
  tokenMap: Map<string, ParsedDeckToken>
) {
  // Loop/table sections first — record the loop tag itself as a "table"
  // token, then strip its body so inner field tags (e.g. {{name}}) inside
  // the loop aren't also registered as top-level document tokens.
  let stripped = xml;
  let loopMatch: RegExpExecArray | null;
  LOOP_PATTERN.lastIndex = 0;
  while ((loopMatch = LOOP_PATTERN.exec(xml))) {
    const token = loopMatch[1];
    addOccurrence(tokenMap, token, "table", slideIndex, partPath, location);
    stripped = stripped.replace(loopMatch[0], "");
  }

  let match: RegExpExecArray | null;
  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(stripped))) {
    const token = match[1];
    const entry = addOccurrence(tokenMap, token, "text", slideIndex, partPath, location);
    if (!entry.imageBoxPx && location !== "notes") {
      entry.imageBoxPx = findImageBoxPx(xml, match.index, match[0].length);
    }
  }
}

function addOccurrence(
  tokenMap: Map<string, ParsedDeckToken>,
  token: string,
  kind: DeckTokenKind,
  slideIndex: number,
  partPath: string,
  location: "text" | "table" | "notes"
): ParsedDeckToken {
  let entry = tokenMap.get(token);
  if (!entry) {
    entry = { token, kind, occurrences: [] };
    tokenMap.set(token, entry);
  }
  const occurrence: DeckTokenOccurrence = { slide_index: slideIndex, slide_part: partPath, location };
  entry.occurrences.push(occurrence);
  return entry;
}

export async function parseDeckTemplate(fileBuffer: Buffer): Promise<ParsedDeckTemplate> {
  const zip = new PizZip(fileBuffer);
  // Security audit fix — see lib/zip-safety.ts's header comment. Admin-only
  // upload narrows likelihood but not the underlying flaw.
  assertZipSafe(zip);
  const slides = getPresentationOrderSlides(zip);

  // Repair any {{token}} PowerPoint split across multiple XML runs BEFORE
  // scanning — see lib/deck-run-merge.ts's header for why this is necessary
  // (without it, a split token is invisible to the regex scan below and
  // never gets discovered at all).
  const partsToNormalize: string[] = [];
  for (const slide of slides) {
    partsToNormalize.push(slide.partPath);
    const notesPart = getNotesSlidePart(zip, slide.partPath);
    if (notesPart) partsToNormalize.push(notesPart);
  }
  normalizeSplitTokenRuns(zip, partsToNormalize);

  const tokenMap = new Map<string, ParsedDeckToken>();

  for (const slide of slides) {
    const slideXml = zip.file(slide.partPath)?.asText();
    if (slideXml) scanPartForTokens(slideXml, slide.slideIndex, slide.partPath, "text", tokenMap);

    const notesPart = getNotesSlidePart(zip, slide.partPath);
    if (notesPart) {
      const notesXml = zip.file(notesPart)?.asText();
      if (notesXml) scanPartForTokens(notesXml, slide.slideIndex, notesPart, "notes", tokenMap);
    }
  }

  return { slideCount: slides.length, tokens: Array.from(tokenMap.values()) };
}
