// scripts/verify-openai-retry-timeout.ts
// Offline regression check for a real production issue: GTM field-generation
// chunks were taking 49-58s total (confirmed via live logs from
// scripts/retry-failed-generations.ts) — right at Vercel's 60s function
// ceiling — because createResponseWithRetry retried a "timeout"-classified
// error with the SAME full timeoutMs again, nearly doubling worst-case
// latency for that one call. Fixed by capping the retry attempt's timeout
// at TIMEOUT_RETRY_TIMEOUT_MS (10s) regardless of the original timeoutMs.
// No live network call — openai.responses.create is monkey-patched to
// throw a real (constructed, not live) APIConnectionTimeoutError once, then
// succeed, and this asserts the exact `timeout` option passed to each of
// the two underlying calls.
//
// Run with: npx tsx scripts/verify-openai-retry-timeout.ts

import { APIConnectionTimeoutError, RateLimitError } from "openai";

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
  const { openai, createResponseWithRetry, TIMEOUT_RETRY_TIMEOUT_MS } = await import("../lib/openai");

  const calls: { timeout: number }[] = [];
  const originalCreate = openai.responses.create.bind(openai.responses);

  console.log("\n[1] createResponseWithRetry — a timeout error retries with a SHORT timeout, not the same one");
  let callCount = 0;
  (openai.responses as any).create = async (_params: any, opts: any) => {
    calls.push({ timeout: opts.timeout });
    callCount++;
    if (callCount === 1) throw new APIConnectionTimeoutError({ message: "Request timed out." });
    return { output: [], output_text: "{}" };
  };

  const LARGE_PRIMARY_TIMEOUT = 28_000; // matches gtm-generate.ts's SECTION_CALL_TIMEOUT_MS
  await createResponseWithRetry({}, LARGE_PRIMARY_TIMEOUT);

  assert(calls.length === 2, "exactly 2 underlying calls were made (1 original + 1 retry)");
  assert(calls[0].timeout === LARGE_PRIMARY_TIMEOUT, "the first (failed) call used the full original timeout");
  assert(calls[1].timeout === TIMEOUT_RETRY_TIMEOUT_MS, `the retry call is capped at TIMEOUT_RETRY_TIMEOUT_MS (${TIMEOUT_RETRY_TIMEOUT_MS}ms), NOT the original ${LARGE_PRIMARY_TIMEOUT}ms`);
  assert(calls[1].timeout < LARGE_PRIMARY_TIMEOUT, "the retry timeout is strictly shorter than the original — this is what prevents ~doubling worst-case latency");

  console.log("\n[2] createResponseWithRetry — a SMALL original timeout is never lengthened by the retry cap");
  calls.length = 0;
  callCount = 0;
  const SMALL_PRIMARY_TIMEOUT = 5_000;
  await createResponseWithRetry({}, SMALL_PRIMARY_TIMEOUT);
  assert(calls[1].timeout === SMALL_PRIMARY_TIMEOUT, "when the original timeout is already shorter than the retry cap, the retry uses the smaller of the two (never lengthens it)");

  console.log("\n[3] createResponseWithRetry — rate_limit still retries with the FULL original timeout (unaffected by this fix)");
  calls.length = 0;
  callCount = 0;
  (openai.responses as any).create = async (_params: any, opts: any) => {
    calls.push({ timeout: opts.timeout });
    callCount++;
    if (callCount === 1) throw new RateLimitError(429, { message: "rate limited" }, "rate limited", new Headers());
    return { output: [], output_text: "{}" };
  };
  const start = Date.now();
  await createResponseWithRetry({}, LARGE_PRIMARY_TIMEOUT);
  const elapsed = Date.now() - start;
  assert(calls[1].timeout === LARGE_PRIMARY_TIMEOUT, "a rate_limit retry still uses the full original timeout, not the short timeout cap");
  assert(elapsed < 8000, `rate_limit's retry delay is short (waited ~${elapsed}ms, expected close to its own 6s delay, not blocked on anything else)`);

  (openai.responses as any).create = originalCreate;

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
