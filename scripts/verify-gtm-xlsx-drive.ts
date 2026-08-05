// scripts/verify-gtm-xlsx-drive.ts
// Offline regression check for the GTM XLSX-to-Drive feature — no live
// Supabase/Google Drive call, entirely against the memoryDb fallback
// (uploadToDrive itself is never invoked here; this only exercises
// lib/db/documents.ts's new setDocumentXlsxDriveInfo/xlsx_drive_url
// plumbing, which is the part this task actually added).
//
// Run with: npx tsx scripts/verify-gtm-xlsx-drive.ts

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

const ORG_ID = "dev_org_id";
const USER_ID = "dev_user_id";

async function main() {
  const { createProject } = await import("../lib/db/projects");
  const { getOrCreateDocument, getDocumentById, getDocumentByProject, setDocumentDriveInfo, setDocumentXlsxDriveInfo } = await import("../lib/db/documents");

  const project = await createProject(USER_ID, ORG_ID, { name: "Test Project", industry: "haircare-styling", targetMarket: "pro", productName: "Rival Clipper Pro" });
  const gtmDoc = await getOrCreateDocument(project.id, "gtm");

  console.log("\n[1] A brand-new document has no xlsx Drive info yet");
  assert(gtmDoc.xlsx_drive_url === null || gtmDoc.xlsx_drive_url === undefined, "xlsx_drive_url starts null/undefined");
  assert(gtmDoc.xlsx_drive_file_id === null || gtmDoc.xlsx_drive_file_id === undefined, "xlsx_drive_file_id starts null/undefined");
  assert(gtmDoc.drive_url === null || gtmDoc.drive_url === undefined, "the PDF's own drive_url also starts null/undefined");

  console.log("\n[2] setDocumentXlsxDriveInfo persists independently of the PDF's own drive_url");
  await setDocumentXlsxDriveInfo(gtmDoc.id, "https://drive.google.com/xlsx-link", "xlsx-file-id-123");
  const afterXlsxSave = await getDocumentById(gtmDoc.id);
  assert(afterXlsxSave?.xlsx_drive_url === "https://drive.google.com/xlsx-link", `xlsx_drive_url round-trips (got "${afterXlsxSave?.xlsx_drive_url}")`);
  assert(afterXlsxSave?.xlsx_drive_file_id === "xlsx-file-id-123", `xlsx_drive_file_id round-trips (got "${afterXlsxSave?.xlsx_drive_file_id}")`);
  assert(afterXlsxSave?.drive_url === null || afterXlsxSave?.drive_url === undefined, "saving the xlsx link does NOT touch the PDF's own drive_url");

  console.log("\n[3] Saving the PDF's own Drive link afterward does not clobber the xlsx link, and vice versa");
  await setDocumentDriveInfo(gtmDoc.id, "https://drive.google.com/pdf-link", "pdf-file-id-456");
  const afterPdfSave = await getDocumentById(gtmDoc.id);
  assert(afterPdfSave?.drive_url === "https://drive.google.com/pdf-link", `drive_url (PDF) round-trips (got "${afterPdfSave?.drive_url}")`);
  assert(afterPdfSave?.xlsx_drive_url === "https://drive.google.com/xlsx-link", "the earlier xlsx_drive_url survives the PDF's own save untouched");

  console.log("\n[4] getDocumentByProject returns the same xlsx Drive fields as getDocumentById");
  const viaProject = await getDocumentByProject(project.id, "gtm");
  assert(viaProject?.xlsx_drive_url === "https://drive.google.com/xlsx-link", "getDocumentByProject surfaces xlsx_drive_url identically");
  assert(viaProject?.xlsx_drive_file_id === "xlsx-file-id-123", "getDocumentByProject surfaces xlsx_drive_file_id identically");

  console.log(`\n${passes} passed, ${failures} failed`);
  // Explicit exit — same lingering-Prisma-connection-attempt reasoning as
  // scripts/verify-content-form-pipeline-phase.ts's own process.exit() call
  // (this script's createProject call hits the same dev-bypass fallback path).
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
