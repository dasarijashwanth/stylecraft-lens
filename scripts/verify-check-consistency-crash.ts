// scripts/verify-check-consistency-crash.ts
// Offline regression check for a real production crash: TDS generation was
// failing with "answer.trim is not a function" (confirmed via a read-only
// production query — several projects stuck at phase=tds status=failed
// with this exact error, one as recent as today, well after the original
// coerceAiAnswer fix shipped). Root cause: lib/gtm-grounding.ts's
// checkConsistency() reads the RAW, untrusted AI JSON response directly
// and called .trim() on its `answer` field without going through
// coerceAiAnswer — the one call site the original sweep missed, since it
// lives outside gtm-generate.ts/tds-generate.ts. No live AI call — pure
// function test against synthetic non-string answer values.
//
// Run with: npx tsx scripts/verify-check-consistency-crash.ts

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
  const { checkConsistency } = await import("../lib/gtm-grounding");

  const schema = [
    { id: "warranty", section: "General", question: "Warranty", kind: "grounded" as const },
    { id: "core_consumer", section: "General", question: "Core Consumer", kind: "written" as const },
  ];

  console.log("\n[1] checkConsistency — non-string AI answer no longer crashes");

  // The exact failure mode: the AI's JSON returned a bare number instead of
  // a string for a grounded field's "answer" (untrusted external data — no
  // guarantee the model actually followed the declared string type).
  const aiFieldsWithNumericAnswer: any = {
    warranty: { answer: 5, source: "web" }, // number, not a string — this is what crashed .trim()
    core_consumer: { answer: "Busy stylists", source: "sales_kit" },
  };
  const derivedFields: any = {
    warranty: { answer: "5 years", source: "tds" },
  };

  let threw = false;
  let conflicts: any = {};
  try {
    conflicts = checkConsistency(aiFieldsWithNumericAnswer, derivedFields, schema);
  } catch (err) {
    threw = true;
    console.error("  Unexpected throw:", err);
  }
  assert(!threw, "a numeric (non-string) AI answer does not crash checkConsistency");
  assert(!!conflicts.warranty, "a real conflict is still detected once both sides are coerced to strings (5 vs '5 years')");

  console.log("\n[2] checkConsistency — non-string derived answer also handled");
  const aiFieldsNormal: any = { warranty: { answer: "5 years", source: "web" } };
  const derivedFieldsNumeric: any = { warranty: { answer: 5, source: "tds" } };
  let threw2 = false;
  try {
    checkConsistency(aiFieldsNormal, derivedFieldsNumeric, schema);
  } catch (err) {
    threw2 = true;
    console.error("  Unexpected throw:", err);
  }
  assert(!threw2, "a numeric (non-string) derived answer does not crash checkConsistency either");

  console.log("\n[3] checkConsistency — matching answers still produce no conflict");
  const aiFieldsMatching: any = { warranty: { answer: "5 years", source: "web" } };
  const derivedFieldsMatching: any = { warranty: { answer: "5 years", source: "tds" } };
  const noConflicts = checkConsistency(aiFieldsMatching, derivedFieldsMatching, schema);
  assert(Object.keys(noConflicts).length === 0, "identical AI/derived answers produce no false-positive conflict");

  console.log("\n[4] checkConsistency — null/undefined answers are skipped, not crashed");
  const aiFieldsNull: any = { warranty: { answer: null, source: "none" } };
  const derivedFieldsReal: any = { warranty: { answer: "5 years", source: "tds" } };
  let threw3 = false;
  let conflictsNull: any = {};
  try {
    conflictsNull = checkConsistency(aiFieldsNull, derivedFieldsReal, schema);
  } catch (err) {
    threw3 = true;
  }
  assert(!threw3, "a null AI answer does not crash checkConsistency");
  assert(Object.keys(conflictsNull).length === 0, "a null AI answer produces no conflict (nothing real to compare)");

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
