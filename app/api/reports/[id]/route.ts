import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { memoryDb } from "@/lib/memoryDb";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getAuthSession();
    const { id } = params;
    
    try {
      // 1. Try PostgreSQL
      const report = await prisma.report.findUnique({
        where: { id },
        include: {
          project: true,
        },
      });
      
      if (!report || report.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Report not found" },
          { status: 404 }
        );
      }
      
      return NextResponse.json({ report });
    } catch (dbError) {
      console.warn(`PostgreSQL unavailable in GET /api/reports/${id}. Falling back to memoryDb:`, dbError);
      
      // 2. Fallback to Memory Database
      const report = memoryDb.reports.find(r => r.id === id);
      if (!report || report.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Report not found" },
          { status: 404 }
        );
      }
      
      const project = memoryDb.projects.find(p => p.id === report.projectId) || null;
      
      return NextResponse.json({
        report: {
          ...report,
          project,
        },
      });
    }
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
    
    const updateData: any = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.content !== undefined) updateData.content = body.content;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.fileUrl !== undefined) updateData.fileUrl = body.fileUrl || null;
    
    try {
      // 1. Try PostgreSQL
      const report = await prisma.report.findUnique({
        where: { id }
      });
      
      if (!report || report.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Report not found" },
          { status: 404 }
        );
      }
      
      const updated = await prisma.report.update({
        where: { id },
        data: updateData
      });
      
      return NextResponse.json({ report: updated });
    } catch (dbError) {
      console.warn(`PostgreSQL unavailable in PATCH /api/reports/${id}. Falling back to memoryDb:`, dbError);
      
      // 2. Fallback to Memory Database
      const reportIndex = memoryDb.reports.findIndex(r => r.id === id);
      if (reportIndex === -1 || memoryDb.reports[reportIndex].orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Report not found" },
          { status: 404 }
        );
      }
      
      const existing = memoryDb.reports[reportIndex];
      const updated = {
        ...existing,
        ...updateData,
        updatedAt: new Date()
      };
      
      memoryDb.reports[reportIndex] = updated;
      
      return NextResponse.json({ report: updated });
    }
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
    
    try {
      // 1. Try PostgreSQL
      const report = await prisma.report.findUnique({
        where: { id }
      });
      
      if (!report || report.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Report not found" },
          { status: 404 }
        );
      }
      
      await prisma.report.delete({
        where: { id }
      });
      
      return NextResponse.json({ success: true });
    } catch (dbError) {
      console.warn(`PostgreSQL unavailable in DELETE /api/reports/${id}. Falling back to memoryDb:`, dbError);
      
      // 2. Fallback to Memory Database
      const reportIndex = memoryDb.reports.findIndex(r => r.id === id);
      if (reportIndex === -1 || memoryDb.reports[reportIndex].orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Report not found" },
          { status: 404 }
        );
      }
      
      memoryDb.reports.splice(reportIndex, 1);
      
      return NextResponse.json({ success: true });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
