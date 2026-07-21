import { NextResponse } from "next/server";
import { hasOpenAIKey, OPENAI_MODEL } from "@/lib/openai";
import { hasGeminiKey } from "@/lib/gemini";
import { hasRainforestKey } from "@/lib/rainforest";

// The pragmatic Next.js-serverless substitute for a "validate providers at
// boot" check — there's no true run-once-at-deploy hook without extra
// config (experimental.instrumentationHook), so this is a callable-anytime
// endpoint an uptime monitor or a person can hit right after every deploy.
// Deliberately public and boolean-only — reveals presence, never the actual
// secret values.
export async function GET() {
  return NextResponse.json({
    ok: hasOpenAIKey,
    openai: hasOpenAIKey,
    gemini: hasGeminiKey,
    rainforest: hasRainforestKey,
    model: OPENAI_MODEL,
  });
}
