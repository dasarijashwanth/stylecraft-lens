import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { memoryDb } from "@/lib/memoryDb";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getAuthSession();
    const { id } = params;
    
    // Simulate generation latency (e.g. Puppeteer/PDFKit compile time)
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const mockPdfUrl = `/api/reports/${id}/download`; // local mock download endpoint
    
    try {
      // 1. Try PostgreSQL
      const report = await prisma.report.findUnique({ where: { id } });
      if (!report || report.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Report not found" },
          { status: 404 }
        );
      }
      
      await prisma.report.update({
        where: { id },
        data: {
          status: "EXPORTED",
          fileUrl: mockPdfUrl
        }
      });
      
    } catch (e) {
      // 2. Fallback to Memory Database
      const reportIndex = memoryDb.reports.findIndex(r => r.id === id);
      if (reportIndex !== -1 && memoryDb.reports[reportIndex].orgId === session.orgId) {
        memoryDb.reports[reportIndex].status = "EXPORTED";
        memoryDb.reports[reportIndex].fileUrl = mockPdfUrl;
      }
    }
    
    return NextResponse.json({ fileUrl: mockPdfUrl });
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
