// Universal claim/citation data model + server-side verification, used
// anywhere the app makes a factual claim from AI-assisted research (Phase 3
// market synthesis today; GTM field grounding and the rebuilt analysis
// evidence sections reuse this same shape rather than forking a second
// verification implementation). The core discipline — never trust the
// model's own "verified" label, always re-check its cited quote against the
// actual fetched source text server-side — is the same pattern already
// proven in lib/amazon-review-analysis.ts's quoteAppearsInReviews, made
// generic here so it isn't reimplemented per feature.
//
// Why an independent fetch, not the model's own search results: provider
// search-tool result content is either opaque or simply not something we
// re-parse ourselves, so "the actually fetched page text stored
// server-side" has to come from an independent fetch of the URL the model
// cited, done here — otherwise there'd be nothing real to verify against.
import * as cheerio from "cheerio";

const FETCH_TIMEOUT_MS = 6_000;
const USER_AGENT = "StylecraftLensBot/1.0 (+https://stylecraft-lens.vercel.app; citation verification)";

async function fetchPageText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return cheerio.load(html)("body").text().replace(/\s+/g, " ").trim();
  } catch {
    return null;
  }
}

// Fetches every distinct cited URL in parallel (bounded — a runaway claim
// list citing dozens of unique URLs would blow the request's time budget)
// so verifyClaims below has real, independently-fetched text to check
// quotes against. Never throws; a failed fetch just means that URL's
// claims can't verify (they'll downgrade to "unverified", which is the
// correct, honest outcome for an unreachable source).
const MAX_URLS_TO_VERIFY = 6;

export async function fetchSourceTexts(urls: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(urls.filter(Boolean))).slice(0, MAX_URLS_TO_VERIFY);
  const results = await Promise.all(unique.map(async url => [url, await fetchPageText(url)] as const));
  const map: Record<string, string> = {};
  for (const [url, text] of results) if (text) map[url] = text;
  return map;
}

export type ClaimType = "market_stat" | "spec" | "price" | "sentiment" | "news" | "feature" | "strategic";
export type VerificationStatus = "verified" | "unverified" | "model_estimate";

export interface Source {
  url: string;
  title: string;
  publisher: string;
  quote: string;
  retrievedAt: string;
}

export interface Claim {
  claimId: string;
  text: string;
  type: ClaimType;
  verification: VerificationStatus;
  sources: Source[];
}

export function normalizeWhitespace(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// A quote is only meaningful evidence if it's long enough to not trivially
// match by coincidence (same floor as quoteAppearsInReviews).
const MIN_QUOTE_LENGTH = 8;

export function quoteAppearsInText(quote: string, fetchedTexts: string[]): boolean {
  const needle = normalizeWhitespace(quote);
  if (needle.length < MIN_QUOTE_LENGTH) return false;
  return fetchedTexts.some(t => normalizeWhitespace(t).includes(needle));
}

// Re-checks every claim's sources against a flat fetched-text pool (e.g.
// review bodies, where there's no per-source URL to key by) — never the
// model's own say-so. A claim survives as "verified" only if AT LEAST ONE
// of its cited sources' quotes is a genuine substring of something
// actually fetched; otherwise it's downgraded to "unverified" server-side,
// regardless of what the model originally claimed.
export function verifyClaims(claims: Claim[], fetchedTexts: string[]): Claim[] {
  return claims.map(claim => {
    if (claim.verification !== "verified") return claim;
    const hasVerifiedSource = claim.sources.some(s => quoteAppearsInText(s.quote, fetchedTexts));
    return hasVerifiedSource ? claim : { ...claim, verification: "unverified" as const };
  });
}

// Precise variant for web-cited claims: each source's quote must match
// specifically the text fetched from THAT source's own URL (not just any
// fetched page in the batch) — pair with fetchSourceTexts above. A source
// whose URL couldn't be fetched at all can never verify, which is correct:
// an unreachable citation isn't evidence.
export function verifyClaimsAgainstSources(claims: Claim[], sourceTextsByUrl: Record<string, string>): Claim[] {
  return claims.map(claim => {
    if (claim.verification !== "verified") return claim;
    const hasVerifiedSource = claim.sources.some(s => {
      const pageText = sourceTextsByUrl[s.url];
      return pageText ? quoteAppearsInText(s.quote, [pageText]) : false;
    });
    return hasVerifiedSource ? claim : { ...claim, verification: "unverified" as const };
  });
}

// Simple stable id generator for claims that don't already carry one from
// the model's own JSON output — collision risk is irrelevant here since
// ids only need to be unique within a single document's claims array.
let claimCounter = 0;
export function nextClaimId(prefix: string): string {
  claimCounter += 1;
  return `${prefix}_${Date.now()}_${claimCounter}`;
}

export const UNVERIFIED_LABEL = "No verifiable source found — treat as unverified estimate";

// Raw shape the AI is asked to produce (see lib/prompts/phase3.ts) — no
// claimId/verification yet, since those are assigned/computed here, never
// trusted from the model.
export interface RawClaim {
  text: string;
  type: ClaimType;
  sources: { url: string; title?: string; publisher?: string; quote: string }[];
}

// Turns the model's raw citation claims into verified Claim objects: fetches
// every distinct cited URL independently, then downgrades any claim whose
// quote doesn't actually appear on the page it claims to be from. This is
// the single entry point Phase 3 (and any future caller) should use rather
// than calling fetchSourceTexts/verifyClaimsAgainstSources separately.
export async function finalizeCitations(raw: RawClaim[], idPrefix: string): Promise<Claim[]> {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const retrievedAt = new Date().toISOString();
  const claims: Claim[] = raw
    .filter(c => c && typeof c.text === "string" && Array.isArray(c.sources) && c.sources.length > 0)
    .map(c => ({
      claimId: nextClaimId(idPrefix),
      text: c.text,
      type: c.type,
      verification: "verified" as const, // optimistic — verifyClaimsAgainstSources below downgrades what doesn't check out
      sources: c.sources
        .filter(s => s?.url && s?.quote)
        .map(s => ({ url: s.url, title: s.title || "", publisher: s.publisher || "", quote: s.quote, retrievedAt })),
    }))
    .filter(c => c.sources.length > 0);

  const allUrls = claims.flatMap(c => c.sources.map(s => s.url));
  const sourceTexts = await fetchSourceTexts(allUrls);
  return verifyClaimsAgainstSources(claims, sourceTexts);
}
