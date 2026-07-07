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
      const analysis = await prisma.analysis.findUnique({
        where: { id },
        include: {
          project: true,
          competitors: {
            include: {
              competitor: true
            }
          }
        }
      });
      
      if (!analysis || analysis.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Analysis not found" },
          { status: 404 }
        );
      }
      
      return NextResponse.json({ analysis });
    } catch (dbError) {
      console.warn(`PostgreSQL unavailable in GET /api/analyses/${id}. Falling back to memoryDb:`, dbError);
      
      // 2. Fallback to Memory Database
      const analysis = memoryDb.analyses.find(a => a.id === id);
      
      if (!analysis || analysis.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Analysis not found" },
          { status: 404 }
        );
      }
      
      const project = memoryDb.projects.find(p => p.id === analysis.projectId) || null;
      
      const competitorAnalyses = memoryDb.competitorAnalyses.filter(ca => ca.analysisId === id);
      const competitors = competitorAnalyses.map(ca => {
        const competitor = memoryDb.competitors.find(comp => comp.id === ca.competitorId) || null;
        return {
          ...ca,
          competitor
        };
      });
      
      return NextResponse.json({
        analysis: {
          ...analysis,
          project,
          competitors
        }
      });
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
      const analysis = await prisma.analysis.findUnique({ where: { id } });
      if (!analysis || analysis.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Analysis not found" },
          { status: 404 }
        );
      }
      await prisma.analysis.delete({ where: { id } });
      return NextResponse.json({ success: true });
    } catch (dbError) {
      console.warn(`PostgreSQL unavailable in DELETE /api/analyses/${id}. Falling back to memoryDb:`, dbError);

      const index = memoryDb.analyses.findIndex(a => a.id === id);
      if (index === -1 || memoryDb.analyses[index].orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Analysis not found" },
          { status: 404 }
        );
      }
      memoryDb.analyses.splice(index, 1);
      memoryDb.competitorAnalyses = memoryDb.competitorAnalyses.filter(ca => ca.analysisId !== id);

      return NextResponse.json({ success: true });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
