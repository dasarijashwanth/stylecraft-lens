// lib/deck-render.ts
// Renders a project's resolved token values into an uploaded .pptx template
// IN PLACE — masters, layouts, fonts, and brand colors are untouched, only
// the {{token}} text/table content changes (template fidelity is the whole
// point, per the feature spec — this is NOT a from-scratch rebuild).
//
// Two passes:
//   1. Fill-or-hide: any slide where every token mapped to it (across text/
//      notes/table) resolves empty gets physically removed from the output
//      — not just left blank. A slide with zero mapped tokens is untouched
//      (cover/divider slides always survive).
//   2. docxtemplater.render() with custom {{ }} delimiters (matching the
//      upload-time parser's convention, NOT docxtemplater's single-brace
//      default), then XML surgery to actually delete the flagged slides'
//      parts, keyed by relationship ID (not filename index) so it stays
//      correct regardless of how PowerPoint has reordered slides.
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { DeckPlaceholderMap, DeckTokenMapping, DeckValue, CompetitorRow } from "./deck-types";
import { getPresentationOrderSlides, getNotesSlidePart } from "./deck-template-parser";
import { normalizeSplitTokenRuns } from "./deck-run-merge";

export interface RenderDeckResult {
  buffer: Buffer;
  slidesRemoved: number[];
}

function isTokenValueEmpty(token: DeckTokenMapping, value: DeckValue | undefined): boolean {
  if (token.kind === "table") return !Array.isArray(value) || value.length === 0;
  if (token.kind === "image") return !value || typeof value !== "object" || !("sourceUrl" in value) || !value.sourceUrl;
  return typeof value !== "string" || value.trim().length === 0;
}

// Every presentation-order slide index that has at least one mapped token,
// where every one of those tokens (text/image/table, including notes
// occurrences) resolves empty.
function computeSlidesToRemove(placeholderMap: DeckPlaceholderMap, values: Record<string, DeckValue>): Set<number> {
  const tokensBySlide = new Map<number, DeckTokenMapping[]>();
  for (const token of placeholderMap.tokens) {
    const slideIndices = new Set(token.occurrences.map(o => o.slide_index));
    slideIndices.forEach(idx => {
      const list = tokensBySlide.get(idx) || [];
      list.push(token);
      tokensBySlide.set(idx, list);
    });
  }

  const toRemove = new Set<number>();
  tokensBySlide.forEach((tokens, slideIndex) => {
    const allEmpty = tokens.every(t => isTokenValueEmpty(t, values[t.token]));
    if (allEmpty) toRemove.add(slideIndex);
  });
  return toRemove;
}

// Real image insertion needs docxtemplater's paid image module (not yet
// licensed — see the Project Deck plan's Context section for the pending
// action item). Until it's wired in, an image token resolves to an empty
// string so it never leaks the literal "{{token}}" text into a real deck;
// the slide it's on is hidden entirely if every other token there is also
// empty. This is the single change point for wiring in the real module
// once a license is available: swap this function's body, no other change
// needed elsewhere in this file.
function resolveImageToken(): string {
  return "";
}

