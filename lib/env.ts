// lib/env.ts
// Environment validation. Reuses this app's EXISTING "is this provider
// configured" flags (lib/supabase.ts's isSupabaseConfigured, lib/openai.ts's
// hasOpenAIKey, etc.) rather than re-implementing placeholder-detection —
// those flags are already the source of truth every route/lib file checks
// against.
//
// NODE.JS RUNTIME ONLY — never import this from middleware.ts. This
// transitively pulls in the openai/@google/genai SDKs (via lib/openai.ts/
// lib/gemini.ts), which are not edge-runtime-safe, and Next.js middleware
// is always edge. Call validateEnv() only from Node-runtime request
// handlers — see app/api/health/route.ts, this app's existing (and only)
// "check config at boot" mechanism, documented in that file's own header
// as the pragmatic substitute for a true boot hook in serverless Next.js.
//
// Deliberately fail-LOUD, not fail-CRASH: this app is live in production
// with real users right now, and a false positive in this check (e.g. an
// unanticipated placeholder format) throwing here would take down the
// entire site over a validation bug, which is a worse outcome than a
// clearly-logged misconfiguration. Errors/warnings are logged via
// console.error/warn (visible in `vercel logs`) whenever /api/health is
// hit — manually, by an uptime monitor, or as a post-deploy CI step.
// Promote to a hard throw once a staging environment exists to validate
// against without live-site risk.
import { z } from "zod";
import { isSupabaseConfigured } from "./supabase";
import { hasOpenAIKey } from "./openai";
import { hasGeminiKey } from "./gemini";
import { hasRainforestKey } from "./rainforest";

const isProduction = process.env.VERCEL_ENV === "production" || (process.env.NODE_ENV === "production" && !process.env.VERCEL_ENV);

const urlEnvVar = z.string().url();

export interface EnvValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateEnv(): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (isSupabaseConfigured) {
    const parsed = urlEnvVar.safeParse((process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, ""));
    if (!parsed.success) errors.push("NEXT_PUBLIC_SUPABASE_URL is set but is not a valid URL.");
  } else if (isProduction) {
    errors.push("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY) — production always runs against Supabase; every data-layer call will fail or silently fall back to the in-memory dev store.");
  }

  if (isProduction && !hasOpenAIKey && !hasGeminiKey) {
    errors.push("Neither OPENAI_API_KEY nor GEMINI_API_KEY is set — analysis/generation, the app's core feature, cannot run at all.");
  }

  if (isProduction && !hasRainforestKey) {
    warnings.push("RAINFOREST_API_KEY is not set — Amazon pricing/review data will be unavailable; the app degrades gracefully but competitor data will be materially weaker.");
  }

  if (isProduction && !process.env.RESEND_API_KEY) {
    warnings.push("RESEND_API_KEY is not set — Contact Support submissions will save but email delivery will be skipped (email_status='failed', visible/retriable at /dashboard/admin/support-messages).");
  }

  if (isProduction && (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN)) {
    warnings.push("Google Drive integration is not fully configured — \"Save to Drive\" will fall back to a mock link.");
  }

  for (const err of errors) console.error(`[env] ${err}`);
  for (const warn of warnings) console.warn(`[env] ${warn}`);

  return { ok: errors.length === 0, errors, warnings };
}

let cached: EnvValidationResult | null = null;

// Call once per cold start (memoized) — see middleware.ts.
export function validateEnvOnce(): EnvValidationResult {
  if (!cached) cached = validateEnv();
  return cached;
}
