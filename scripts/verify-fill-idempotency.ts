// scripts/verify-fill-idempotency.ts
// Offline regression check for the fill mechanism's own two hard guarantees
// (Automatic Source-Doc Fact Extraction & Cross-Document Fill, Part 4):
// re-running a fill pass never duplicates/flip-flops an already-filled
// value, and a human edit is NEVER touched by any fill pass. Exercises the
// REAL lib/db/documents.ts functions against memoryDb (no Supabase, no AI,
// no network) — the exact same read/write/history primitives
// lib/document-fill-engine.ts's refillGtmFromSources uses, with the same
// write-gating logic reproduced here (candidate !== current, source not
// untouchable) since the full engine function itself calls live AI
// generators that can't run offline.
// Run with: npx tsx scripts/verify-fill-idempotency.ts

export {};

let passes = 0;
let failures = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passes++;
    console.log(`  PASS: ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const UNTOUCHABLE_SOURCES = new Set(["manual_edit", "project_record", "active_report"]);

// Mirrors lib/document-fill-engine.ts's own gate exactly — a candidate is
// only ever written if it's real, differs from the current answer, and the
// field's CURRENT source isn't untouchable.
function shouldWrite(current: { answer: string | null; source: string | null } | undefined, candidateAnswer: string): boolean {
  if (!current) return false;
  if (UNTOUCHABLE_SOURCES.has(current.source || "")) return false;
  const candidate = candidateAnswer.trim();
  const currentAnswer = (current.answer || "").trim();
  return !!candidate && candidate.toUpperCase() !== "N/A" && candidate !== currentAnswer;
}

async function main() {
  const { getOrCreateDocument, getDocumentFields, updateDocumentField } = await import("../lib/db/documents");
  const { memoryDb } = await import("../lib/memoryDb");

  const projectId = "proj_idempotency_test";
  const document = await getOrCreateDocument(projectId, "gtm");

  // Seed two field rows directly (updateDocumentField only updates an
  // existing row, matching the real fill routes' own usage — it never
  // creates one) — one genuinely blank (fillable), one already manually
  // edited (must never be touched).
  const now = new Date();
  memoryDb.documentFields.push(
    { id: "field_motor_type", documentId: document.id, fieldId: "motor_type", section: "Motor", question: "Motor Type", answer: "", aiAnswer: null, source: "none", sourceDetail: null, flagged: false, owner: null, notes: null, updatedBy: null, createdAt: now, updatedAt: now } as any,
    { id: "field_warranty", documentId: document.id, fieldId: "warranty", section: "General", question: "Warranty", answer: "1 year (my own correction)", aiAnswer: null, source: "manual_edit", sourceDetail: null, flagged: false, owner: null, notes: null, updatedBy: "human@test", createdAt: now, updatedAt: now } as any,
  );

  const candidateMotorType = "Brushless Motor (EON Digital)";
  const candidateWarranty = "2 years (from uploaded TDS)"; // a fill pass would WANT to write this, but must not

  console.log("\n[1] First pass — a genuinely blank field gets filled, a manual_edit field is skipped entirely");
  let fields = await getDocumentFields(document.id);
  let fieldsById = new Map(fields.map(f => [f.field_id, f]));

  assert(shouldWrite(fieldsById.get("motor_type"), candidateMotorType), "motor_type (blank, source:'none') is eligible to be written");
  assert(!shouldWrite(fieldsById.get("warranty"), candidateWarranty), "warranty (source:'manual_edit') is NEVER eligible, regardless of what the candidate says");

  if (shouldWrite(fieldsById.get("motor_type"), candidateMotorType)) {
    await updateDocumentField(document.id, "motor_type", candidateMotorType, "system@test", { source: "uploaded_tds", sourceDetail: { docType: "tds" } });
  }
  const historyCountAfterPass1 = memoryDb.documentFieldHistory.filter(h => h.documentFieldId === fieldsById.get("motor_type")!.id).length;

  console.log("\n[2] Second pass with the IDENTICAL candidate data — no duplicate write, no flip-flop");
  fields = await getDocumentFields(document.id);
  fieldsById = new Map(fields.map(f => [f.field_id, f]));

  assert(fieldsById.get("motor_type")!.answer === candidateMotorType, "motor_type now holds the filled value after pass 1");
  assert(fieldsById.get("motor_type")!.source === "uploaded_tds", "motor_type's source correctly reflects the fill");

  const pass2ShouldWrite = shouldWrite(fieldsById.get("motor_type"), candidateMotorType);
  assert(!pass2ShouldWrite, "re-running with the SAME candidate value is a no-op (candidate === current, the write-gate itself skips it)");
  if (pass2ShouldWrite) {
    await updateDocumentField(document.id, "motor_type", candidateMotorType, "system@test", { source: "uploaded_tds" });
  }

  const historyCountAfterPass2 = memoryDb.documentFieldHistory.filter(h => h.documentFieldId === fieldsById.get("motor_type")!.id).length;
  assert(historyCountAfterPass2 === historyCountAfterPass1, `no new history row was written on the no-op second pass (${historyCountAfterPass1} -> ${historyCountAfterPass2})`);

  console.log("\n[3] warranty (manual_edit) is STILL untouched after both passes");
  fields = await getDocumentFields(document.id);
  fieldsById = new Map(fields.map(f => [f.field_id, f]));
  assert(fieldsById.get("warranty")!.answer === "1 year (my own correction)", "the human's own correction survived both fill passes completely unchanged");
  assert(fieldsById.get("warranty")!.source === "manual_edit", "warranty's source is still manual_edit — never silently reclassified");

  console.log("\n[4] A DIFFERENT candidate value (e.g. a newer/replaced upload) DOES get written — idempotency isn't a blanket freeze");
  const newerCandidate = "Vector Motor (Precision Drive)";
  fields = await getDocumentFields(document.id);
  fieldsById = new Map(fields.map(f => [f.field_id, f]));
  assert(shouldWrite(fieldsById.get("motor_type"), newerCandidate), "a genuinely different candidate value (e.g. from a replaced/updated source doc) is still eligible to overwrite an uploaded_tds-sourced field");

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
