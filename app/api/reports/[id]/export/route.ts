import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getReport, updateReport } from "@/lib/db/reports";

// Security audit fix — this was pre-migration mock code that never checked
// isSupabaseConfigured at all (only knew about Prisma/memoryDb, neither of
// which is the real report store in this app's actual deployment). Its
// ownership check's failure path was silently absorbed (the catch block had
// no `else`), so it returned a 200 with a fake fileUrl for ANY report id —
// yours, another org's, or nonexistent — without ever actually marking a
// real report EXPORTED. Rebuilt on lib/db/reports.ts's existing
// getReport/updateReport (already dual-path Supabase/Prisma/memoryDb, and
// already ownership-scoped by user_id) so it now honestly 404s and mutates
// the REAL report row.
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getAuthSession();
    const { id } = params;

    const report = await getReport(id, session.userId, session.orgId);
    if (!report) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Report not found" }, { status: 404 });
    }

    // Simulate generation latency (e.g. Puppeteer/PDFKit compile time) —
    // this route still doesn't render a real PDF (see the mock URL below,
    // unchanged pre-existing scope), only marks the report's status.
    await new Promise(resolve => setTimeout(resolve, 1500));

    const mockPdfUrl = `/api/reports/${id}/download`; // local mock download endpoint
    await updateReport(id, session.userId, { status: "EXPORTED" }, session.orgId);

    return NextResponse.json({ fileUrl: mockPdfUrl });
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
