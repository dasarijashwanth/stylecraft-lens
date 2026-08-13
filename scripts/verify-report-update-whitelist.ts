// scripts/verify-report-update-whitelist.ts
// Security audit — regression coverage for the mass-assignment IDOR fix in
// lib/db/reports.ts's updateReport(): the client-supplied PATCH body used
// to be written straight into the update, letting a caller reassign
// analysis_id/project_id to another org's real uuid, then read that
// victim's data back via a follow-up GET's join. Offline, memoryDb-only —
// no live Supabase/AI calls.
//
// project_id was later restored to REPORT_UPDATABLE_FIELDS (it's needed by
// the real "Link Report" feature, components/project/LinkReportModal.tsx —
// removing it entirely silently broke that feature instead of actually
// closing anything, since app/api/reports/[id]/route.ts's PATCH handler
// never actually reassigned project_id blindly to begin with). The real
// authorization boundary for project_id moved to that route (it verifies
// the target project belongs to session.orgId via getProject() BEFORE ever
// calling updateReport) — this script tests the DB layer only, so it
// correctly expects project_id to pass through updateReport() now (the
// route's own ownership check isn't exercised here; read that route's code
// directly to confirm it, since spinning up a real Next.js request isn't
// this script family's style). analysis_id/user_id/org_id/id must still be
// blocked at THIS layer regardless — nothing legitimate ever reassigns them.
// Run with: npx tsx scripts/verify-report-update-whitelist.ts

import { memoryDb, MockReport } from "../lib/memoryDb";
import { updateReport } from "../lib/db/reports";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`PASS: ${message}`);
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

async function main() {
  const now = new Date();
  const report: MockReport = {
    id: "report_test_1",
    orgId: "org_attacker",
    userId: "user_attacker",
    projectId: "project_attacker_owns",
    analysisId: "analysis_attacker_owns",
    title: "Attacker's own report",
    content: {},
    status: "DRAFT",
    fileUrl: null,
    competitive_analysis: { overview_paragraph: "original" },
    createdAt: now,
    updatedAt: now,
  };
  memoryDb.reports.push(report);

  console.log("[1] A malicious payload reassigning analysis_id/user_id/org_id/id is stripped; project_id and real fields DO apply (route-layer's job to authorize project_id, not this)");
  {
    const maliciousPayload = {
      // Real, allowed field — should still go through.
      competitive_analysis: { overview_paragraph: "legitimately edited" },
      // project_id is intentionally allowed to pass through updateReport()
      // itself now — its authorization lives one layer up, in
      // app/api/reports/[id]/route.ts's PATCH handler (getProject ownership
      // check), not here. This assertion documents that this layer no
      // longer double-guards it, so a reviewer doesn't mistake this for a
      // regression.
      project_id: "some_other_project_id",
      // Attempted mass-assignment — none of these must ever reach the row.
      analysis_id: "victim_org_analysis_id",
      user_id: "someone_elses_user_id",
      org_id: "someone_elses_org_id",
      id: "a_totally_different_report_id",
    };

    const updated = await updateReport(report.id, "user_attacker", maliciousPayload, "org_attacker");

    assert(updated.competitive_analysis?.overview_paragraph === "legitimately edited", "the legitimate field (competitive_analysis) DID update");
    assert(memoryDb.reports.find(r => r.id === report.id)!.projectId === "some_other_project_id", "project_id DOES pass through at the DB layer (authorization is the caller/route's responsibility)");
    assert(memoryDb.reports.find(r => r.id === report.id)!.analysisId === "analysis_attacker_owns", "analysis_id was NOT reassigned to the attacker-supplied value");
    assert(memoryDb.reports.find(r => r.id === report.id)!.orgId === "org_attacker", "org_id on the row is unchanged (mass-assignment of org_id was ignored)");
    assert(memoryDb.reports.find(r => r.id === report.id)!.id === report.id, "the report's own id was NOT overwritten by the attacker-supplied id field");
  }

  console.log("\n[2] Every field the real UI actually sends still works (no functional regression)");
  {
    for (const field of ["title", "status", "competitive_analysis", "pricing_analysis", "go_to_market", "content_form", "project_id"]) {
      const value = field === "status" ? "EXPORTED" : field === "title" ? "New Title" : field === "project_id" ? "project_new_link_target" : { probe: field };
      const updated = await updateReport(report.id, "user_attacker", { [field]: value }, "org_attacker");
      const actual = field === "project_id" ? updated.project_id ?? updated.projectId : (updated as any)[field];
      assert(JSON.stringify(actual) === JSON.stringify(value), `real UI field "${field}" still passes through updateReport`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
