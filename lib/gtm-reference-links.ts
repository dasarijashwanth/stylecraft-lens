// lib/gtm-reference-links.ts
// Reference Links — up to 5 URLs a user pastes into the project's Sources
// tab (product pages, competitor/brand sites). Fetched fresh each
// generation phase (same "never cached across phases" precedent as
// lib/gtm-uploaded-tds.ts's getUploadedTdsContext) and prepended to GTM/
// Content Form prompts as a top-priority external source, ahead of the
// AI's own general knowledge/web search — the AI is explicitly told to
// check this block FIRST and only fall back to its own knowledge/web
// search for a field this doesn't cover.
import { fetchPageText } from "./citations";

export const MAX_REFERENCE_URLS = 5;
const MAX_TEXT_CHARS_PER_URL = 4_000;

export interface ReferenceLinksContext {
  hasLinks: boolean;
  urls: string[];
  // Only URLs that actually resolved to real text — an unreachable/dead
  // link is silently dropped (same "never throws, missing = not included"
  // convention as lib/citations.ts's fetchSourceTexts) rather than failing
  // the whole generation step.
  textByUrl: Record<string, string>;
}

export async function getReferenceLinksContext(referenceUrls: string[] | null | undefined): Promise<ReferenceLinksContext> {
  const urls = (referenceUrls || [])
    .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
    .slice(0, MAX_REFERENCE_URLS);

  if (urls.length === 0) return { hasLinks: false, urls: [], textByUrl: {} };

  const results = await Promise.all(urls.map(async (url) => [url, await fetchPageText(url)] as const));
  const textByUrl: Record<string, string> = {};
  for (const [url, text] of results) {
    if (text) textByUrl[url] = text.slice(0, MAX_TEXT_CHARS_PER_URL);
  }
  return { hasLinks: Object.keys(textByUrl).length > 0, urls, textByUrl };
}

// Rendered into <REFERENCE_LINKS> for GTM's own <SOURCE_BLOCK>-per-tag
// prompt (lib/gtm-generate.ts's buildUserContent) and appended onto the
// plain narrative-only grounding block (the `tdsGroundingBlock` variable
// threaded through Content Form / Tier 6.5 / FAQs / Marketing Direction)
// for every other caller — same text, two different wrapper shapes.
export function buildReferenceLinksPromptBlock(context: ReferenceLinksContext): string {
  if (!context.hasLinks) return "";
  const body = Object.entries(context.textByUrl)
    .map(([url, text]) => `SOURCE: ${url}\n${text}`)
    .join("\n---\n");
  return `The team has provided these specific reference pages — check them FIRST for every field before using general knowledge or a separate web search. Only fall back to your own knowledge/web search for a field these genuinely don't cover.\n\n${body}`;
}

export function buildReferenceLinksTag(context: ReferenceLinksContext): string {
  if (!context.hasLinks) return "";
  return `\n\n<REFERENCE_LINKS>\n${buildReferenceLinksPromptBlock(context)}\n</REFERENCE_LINKS>`;
}
