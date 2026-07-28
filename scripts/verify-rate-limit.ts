// scripts/verify-rate-limit.ts
// Offline verification of lib/rate-limit.ts against the in-memory fallback
// (lib/memoryDb.ts's authEvents array) — no Supabase/network calls.
//
// Run with: npx tsx scripts/verify-rate-limit.ts
import { checkRateLimit } from "../lib/rate-limit";
import { memoryDb } from "../lib/memoryDb";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) passed++;
  else {
    failed++;
    console.log(`✗ FAILED: ${message}`);
  }
}

async function main() {
  memoryDb.authEvents.length = 0; // isolate from any other state

  const userId = "user_rate_limit_test";

  // First 3 attempts (maxAttempts=3) succeed
  for (let i = 0; i < 3; i++) {
    const result = await checkRateLimit({ eventType: "analysis_create", userId, maxAttempts: 3, windowMinutes: 60 });
    assert(!result.limited, `attempt ${i + 1}/3 should be allowed`);
  }

  // 4th attempt within the same window is blocked
  const fourth = await checkRateLimit({ eventType: "analysis_create", userId, maxAttempts: 3, windowMinutes: 60 });
  assert(fourth.limited, "4th attempt within the window should be rate-limited");
  assert(fourth.retryAfterMinutes === 60, "retryAfterMinutes should echo the configured window");

  // A different user is unaffected by the first user's limit
  const otherUser = await checkRateLimit({ eventType: "analysis_create", userId: "someone_else", maxAttempts: 3, windowMinutes: 60 });
  assert(!otherUser.limited, "a different user's own attempts should not be affected");

  // A different event type for the SAME user is a separate bucket
  const otherEventType = await checkRateLimit({ eventType: "generation_start", userId, maxAttempts: 3, windowMinutes: 60 });
  assert(!otherEventType.limited, "a different event type should not share the same counter");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
