// scripts/verify-analysis-fallback-reliability.ts
// Offline regression check for the "Connection dropped — retrying" bug:
// Phase 1/2/3 of a live analysis were hitting Vercel's 60s hard function
// timeout because withAiFallback always attempted a Gemini fallback
// (including its ungrounded retry) regardless of how much of the route's
// time budget OpenAI had already burned, and never short-circuited a
// Gemini 429/RESOURCE_EXHAUSTED quota error before wastefully retrying
// ungrounded. Confirmed live via `vercel logs` (not reproduced here — no
// live OpenAI/Gemini call, no .env.local loaded) — this only exercises the
// pure classification/budget logic with synthetic promises.
//
// Run with: npx tsx scripts/verify-analysis-fallback-reliability.ts

export {};

let failures = 0;
let passes = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passes++;
    console.log(`  PASS: ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

async function main() {
  const { isGeminiQuotaExhausted, withAiFallback, ROUTE_TIME_BUDGET_MS, MIN_VIABLE_GEMINI_ATTEMPT_MS } = await import("../lib/analysisEngine");

  // ---- Section 1: isGeminiQuotaExhausted classification ----
  console.log("\n[1] isGeminiQuotaExhausted — real production error shapes");
  const rawQuotaError = new Error(
    '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","status":"RESOURCE_EXHAUSTED"}}'
  );
  assert(isGeminiQuotaExhausted(rawQuotaError) === true, "the exact production RESOURCE_EXHAUSTED message string is detected");
  assert(isGeminiQuotaExhausted({ status: 429, message: "rate limited" }) === true, "a typed .status === 429 is detected");
  assert(isGeminiQuotaExhausted({ code: 429, message: "rate limited" }) === true, "a typed .code === 429 is detected");
  assert(isGeminiQuotaExhausted(new Error("Empty response (finishReason: SAFETY)")) === false, "an unrelated Gemini error is NOT misclassified as quota exhaustion");
  assert(isGeminiQuotaExhausted(new Error("503 UNAVAILABLE — model overloaded")) === false, "a 503 overload error is NOT misclassified as quota exhaustion (different failure, different handling)");

  // ---- Section 2: withAiFallback — OpenAI success short-circuits everything ----
  console.log("\n[2] withAiFallback — OpenAI success never touches Gemini/mock");
  let geminiCalled = false, mockCalled = false;
  const r1 = await withAiFallback(
    "test",
    async () => { geminiCalled = true; return "gemini"; },
    async () => "openai-result",
    () => { mockCalled = true; return "mock"; },
    Date.now()
  );
  assert(r1 === "openai-result", "OpenAI's result is returned as-is");
  assert(!geminiCalled && !mockCalled, "Gemini and mock are never invoked when OpenAI succeeds");

  // ---- Section 3: OpenAI fails, plenty of budget left -> Gemini is attempted ----
  console.log("\n[3] withAiFallback — OpenAI fails with time to spare -> Gemini attempted");
  let geminiAttempted = false;
  const r2 = await withAiFallback(
    "test",
    async () => { geminiAttempted = true; return "gemini-result"; },
    async () => { throw new Error("openai timeout"); },
    () => "mock",
    Date.now() // full budget remaining
  );
  assert(r2 === "gemini-result", "Gemini's result is used when OpenAI fails and there's time left");
  assert(geminiAttempted, "Gemini was actually attempted");

  // ---- Section 4: OpenAI fails, budget nearly exhausted -> Gemini skipped entirely ----
  console.log("\n[4] withAiFallback — OpenAI fails with budget nearly exhausted -> Gemini SKIPPED, straight to mock");
  let geminiCalledWhenLate = false;
  const lateStartTime = Date.now() - (ROUTE_TIME_BUDGET_MS - MIN_VIABLE_GEMINI_ATTEMPT_MS + 1000); // 1s short of the minimum viable window
  const r3 = await withAiFallback(
    "test",
    async () => { geminiCalledWhenLate = true; return "gemini-result"; },
    async () => { throw new Error("openai timeout"); },
    () => "mock-result",
    lateStartTime
  );
  assert(r3 === "mock-result", "falls back to mock when too little time remains for a real Gemini attempt");
  assert(!geminiCalledWhenLate, "Gemini's function was never even invoked — this is exactly what prevents the Vercel 60s hard-kill");

  // ---- Section 5: Gemini itself fails -> falls through to mock ----
  console.log("\n[5] withAiFallback — Gemini fails too -> falls through to mock");
  const r4 = await withAiFallback(
    "test",
    async () => { throw new Error("gemini also failed"); },
    async () => { throw new Error("openai failed"); },
    () => "mock-result",
    Date.now()
  );
  assert(r4 === "mock-result", "mock is the final fallback when both providers fail");

  // ---- Section 6: no providers configured at all -> mock directly ----
  console.log("\n[6] withAiFallback — no providers configured -> mock directly, no wasted attempts");
  const r5 = await withAiFallback("test", null, null, () => "mock-only", Date.now());
  assert(r5 === "mock-only", "mock runs directly when both provider callbacks are null");

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
