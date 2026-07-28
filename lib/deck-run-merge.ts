// lib/deck-run-merge.ts
// PowerPoint frequently splits a single, visually-contiguous {{token}} across
// multiple <a:r> runs (autocorrect, spell-check squiggle boundaries, and
// paste-then-retype are the most common causes) — invisible in the
// PowerPoint UI itself, but both upload-time token discovery
// (lib/deck-template-parser.ts) and render-time substitution
// (lib/deck-render.ts, via Docxtemplater) scan raw slide XML for a literal
// "{{...}}" text sequence, so a split token is silently invisible to both.
// Confirmed in production: a real 13-slide uploaded template produced ZERO
// discovered tokens, meaning every generated deck was the raw, unmodified
// template — identical output for every project.
//
// This does a TARGETED merge: it only touches the exact run-span a
// "{{...}}" sequence spans (reusing the first spanned run's own <a:rPr>
// formatting for the merged run) — every other run in the presentation,
// including ones immediately adjacent to a merged span, is left
// byte-for-byte untouched. That preserves template fidelity (fonts/colors/
// layout — the whole point of this feature) while still recovering split
// tokens. Both parseDeckTemplate and renderDeck call normalizeSplitTokenRuns
// on their own zip instance before scanning, so discovery and rendering
// always agree on where a token lives.
import PizZip from "pizzip";

const PARAGRAPH_PATTERN = /<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g;
const RUN_PATTERN =
  /<a:r(?:\s[^>]*)?>(?:(<a:rPr(?:\s[^>]*)?\/>)|(<a:rPr(?:\s[^>]*)?>[\s\S]*?<\/a:rPr>))?(?:<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:t(?:\s[^>]*)?\/>)<\/a:r>/g;
// A generic, non-greedy "{{...}}" scan — matches a plain {{token}} AND each
// half of a loop delimiter ({{#token}} / {{/token}}) independently, which is
// all discovery/rendering actually need (the loop body between them is
// scanned separately).
const DELIMITER_PATTERN = /\{\{[\s\S]*?\}\}/g;

interface RunInfo {
  start: number;
  end: number;
  rPr: string;
  text: string;
}

function extractRuns(paragraphXml: string): RunInfo[] {
  const runs: RunInfo[] = [];
  RUN_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RUN_PATTERN.exec(paragraphXml))) {
    runs.push({
      start: m.index,
      end: m.index + m[0].length,
      rPr: m[1] || m[2] || "",
      text: m[3] || "",
    });
  }
  return runs;
}

export function mergeRunsInParagraph(paragraphXml: string): string {
  const runs = extractRuns(paragraphXml);
  if (runs.length < 2) return paragraphXml;

  const runStartOffsetInCombined: number[] = [];
  let combined = "";
  for (const r of runs) {
    runStartOffsetInCombined.push(combined.length);
    combined += r.text;
  }

  function runIndexForCombinedOffset(offset: number): number {
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runStartOffsetInCombined[i] <= offset) return i;
    }
    return 0;
  }

  DELIMITER_PATTERN.lastIndex = 0;
  let dm: RegExpExecArray | null;
  const mergeRanges: { firstRun: number; lastRun: number }[] = [];
  while ((dm = DELIMITER_PATTERN.exec(combined))) {
    const charStart = dm.index;
    const charEnd = dm.index + dm[0].length - 1;
    const firstRun = runIndexForCombinedOffset(charStart);
    const lastRun = runIndexForCombinedOffset(charEnd);
    if (firstRun !== lastRun) mergeRanges.push({ firstRun, lastRun });
  }
  if (mergeRanges.length === 0) return paragraphXml;

  // Apply right-to-left so earlier splice offsets stay valid.
  let result = paragraphXml;
  for (const { firstRun, lastRun } of mergeRanges.slice().reverse()) {
    const spanStart = runs[firstRun].start;
    const spanEnd = runs[lastRun].end;
    const mergedText = runs.slice(firstRun, lastRun + 1).map(r => r.text).join("");
    const rPr = runs[firstRun].rPr;
    const replacement = `<a:r>${rPr}<a:t>${mergedText}</a:t></a:r>`;
    result = result.slice(0, spanStart) + replacement + result.slice(spanEnd);
  }
  return result;
}

export function mergeSplitTokensInXml(xml: string): string {
  return xml.replace(PARAGRAPH_PATTERN, paragraph => mergeRunsInParagraph(paragraph));
}

export function normalizeSplitTokenRuns(zip: PizZip, slideParts: string[]): void {
  for (const partPath of slideParts) {
    const xml = zip.file(partPath)?.asText();
    if (!xml) continue;
    const merged = mergeSplitTokensInXml(xml);
    if (merged !== xml) zip.file(partPath, merged);
  }
}
