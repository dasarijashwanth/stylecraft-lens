// scripts/verify-fact-conflict-detection.ts
// Offline regression check for the NEW cross-document fact-conflict
// detection (lib/db/extracted-facts.ts's findFactConflicts) — populates
// memoryDb directly (the same local fallback the app itself uses without a
// configured Supabase project) rather than hitting a real database. Zero
// network calls. Run with: npx tsx scripts/verify-fact-conflict-detection.ts

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

async function main() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Refusing to run — Supabase env vars are set. This script is memoryDb-only and must never touch a real project.");
    process.exit(1);
  }

  const { memoryDb } = await import("../lib/memoryDb");
  const { findFactConflicts, confirmFact, getMergedFactsForProject } = await import("../lib/db/extracted-facts");

  const projectId = "proj_conflict_test";
  const now = new Date();

  // Two active docs (TDS + Spec Sheet) disagreeing on motor_rpm — the
  // exact fixture from the feature spec (7,200 vs 7,500).
  memoryDb.uploadedSourceDocs.push(
    { id: "doc_tds", projectId, docType: "tds", fileBase64: "", fileName: "product-tds.pdf", fileSizeBytes: 1000, mimeType: "application/pdf", version: 1, isActive: true, fullText: "RPM: 7,200", extractionStatus: "complete", factsExtractionStatus: "complete", locations: [], uploadedBy: null, uploadedAt: now, updatedAt: now },
    { id: "doc_spec", projectId, docType: "spec_sheet", fileBase64: "", fileName: "spec-sheet.xlsx", fileSizeBytes: 1000, mimeType: "application/vnd.ms-excel", version: 1, isActive: true, fullText: "RPM: 7,500", extractionStatus: "complete", factsExtractionStatus: "complete", locations: [], uploadedBy: null, uploadedAt: now, updatedAt: now },
  );
  memoryDb.extractedFacts.push(
    { id: "fact_tds_rpm", sourceDocId: "doc_tds", projectId, fieldId: "motor_rpm", value: "7200", rawText: "RPM: 7,200", sourceLocation: "p.2", confirmedByUser: false, factType: "grounded_field", confidence: "high", createdAt: now, updatedAt: now },
    { id: "fact_spec_rpm", sourceDocId: "doc_spec", projectId, fieldId: "motor_rpm", value: "7500", rawText: "RPM: 7,500", sourceLocation: "Motor sheet", confirmedByUser: false, factType: "grounded_field", confidence: "high", createdAt: now, updatedAt: now },
    // Same key, values that are the SAME after normalization (comma vs no
    // comma) — must NOT be flagged as a conflict.
    { id: "fact_tds_warranty", sourceDocId: "doc_tds", projectId, fieldId: "warranty", value: "2 years", rawText: "Warranty: 2 years", sourceLocation: "p.5", confirmedByUser: false, factType: "grounded_field", confidence: "high", createdAt: now, updatedAt: now },
    { id: "fact_spec_warranty", sourceDocId: "doc_spec", projectId, fieldId: "warranty", value: "2 Years", rawText: "Warranty: 2 Years", sourceLocation: "Warranty sheet", confirmedByUser: false, factType: "grounded_field", confidence: "high", createdAt: now, updatedAt: now },
  );

  console.log("\n[1] TDS says 7,200 RPM, spec sheet says 7,500 — both surfaced as a conflict");
  let conflicts = await findFactConflicts(projectId);
  const rpmConflict = conflicts.find(c => c.field_id === "motor_rpm");
  assert(!!rpmConflict, "motor_rpm is detected as a conflict");
  assert(rpmConflict!.candidates.length === 2, `both candidate values are present (got ${rpmConflict?.candidates.length})`);
  assert(rpmConflict!.candidates.some(c => c.value === "7200") && rpmConflict!.candidates.some(c => c.value === "7500"), "both the 7200 and 7500 values are present verbatim");

  console.log("\n[2] Case/whitespace-only differences are NOT flagged as a conflict");
  const warrantyConflict = conflicts.find(c => c.field_id === "warranty");
  assert(!warrantyConflict, "\"2 years\" vs \"2 Years\" (case difference only) is not a real conflict");

  console.log("\n[3] Auto-resolve (used by the automatic fill, never blocked by an unresolved conflict) still picks a winner via doc-type priority");
  assert(rpmConflict!.auto_resolved_source_doc_id === "doc_tds", "TDS (doc-type priority 0) auto-resolves ahead of Spec Sheet (priority 1) until a user picks");
  const mergedBefore = await getMergedFactsForProject(projectId);
  assert(mergedBefore.factsByFieldId.motor_rpm.value === "7200", "the automatic fill's own merge already uses the TDS value — a conflict never blocks auto-fill");

  console.log("\n[4] User pick propagates everywhere via the EXISTING confirmed_by_user mechanism — no new propagation logic needed");
  await confirmFact("doc_spec", projectId, "motor_rpm", { value: "7500", rawText: "RPM: 7,500", sourceLocation: "Motor sheet" });
  const mergedAfter = await getMergedFactsForProject(projectId);
  assert(mergedAfter.factsByFieldId.motor_rpm.value === "7500" && mergedAfter.factsByFieldId.motor_rpm.confirmed_by_user, "after the user picks the Spec Sheet's 7500 value, it wins the merge — confirmed_by_user beats doc-type priority");

  console.log("\n[5] A settled (confirmed) field is no longer surfaced as a conflict");
  conflicts = await findFactConflicts(projectId);
  assert(!conflicts.some(c => c.field_id === "motor_rpm"), "motor_rpm no longer appears in the conflict list once a user has confirmed a value for it");

  console.log("\n[6] Fewer than 2 active docs -> no conflicts possible, cheap early return");
  const singleDocProjectId = "proj_single_doc";
  memoryDb.uploadedSourceDocs.push({ id: "doc_only", projectId: singleDocProjectId, docType: "tds", fileBase64: "", fileName: "only.pdf", fileSizeBytes: 100, mimeType: "application/pdf", version: 1, isActive: true, fullText: "RPM: 7000", extractionStatus: "complete", factsExtractionStatus: "complete", locations: [], uploadedBy: null, uploadedAt: now, updatedAt: now });
  const singleDocConflicts = await findFactConflicts(singleDocProjectId);
  assert(singleDocConflicts.length === 0, "a project with only 1 active doc never has a cross-document conflict");

  console.log(`\n${passes} passed, ${failures} failed`);
  // lib/memoryDb.ts's constructor starts a real setInterval (its periodic
  // snapshot autosave, meant for a long-running server process) — importing
  // it keeps a plain script's Node process alive forever unless explicitly
  // exited here.
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
