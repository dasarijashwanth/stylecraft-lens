import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY || "mock-key-for-development";

export const anthropic = new Anthropic({
  apiKey,
});

// A flag to check if the user has provided a real key or if we are in mock/demo mode.
export const hasAnthropicKey =
  !!process.env.ANTHROPIC_API_KEY &&
  process.env.ANTHROPIC_API_KEY !== "sk-ant-..." &&
  process.env.ANTHROPIC_API_KEY !== "";