function buildRenderData(placeholderMap: DeckPlaceholderMap, values: Record<string, DeckValue>): Record<string, any> {
  const data: Record<string, any> = {};
  for (const token of placeholderMap.tokens) {
    const value = values[token.token];
    if (token.kind === "table") {
      data[token.token] = Array.isArray(value) ? (value as CompetitorRow[]) : [];
    } else if (token.kind === "image") {
      data[token.token] = resolveImageToken();
    } else {
      data[token.token] = typeof value === "string" ? value : "";
    }
  }
  return data;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Physically deletes flagged slides' parts (slide XML + its rels + paired
// notes-slide + notes-slide rels) and strips the matching entries from
// [Content_Types].xml, ppt/_rels/presentation.xml.rels, and
// ppt/presentation.xml's <p:sldIdLst> — keyed by relationship ID, gathered
// BEFORE any removal so a slide's own rels file is still present when we
// look up its paired notes-slide.
function removeSlides(zip: PizZip, slideIndicesToRemove: Set<number>): void {
  if (slideIndicesToRemove.size === 0) return;

  const slides = getPresentationOrderSlides(zip);
  const toRemove = slides.filter(s => slideIndicesToRemove.has(s.slideIndex));
  if (toRemove.length === 0) return;

  const removedRelIds = new Set<string>();
  const removedPartAbsPaths: string[] = [];

  for (const slide of toRemove) {
    const notesPart = getNotesSlidePart(zip, slide.partPath);

    const fileName = slide.partPath.split("/").pop()!;
    const dir = slide.partPath.slice(0, slide.partPath.length - fileName.length);
    const slideRelsPath = `${dir}_rels/${fileName}.rels`;

    zip.remove(slide.partPath);
    zip.remove(slideRelsPath);
    removedPartAbsPaths.push(`/${slide.partPath}`);

    if (notesPart) {
      const notesFileName = notesPart.split("/").pop()!;
      const notesDir = notesPart.slice(0, notesPart.length - notesFileName.length);
      const notesRelsPath = `${notesDir}_rels/${notesFileName}.rels`;
      zip.remove(notesPart);
      zip.remove(notesRelsPath);
      removedPartAbsPaths.push(`/${notesPart}`);
    }

    removedRelIds.add(slide.relId);
  }

  // [Content_Types].xml — drop the <Override> entry for each removed part.
  const contentTypesPath = "[Content_Types].xml";
  let contentTypesXml = zip.file(contentTypesPath)?.asText();
  if (contentTypesXml) {
    for (const absPath of removedPartAbsPaths) {
      const overrideRegex = new RegExp(`<Override[^>]*PartName="${escapeRegex(absPath)}"[^>]*/>`, "g");
      contentTypesXml = contentTypesXml.replace(overrideRegex, "");
    }
    zip.file(contentTypesPath, contentTypesXml);
  }

  // ppt/_rels/presentation.xml.rels — drop the <Relationship> entry for
  // each removed slide's relationship id.
  const presRelsPath = "ppt/_rels/presentation.xml.rels";
  let presRelsXml = zip.file(presRelsPath)?.asText();
  if (presRelsXml) {
    removedRelIds.forEach(relId => {
      const relRegex = new RegExp(`<Relationship[^>]*Id="${escapeRegex(relId)}"[^>]*/>`, "g");
      presRelsXml = presRelsXml!.replace(relRegex, "");
    });
    zip.file(presRelsPath, presRelsXml);
  }

  // ppt/presentation.xml — drop the <p:sldId r:id="..."/> entry from
  // <p:sldIdLst> for each removed slide.
  const presentationPath = "ppt/presentation.xml";
  let presentationXml = zip.file(presentationPath)?.asText();
  if (presentationXml) {
    removedRelIds.forEach(relId => {
      const sldIdRegex = new RegExp(`<p:sldId[^>]*r:id="${escapeRegex(relId)}"[^>]*/>`, "g");
      presentationXml = presentationXml!.replace(sldIdRegex, "");
    });
    zip.file(presentationPath, presentationXml);
  }
}

export async function renderDeck(
  templateBuffer: Buffer,
  placeholderMap: DeckPlaceholderMap,
  values: Record<string, DeckValue>
): Promise<RenderDeckResult> {
  const slidesToRemove = computeSlidesToRemove(placeholderMap, values);
  const renderData = buildRenderData(placeholderMap, values);

  const zip = new PizZip(templateBuffer);

  // Same split-token repair as upload-time discovery (lib/deck-template-parser.ts)
  // — must run here too so Docxtemplater's own {{ }} scan agrees with what
  // parseDeckTemplate found, otherwise a token that discovery only found
  // thanks to this fix would still fail to substitute at render time.
  const slidesForNormalize = getPresentationOrderSlides(zip);
  const partsToNormalize: string[] = [];
  for (const slide of slidesForNormalize) {
    partsToNormalize.push(slide.partPath);
    const notesPart = getNotesSlidePart(zip, slide.partPath);
    if (notesPart) partsToNormalize.push(notesPart);
  }
  normalizeSplitTokenRuns(zip, partsToNormalize);

  const doc = new Docxtemplater(zip, {
    delimiters: { start: "{{", end: "}}" },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });
  doc.render(renderData);

  const outputZip = doc.getZip();
  removeSlides(outputZip, slidesToRemove);

  const buffer = outputZip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer, slidesRemoved: Array.from(slidesToRemove).sort((a, b) => a - b) };
}
