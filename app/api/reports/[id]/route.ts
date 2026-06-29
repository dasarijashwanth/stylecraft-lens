// app/api/reports/[id]/route.ts
import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getReport, updateReport } from "@/lib/db/reports";
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

    const report = await getReport(id, session.userId);
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

    const report = await updateReport(id, session.userId, body);
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
      // Local DB/memoryDb Fallback
      try {
        await prisma.report.delete({
          where: { id }
        });
        return NextResponse.json({ success: true });
      } catch (dbError) {
        console.warn(`PostgreSQL/Prisma unavailable in DELETE /api/reports/${id}. Falling back to memoryDb:`, dbError);
        const reportIndex = memoryDb.reports.findIndex(r => r.id === id);
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
