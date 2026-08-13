// app/api/reports/[id]/route.ts
import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getReport, updateReport } from "@/lib/db/reports";
import { getProject } from "@/lib/db/projects";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { prisma } from "@/lib/db";
import { memoryDb } from "@/lib/memoryDb";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getAuthSession();
    const { id } = params;

    const report = await getReport(id, session.userId, session.orgId);
    if (!report) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Report not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ report });
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getAuthSession();
    const { id } = params;
    const body = await request.json();

    // project_id is one of the few fields updateReport's own allowlist
    // (REPORT_UPDATABLE_FIELDS) permits — but only reachable safely because
    // THIS route verifies the target project actually belongs to the
    // caller's org first (the "any new project-scoped route must verify
    // ownership itself" convention this codebase already follows
    // elsewhere). Without this check, restoring project_id to the allowlist
    // would reopen the exact cross-tenant IDOR it was removed to close;
    // without the check we'd be back to a "Link report to project" feature
    // that silently no-ops (project_id stripped, nothing actually happens).
    if (body && typeof body.project_id === "string" && body.project_id) {
      const targetProject = await getProject(body.project_id, session.orgId);
      if (!targetProject) {
        return NextResponse.json({ error: "NOT_FOUND", message: "Project not found" }, { status: 404 });
      }
    }

    const report = await updateReport(id, session.userId, body, session.orgId);
    return NextResponse.json({ report });
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getAuthSession();
    const { id } = params;

    if (isSupabaseConfigured) {
      const { error } = await supabaseAdmin
        .from("reports")
        .delete()
        .eq("id", id)
        .eq("user_id", session.userId);

      if (error) throw error;
      return NextResponse.json({ success: true });
    } else {
      // Local DB/memoryDb Fallback — deleteMany's where clause (rather than
      // delete's, which can only match by unique id) lets orgId be checked
      // as part of the same query; count === 0 means either the report
      // doesn't exist or belongs to another org, so both are reported as
      // NOT_FOUND rather than leaking which case it was.
      try {
        const { count } = await prisma.report.deleteMany({
          where: { id, orgId: session.orgId },
        });
        if (count === 0) {
          return NextResponse.json({ error: "NOT_FOUND", message: "Report not found" }, { status: 404 });
        }
        return NextResponse.json({ success: true });
      } catch (dbError) {
        console.warn(`PostgreSQL/Prisma unavailable in DELETE /api/reports/${id}. Falling back to memoryDb:`, dbError);
        const reportIndex = memoryDb.reports.findIndex(r => r.id === id && r.userId === session.userId);
        if (reportIndex === -1) {
          return NextResponse.json(
            { error: "NOT_FOUND", message: "Report not found" },
            { status: 404 }
          );
        }
        memoryDb.reports.splice(reportIndex, 1);
        return NextResponse.json({ success: true });
      }
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
