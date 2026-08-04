// scripts/verify-tds-doc-ingestion.ts
// Offline regression check for Uploaded TDS Ingestion: format extraction
// (DOCX/XLSX built as real synthetic buffers offline, no live file needed),
// magic-byte security, the fill-ladder override + grounding-rule builders,
// finalize's pre-launch terminal phrasing, and the DB layer's versioning/
// carry-forward/merge-priority behavior (memoryDb only). No live OpenAI/
// Gemini/Supabase/Rainforest call — structured fact extraction itself is
// only checked for graceful no-key behavior, same convention as this
// repo's other AI-touching verify scripts (e.g. verify-gtm-workbook-export.ts).
//
// Run with: VERCEL=1 npx tsx scripts/verify-tds-doc-ingestion.ts

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

const PROJECT_ID = "proj_tds_ingest_test";

async function main() {
  const PizZip = (await import("pizzip")).default;
  const XLSX = await import("xlsx");
  const { extractDocxContent, extractXlsxContent, splitVisionTranscriptIntoPages } = await import("../lib/tds-doc-extract");
  const { extractStructuredFacts } = await import("../lib/tds-doc-facts");
  const { detectDocType } = await import("../lib/file-magic-bytes");
  const { applyUploadedTdsFacts, buildUploadedTdsPromptBlock, buildPreLaunchGroundingRule, buildTdsGroundingBlock } = await import("../lib/gtm-uploaded-tds");
  const { finalizeFieldAnswers } = await import("../lib/field-finalize");
  const { GTM_FIELD_SCHEMA } = await import("../lib/gtm-field-schema");
  const {
    createNewVersion,
    listVersionsForProjectDocType,
    listActiveDocsForProject,
    updateExtractionResult,
  } = await import("../lib/db/uploaded-source-docs");
  const { upsertFacts, confirmFact, carryForwardConfirmedFacts, getMergedFactsForProject } = await import("../lib/db/extracted-facts");

  // ---- Section 1: DOCX extraction (real synthetic buffer, no live file) ----
  console.log("\n[1] extractDocxContent — real synthetic .docx buffer");
  const docxZip = new PizZip();
  docxZip.file(
    "word/document.xml",
    `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>Motor Type: Brushless (EON Digital)</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>RPM</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>7200</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
</w:body>
</w:document>`
  );
  const docxBuffer: Buffer = docxZip.generate({ type: "nodebuffer" });
  const docxResult = await extractDocxContent(docxBuffer);
  assert(docxResult.extractionStatus === "complete", "docx extraction reports complete");
  assert(docxResult.fullText.includes("Motor Type: Brushless (EON Digital)"), "docx body paragraph text extracted");
  assert(docxResult.fullText.includes("RPM") && docxResult.fullText.includes("7200"), "docx table cell text extracted");
  assert(docxResult.locations.some(l => l.label.startsWith("table")), "a table location is reported separately from the body");

  // ---- Section 2: XLSX extraction (real synthetic buffer via the xlsx package's own writer) ----
  console.log("\n[2] extractXlsxContent — real synthetic .xlsx buffer");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([["Motor Type", "Brushless"], ["Run Time", "3h"]]);
  XLSX.utils.book_append_sheet(wb, ws, "Motor");
  const xlsxBuffer: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const xlsxResult = await extractXlsxContent(xlsxBuffer);
  assert(xlsxResult.extractionStatus === "complete", "xlsx extraction reports complete");
  assert(xlsxResult.fullText.includes("Motor Type") && xlsxResult.fullText.includes("Brushless"), "xlsx cell values extracted");
  assert(xlsxResult.locations.some(l => l.label === "Motor sheet"), "sheet name reported as a location label");

  // ---- Section 3: scanned-PDF OCR transcript splitting (pure function, no live PDF/AI needed) ----
  console.log("\n[3] splitVisionTranscriptIntoPages — OCR fallback transcript parsing");
  const transcript = "[PAGE 1]\nMotor Type: Brushless\n\n[PAGE 2]\nWarranty: 2 years";
  const pages = splitVisionTranscriptIntoPages(transcript);
  assert(pages.length === 2, `splits into exactly 2 pages (got ${pages.length})`);
  assert(pages[0].label === "p.1" && pages[0].text.includes("Motor Type"), "page 1 labeled and contains its own text");
  assert(pages[1].label === "p.2" && pages[1].text.includes("Warranty"), "page 2 labeled and contains its own text");
  const noMarkerTranscript = "Just plain text, no page markers";
  const fallbackPages = splitVisionTranscriptIntoPages(noMarkerTranscript);
  assert(fallbackPages.length === 1 && fallbackPages[0].label === "p.1", "a transcript with no [PAGE N] markers falls back to one p.1 block");

  // ---- Section 4: structured fact extraction — graceful no-key behavior ----
  console.log("\n[4] extractStructuredFacts — no OpenAI key configured in this environment");
  const facts = await extractStructuredFacts({ fullText: "Motor Type: Brushless. RPM: 7200.", locations: [], extractionStatus: "complete", extractionMethod: "text-layer" }, "Test Product");
  assert(Array.isArray(facts) && facts.length === 0, "gracefully returns an empty array rather than inventing content");

  // ---- Section 5: magic-byte security ----
  console.log("\n[5] detectDocType — real signatures vs. mislabeled/foreign content");
  const realPdfBuffer = Buffer.from("%PDF-1.4\n%stuff");
  assert(detectDocType(realPdfBuffer) === "pdf", "real PDF signature detected");
  assert(detectDocType(xlsxBuffer) === "xlsx", "real xlsx buffer detected as xlsx (contains xl/workbook.xml)");
  assert(detectDocType(docxBuffer) === "docx", "real docx buffer detected as docx (contains word/document.xml)");
  const fakeHtml = Buffer.from("<html><body><script>alert(1)</script></body></html>");
  assert(detectDocType(fakeHtml) === null, "HTML renamed to look like a doc is rejected — no matching signature");
  const bareZip = (() => {
    const z = new PizZip();
    z.file("readme.txt", "just a plain zip, not xlsx or docx");
    return z.generate({ type: "nodebuffer" }) as Buffer;
  })();
  assert(detectDocType(bareZip) === null, "a plain zip with neither xlsx nor docx's defining part is rejected");

  // ---- Section 6: fill-ladder override (lib/gtm-uploaded-tds.ts) ----
  console.log("\n[6] applyUploadedTdsFacts — verbatim override, project_record is the only thing that outranks it");
  const schema = GTM_FIELD_SCHEMA.filter(f => ["motor_type", "warranty", "product_title"].includes(f.id));
  const context = {
    factsByFieldId: {
      motor_type: { field_id: "motor_type", value: "Brushless Motor (EON Digital)", raw_text: "Brushless (EON Digital)", source_location: "p.2", doc_type: "tds" as const, source_doc_id: "doc1", confirmed_by_user: false },
      warranty: { field_id: "warranty", value: "2 years", raw_text: "2-year warranty", source_location: "p.5", doc_type: "tds" as const, source_doc_id: "doc1", confirmed_by_user: false },
    },
    fullTextBlocks: ["Brushless (EON Digital) motor. 2-year warranty on all parts."],
    docsUsed: [{ docType: "tds", id: "doc1", version: 1 }],
    hasFacts: true,
  };
  const fieldsA: Record<string, any> = {
    motor_type: { answer: "N/A", source: "none" },
    warranty: { answer: "Old Value", source: "web" },
    product_title: { answer: "My Clipper", source: "project_record" },
  };
  const touched = applyUploadedTdsFacts(fieldsA, schema, context);
  assert(fieldsA.motor_type.answer === "Brushless Motor (EON Digital)" && fieldsA.motor_type.source === "uploaded_tds", "an unresolved field is filled verbatim from the uploaded TDS fact");
  assert(fieldsA.warranty.answer === "2 years" && fieldsA.warranty.source === "uploaded_tds", "a web-sourced answer is overridden by the uploaded TDS fact");
  assert(fieldsA.product_title.answer === "My Clipper" && fieldsA.product_title.source === "project_record", "a project_record-sourced answer is NEVER overridden — the one thing that outranks uploaded TDS");
  assert(touched.has("motor_type") && touched.has("warranty") && !touched.has("product_title"), "the touched-fields set correctly reflects what was actually overridden");

  console.log("\n[6b] prompt-block builders — gated correctly on hasFacts / isPreLaunch");
  const emptyContext = { factsByFieldId: {}, fullTextBlocks: [], docsUsed: [], hasFacts: false };
  assert(buildUploadedTdsPromptBlock(emptyContext) === "(none uploaded for this project)", "prompt block is a plain placeholder when no facts exist");
  assert(buildUploadedTdsPromptBlock(context).includes("motor_type"), "prompt block includes the real fact list when facts exist");
  assert(buildPreLaunchGroundingRule(false) === "", "pre-launch rule is empty when not applicable");
  assert(buildPreLaunchGroundingRule(true).toLowerCase().includes("pre-launch"), "pre-launch rule text is present when applicable");
  assert(buildTdsGroundingBlock(emptyContext, true) === "", "combined grounding block is empty with no facts, even if pre-launch");
  assert(buildTdsGroundingBlock(context, true).includes("pre-launch") && buildTdsGroundingBlock(context, false).includes("motor_type") && !buildTdsGroundingBlock(context, false).toLowerCase().includes("pre-launch/custom with no live web presence"), "combined grounding block includes facts always, and the hard rule only when pre-launch");

  // ---- Section 7: finalize's pre-launch terminal phrasing ----
  console.log("\n[7] finalizeFieldAnswers — pre-launch terminal reason override");
  const finalizeSchema = [{ id: "motor_rpm", kind: "grounded" as const }, { id: "approved_pricing", kind: "internal" as const }];
  const finalized = finalizeFieldAnswers({}, finalizeSchema, 3, "pre-launch: no web presence");
  assert(finalized.motor_rpm.answer === "Not found — pre-launch: no web presence", `grounded field gets the pre-launch reason (got "${finalized.motor_rpm.answer}")`);
  assert(finalized.approved_pricing.answer === "Awaiting internal input", "internal-kind field ignores the override, still Awaiting internal input");
  const finalizedNoOverride = finalizeFieldAnswers({}, [{ id: "motor_rpm", kind: "grounded" as const }], 4);
  assert(finalizedNoOverride.motor_rpm.answer === "Not found — checked 4 sources", "with no override, the generic checked-K-sources phrasing is unchanged");

  // ---- Section 8: versioning + carry-forward + merge priority (memoryDb) ----
  console.log("\n[8] Versioning — replacing a doc auto-activates the new version, old kept");
  const tdsV1 = await createNewVersion({ projectId: PROJECT_ID, docType: "tds", filePath: "p1", fileName: "tds-v1.pdf", fileSizeBytes: 100, mimeType: "application/pdf" });
  assert(tdsV1.version === 1 && tdsV1.is_active, "first upload is version 1, active");
  await updateExtractionResult(tdsV1.id, "Motor Type: Brushless. Warranty: 1 year.", "complete");
  await upsertFacts(tdsV1.id, PROJECT_ID, [{ field_id: "motor_type", value: "Brushless Motor", raw_text: "Brushless" }]);
  await confirmFact(tdsV1.id, PROJECT_ID, "warranty", { value: "2 years (user-corrected)" });

  const tdsV2 = await createNewVersion({ projectId: PROJECT_ID, docType: "tds", filePath: "p2", fileName: "tds-v2.pdf", fileSizeBytes: 120, mimeType: "application/pdf" });
  assert(tdsV2.version === 2 && tdsV2.is_active, "replacement is version 2, active");
  const versions = await listVersionsForProjectDocType(PROJECT_ID, "tds");
  assert(versions.length === 2, `both versions are kept and queryable (got ${versions.length})`);
  assert(!versions.find(v => v.id === tdsV1.id)!.is_active, "the old version is deactivated, not deleted");

  await carryForwardConfirmedFacts(tdsV1.id, tdsV2.id, PROJECT_ID);
  const activeDocsAfterReplace = await listActiveDocsForProject(PROJECT_ID);
  assert(activeDocsAfterReplace.length === 1 && activeDocsAfterReplace[0].id === tdsV2.id, "only the new version is active for this project+docType");

  console.log("\n[9] Merge priority — TDS beats Spec Sheet, but a user confirmation always wins regardless of doc type");
  const specSheet = await createNewVersion({ projectId: PROJECT_ID, docType: "spec_sheet", filePath: "p3", fileName: "spec.xlsx", fileSizeBytes: 80, mimeType: "application/vnd.ms-excel" });
  await upsertFacts(specSheet.id, PROJECT_ID, [
    { field_id: "motor_type", value: "Brushless (Spec Sheet says something different)" },
    { field_id: "product_weight", value: "1.2 lbs" },
  ]);
  await upsertFacts(tdsV2.id, PROJECT_ID, [{ field_id: "motor_type", value: "Brushless Motor" }]);
  await confirmFact(specSheet.id, PROJECT_ID, "motor_type", { value: "Brushless Motor (user confirmed on spec sheet)" });

  const merged = await getMergedFactsForProject(PROJECT_ID);
  assert(merged.factsByFieldId.motor_type.value === "Brushless Motor (user confirmed on spec sheet)", `a user confirmation on the LOWER-priority doc type still wins (got "${merged.factsByFieldId.motor_type.value}")`);
  assert(merged.factsByFieldId.product_weight.value === "1.2 lbs", "a field only the spec sheet answers is still included in the merge");
  assert(merged.docsUsed.length === 2, `both active docs are reported as used (got ${merged.docsUsed.length})`);

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
