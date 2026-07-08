import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY || "mock-key-for-development";

export const anthropic = new Anthropic({
  apiKey,
});

// Fallback provider used when Gemini fails (quota/rate-limit/error). Not the
// primary AI provider — see lib/gemini.ts.
export const hasAnthropicKey =
  !!process.env.ANTHROPIC_API_KEY &&
  process.env.ANTHROPIC_API_KEY !== "sk-ant-..." &&
  process.env.ANTHROPIC_API_KEY !== "";

export const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
