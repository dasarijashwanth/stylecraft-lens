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

// Strip markdown code fences some models wrap JSON responses in.
export function cleanJsonString(text: string): string {
  return text.replace(/```json|```/g, "").trim();
}
