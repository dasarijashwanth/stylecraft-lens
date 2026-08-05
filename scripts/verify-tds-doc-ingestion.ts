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

// A static top-level import, not the dynamic `await import("xlsx")` this
// file otherwise uses for every other module — confirmed live: under
// tsx/Node's CJS-interop for a dynamic import(), this package's `.CFB`
// namespace is dropped from the resolved module entirely (a static import
// exposes it correctly; lib/tds-doc-extract.ts's own real code already
// uses this same static form, so production is unaffected — this is
// purely a test-script fixture-construction concern).
import * as XLSX_STATIC from "xlsx";

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
  const { detectDocType, looksLikeText } = await import("../lib/file-magic-bytes");
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
  // Regression test — a real bug caught in production: many real-world
  // PDFs (scanner output, third-party re-saves, a leading BOM) have a few
  // junk bytes before "%PDF-" even though it's conventionally at byte 0.
  // An earlier version of detectDocType required an exact byte-0 match and
  // rejected these as invalid uploads.
  const pdfWithLeadingJunk = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("%PDF-1.7\n%real content")]);
  assert(detectDocType(pdfWithLeadingJunk) === "pdf", "a real PDF with a few leading junk bytes (BOM/scanner artifact) before %PDF- is still detected");
  // Regression test #2 — a REAL upload was still rejected in production
  // even after the fix above: some scan-to-PDF/print-driver tools prepend
  // an embedded thumbnail preview or a large XMP metadata packet that runs
  // well past a 1KB sniff window before the actual "%PDF-" header. Widened
  // to 64KB; this fixture's ~40KB preamble sits past the OLD 1KB window
  // but comfortably within the new one.
  const pdfWithLargePreamble = Buffer.concat([Buffer.alloc(40_000, 0x00), Buffer.from("%PDF-1.6\n%real content")]);
  assert(detectDocType(pdfWithLargePreamble) === "pdf", "a real PDF with a ~40KB preamble (past the old 1KB window) is still detected after widening to 64KB");
  const pdfWithPreambleBeyondWindow = Buffer.concat([Buffer.alloc(70_000, 0x00), Buffer.from("%PDF-1.6\n%real content")]);
  assert(detectDocType(pdfWithPreambleBeyondWindow) === null, "a preamble genuinely beyond the 64KB window is still rejected — the check isn't a no-op");
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

  // ---- Section 5b: wall-clock deadlines + the content/facts split (lib/tds-doc-ingest.ts) ----
  // Regression test — a real bug caught in production, TWICE: the finalize
  // route's maxDuration=60 (Vercel Hobby's hard cap) could be exceeded by a
  // scanned PDF's OCR fallback (up to ~57s alone) plus structured-fact
  // extraction (up to ~30s more) sharing one request, which killed the
  // whole function and returned a raw HTML error page instead of JSON (the
  // browser then crashed trying to JSON.parse it, or saw "Server took too
  // long to respond"). The real fix: content extraction and fact
  // extraction are now two SEPARATE functions/routes, each with its own
  // full deadline, so they never compound in one request. withDeadline is
  // the shared mechanism both rely on — can't exercise a real slow AI call
  // offline, so this verifies the mechanism + the split directly.
  console.log("\n[5b] withDeadline + the content/facts split — never compounds two AI-heavy steps in one request");
  const { withDeadline, CONTENT_EXTRACTION_DEADLINE_MS, FACTS_DERIVATION_DEADLINE_MS, deriveFactsForDoc } = await import("../lib/tds-doc-ingest");
  const fastResult = await withDeadline(Promise.resolve("real result"), 5000, "fallback");
  assert(fastResult === "real result", "a promise that resolves well within the deadline returns its real value");

  const slowPromise = new Promise<string>(resolve => setTimeout(() => resolve("too slow"), 200));
  const timedOutResult = await withDeadline(slowPromise, 20, "fallback (extraction failed)");
  assert(timedOutResult === "fallback (extraction failed)", "a promise still running past the deadline resolves to the fallback instead of hanging the caller");
  assert(CONTENT_EXTRACTION_DEADLINE_MS < 60_000 && CONTENT_EXTRACTION_DEADLINE_MS >= 30_000, `content extraction's OWN full deadline (${CONTENT_EXTRACTION_DEADLINE_MS}ms) leaves real headroom under Vercel's 60s cap`);
  assert(FACTS_DERIVATION_DEADLINE_MS < 60_000 && FACTS_DERIVATION_DEADLINE_MS >= 30_000, `fact derivation's OWN full deadline (${FACTS_DERIVATION_DEADLINE_MS}ms), in its OWN request, never has to share a budget with content extraction's OCR call anymore`);

  console.log("\n[5c] deriveFactsForDoc — reads already-persisted full_text, never re-downloads/re-extracts");
  // Own project id (distinct docType scope from Section 8/9 below) — createNewVersion
  // auto-increments version/deactivation WITHIN (projectId, docType), so sharing
  // PROJECT_ID + "tds" here would shift Section 8's own version-number assertions.
  const FACTS_TEST_PROJECT_ID = "proj_tds_ingest_facts_test";
  const factsDoc = await createNewVersion({ projectId: FACTS_TEST_PROJECT_ID, docType: "tds", filePath: "p_facts", fileName: "facts-test.pdf", fileSizeBytes: 50, mimeType: "application/pdf" });
  await updateExtractionResult(factsDoc.id, "Motor Type: Brushless. RPM: 7200.", "complete");
  const derived = await deriveFactsForDoc(factsDoc.id, FACTS_TEST_PROJECT_ID, "Test Product");
  assert(Array.isArray(derived.sampleFacts) && derived.factsFound === derived.sampleFacts.length || derived.factsFound >= derived.sampleFacts.length, "deriveFactsForDoc returns a consistent {factsFound, sampleFacts} shape");
  assert(derived.factsFound === 0, "with no OpenAI/Gemini key configured, deriveFactsForDoc gracefully returns 0 facts rather than inventing content (matches extractStructuredFacts's own established no-key behavior)");

  const pendingDoc = await createNewVersion({ projectId: FACTS_TEST_PROJECT_ID, docType: "spec_sheet", filePath: "p_pending", fileName: "pending-test.pdf", fileSizeBytes: 50, mimeType: "application/pdf" });
  const derivedPending = await deriveFactsForDoc(pendingDoc.id, FACTS_TEST_PROJECT_ID, "Test Product");
  assert(derivedPending.factsFound === 0 && derivedPending.sampleFacts.length === 0, "a document whose content extraction hasn't completed yet (still 'pending') is skipped gracefully, never crashes");

  const zeroBudgetResult = await deriveFactsForDoc(factsDoc.id, FACTS_TEST_PROJECT_ID, "Test Product", Date.now() - 999_999);
  assert(zeroBudgetResult.factsFound === 0, "a routeStartTime already past the deadline skips the AI call entirely instead of attempting it with a negative/zero budget");

  // ---- Section 5d: DOC/XLS/CSV support (Sources tab upload hardening) ----
  console.log("\n[5d] Legacy XLS — SheetJS's own XLSX.read auto-detects BIFF, extractXlsxContent already handles it");
  const xlsWorkbook = XLSX.utils.book_new();
  const xlsSheet = XLSX.utils.aoa_to_sheet([["Motor Type", "Brushless"], ["Run Time", "3h"]]);
  XLSX.utils.book_append_sheet(xlsWorkbook, xlsSheet, "Motor");
  const xlsBuffer: Buffer = XLSX.write(xlsWorkbook, { type: "buffer", bookType: "biff8" });
  assert(detectDocType(xlsBuffer) === "xls", "a real legacy .xls (BIFF8) buffer is detected as xls, not confused with .doc");
  const xlsResult = await extractXlsxContent(xlsBuffer);
  assert(xlsResult.extractionStatus === "complete" && xlsResult.fullText.includes("Brushless"), "extractXlsxContent (reused for .xls) extracts real content from a legacy XLS buffer");

  console.log("\n[5e] Legacy DOC — CFB WordDocument stream detected and disambiguated from XLS's Workbook stream");
  const { extractDocContent, extractCsvContent } = await import("../lib/tds-doc-extract");
  const docBuffer: Buffer = (() => {
    const cfb = (XLSX_STATIC as any).CFB.utils.cfb_new();
    (XLSX_STATIC as any).CFB.utils.cfb_add(cfb, "WordDocument", Buffer.from("Motor Type: Brushless (EON Digital). Warranty: 2 years on all parts.", "ascii"));
    return (XLSX_STATIC as any).CFB.write(cfb, { type: "buffer" });
  })();
  assert(detectDocType(docBuffer) === "doc", "a real synthetic .doc (CFB with a WordDocument stream) is detected as doc, not xls");
  assert(detectDocType(xlsBuffer) !== "doc", "the legacy XLS fixture is never misdetected as doc (Workbook vs WordDocument stream disambiguates)");
  const docResult = await extractDocContent(docBuffer);
  assert(docResult.extractionStatus === "complete", "extractDocContent's best-effort CFB text sweep reports complete for real text content");
  assert(docResult.fullText.includes("Brushless") && docResult.fullText.includes("Warranty"), "extractDocContent recovers real readable text from the WordDocument stream (best-effort, not a full Word parse)");

  // Regression test — a real production incident: an earlier version of
  // sweepPrintableRuns had no cap on how much of the WordDocument stream it
  // would scan, a synchronous byte-by-byte loop that blocked the Node event
  // loop long enough on a large real .doc upload to blow past Vercel's 60s
  // maxDuration (which the finalize route's own withDeadline/routeStartTime
  // budgeting can't catch — that mechanism only races ASYNC promises via
  // setTimeout, and can't interrupt synchronous CPU-bound work). Verifies
  // the fix directly: even a maximally adversarial ~14MB buffer that's
  // ENTIRELY "printable-looking" bytes (the worst case for this sweep)
  // completes in well under a second.
  console.log("\n[5e-2] extractDocContent — a large adversarial buffer never blocks the event loop for long (regression: unbounded sweep)");
  const adversarialDocBuffer: Buffer = (() => {
    const cfb = (XLSX_STATIC as any).CFB.utils.cfb_new();
    // All printable ASCII, ~14MB — the exact worst case for a naive
    // unbounded sweep (one giant continuous "run" the whole way through).
    const bigContent = Buffer.alloc(14 * 1024 * 1024, 0x41); // 'A' repeated
    (XLSX_STATIC as any).CFB.utils.cfb_add(cfb, "WordDocument", bigContent);
    return (XLSX_STATIC as any).CFB.write(cfb, { type: "buffer" });
  })();
  const sweepStart = Date.now();
  const adversarialResult = await extractDocContent(adversarialDocBuffer);
  const sweepElapsedMs = Date.now() - sweepStart;
  assert(sweepElapsedMs < 5000, `a ~14MB all-printable adversarial .doc buffer is swept in well under 5s (got ${sweepElapsedMs}ms) — proves the MAX_DOC_SWEEP_BYTES cap actually bounds the work`);
  assert(adversarialResult.extractionStatus === "complete", "the capped sweep still reports a real result, not a crash/failure, for the adversarial buffer");

  console.log("\n[5f] CSV — no binary signature, validated by content-sniff instead of detectDocType");
  const csvBuffer = Buffer.from("field,value\nMotor Type,Brushless\nWarranty,2 years\n", "utf-8");
  assert(looksLikeText(csvBuffer), "a real CSV's plain-text bytes pass the text-sniff check");
  const csvResult = await extractCsvContent(csvBuffer);
  assert(csvResult.extractionStatus === "complete" && csvResult.fullText.includes("Motor Type,Brushless"), "extractCsvContent decodes real CSV rows into fullText");
  const binaryAsCsv = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x00, 0x00]);
  assert(!looksLikeText(binaryAsCsv), "a binary file's bytes fail the text-sniff check regardless of its .csv extension");

  console.log("\n[5g] inferFormatFromFileName — all 6 accepted extensions, plus a genuinely unsupported one");
  const { inferFormatFromFileName, ACCEPTED_SOURCE_DOC_TYPES_LABEL } = await import("../lib/tds-doc-ingest");
  assert(inferFormatFromFileName("spec.pdf") === "pdf", "'.pdf' -> pdf");
  assert(inferFormatFromFileName("spec.xlsx") === "xlsx", "'.xlsx' -> xlsx");
  assert(inferFormatFromFileName("spec.xlsm") === "xlsx", "'.xlsm' -> xlsx (macro-enabled workbook, same OOXML shape)");
  assert(inferFormatFromFileName("spec.docx") === "docx", "'.docx' -> docx");
  assert(inferFormatFromFileName("spec.doc") === "doc", "'.doc' -> doc");
  assert(inferFormatFromFileName("spec.xls") === "xls", "'.xls' -> xls");
  assert(inferFormatFromFileName("spec.csv") === "csv", "'.csv' -> csv");
  assert(inferFormatFromFileName("photo.png") === null, "an unsupported extension (.png) returns null");
  assert(ACCEPTED_SOURCE_DOC_TYPES_LABEL.includes("CSV"), "the shared accepted-types label mentions CSV (used in both client and server rejection messages)");

  console.log("\n[5h] ingestSourceDocUpload — 15MB size limit, wrong-content rejection, real DOC/CSV uploads succeed");
  const { ingestSourceDocUpload, MAX_SOURCE_DOC_SIZE_BYTES } = await import("../lib/tds-doc-ingest");
  const oversized = Buffer.alloc(MAX_SOURCE_DOC_SIZE_BYTES + 1024);
  try {
    await ingestSourceDocUpload({ projectId: "proj_size_test", docType: "other", filePath: "p", fileName: "big.pdf", buffer: oversized, mimeType: "application/pdf", productName: "Test" });
    assert(false, "an oversized file should have thrown");
  } catch (err: any) {
    assert(err.status === 400 && /MB/.test(err.message), `an oversized file is rejected with a specific MB-based message (got "${err.message}")`);
  }

  try {
    await ingestSourceDocUpload({ projectId: "proj_type_test", docType: "other", filePath: "p", fileName: "fake.docx", buffer: fakeHtml, mimeType: "application/octet-stream", productName: "Test" });
    assert(false, "content/extension mismatch should have thrown");
  } catch (err: any) {
    assert(err.status === 400 && err.message.includes("doesn't match its extension"), `a .docx-named file with HTML content is rejected (got "${err.message}")`);
  }

  try {
    await ingestSourceDocUpload({ projectId: "proj_csv_binary_test", docType: "other", filePath: "p", fileName: "fake.csv", buffer: binaryAsCsv, mimeType: "text/csv", productName: "Test" });
    assert(false, "a binary file named .csv should have thrown");
  } catch (err: any) {
    assert(err.status === 400 && err.message.toLowerCase().includes("csv"), `a binary file named .csv is rejected with a CSV-specific message (got "${err.message}")`);
  }

  const realDocUpload = await ingestSourceDocUpload({ projectId: "proj_doc_success_test", docType: "spec_sheet", filePath: "p_doc", fileName: "spec.doc", buffer: docBuffer, mimeType: "application/msword", productName: "Test Product" });
  assert(realDocUpload.document.file_name === "spec.doc", "a real, correctly-typed .doc upload succeeds and is persisted");
  const realCsvUpload = await ingestSourceDocUpload({ projectId: "proj_csv_success_test", docType: "other", filePath: "p_csv", fileName: "spec.csv", buffer: csvBuffer, mimeType: "text/csv", productName: "Test Product" });
  assert(realCsvUpload.document.file_name === "spec.csv", "a real, correctly-typed .csv upload succeeds and is persisted");

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
