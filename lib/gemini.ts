import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || "";

// A flag to check if the user has provided a real key or if we are in mock/demo mode.
export const hasGeminiKey =
  !!apiKey &&
  apiKey !== "" &&
  !apiKey.includes("your-gemini") &&
  !apiKey.includes("xxxx");

export const genAI = new GoogleGenAI({ apiKey: apiKey || "mock-key-for-development" });

// Fast, cheap, current-generation model used for all text/JSON generation and
// vision calls across the app (market research, sales kit, TDS, artwork, rewrite).
export const GEMINI_MODEL = "gemini-3.5-flash";

// Strip markdown code fences some models wrap JSON responses in, then
// extract just the JSON object/array itself. Tool-augmented responses
// (Claude with web_search, Gemini with googleSearch) routinely prepend
// conversational prose before the JSON ("Based on the search results,
// here's the identification: {...}") or append it after — a plain
// fence-strip still leaves that prose in place and JSON.parse throws. Scan
// for the first '{' or '[' and use balanced bracket-matching to find its
// true closing bracket, discarding anything outside that span.
export function cleanJsonString(text: string): string {
  const fenceStripped = text.replace(/```json|```/g, "").trim();

  const firstBrace = fenceStripped.indexOf("{");
  const firstBracket = fenceStripped.indexOf("[");
  const starts = [firstBrace, firstBracket].filter(i => i !== -1);
  if (starts.length === 0) return fenceStripped;

  const start = Math.min(...starts);
  const open = fenceStripped[start];
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  for (let i = start; i < fenceStripped.length; i++) {
    if (fenceStripped[i] === open) depth++;
    else if (fenceStripped[i] === close) {
      depth--;
      if (depth === 0) return fenceStripped.slice(start, i + 1);
    }
  }
  // No balanced close found — return from the start onward and let
  // JSON.parse throw naturally rather than silently truncating.
  return fenceStripped.slice(start);
}
