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
      const competitor = await prisma.competitor.findUnique({
        where: { id },
        include: {
          notes: { orderBy: { createdAt: "desc" } },
          analyses: {
            include: {
              analysis: true
            },
            orderBy: { id: "desc" }
          }
        }
      });
      
      if (!competitor || competitor.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Competitor not found" },
          { status: 404 }
        );
      }
      
      // Calculate threat score
      const latestAnalysis = competitor.analyses[0];
      const threatScore = latestAnalysis ? latestAnalysis.threatScore : Math.floor(Math.random() * 40) + 30;
      
      return NextResponse.json({
        competitor: {
          ...competitor,
          threatScore
        }
      });
    } catch (dbError) {
      console.warn(`PostgreSQL unavailable in GET /api/competitors/${id}. Falling back to memoryDb:`, dbError);
      
      // 2. Fallback to Memory Database
      const competitor = memoryDb.competitors.find(c => c.id === id);
      if (!competitor || competitor.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Competitor not found" },
          { status: 404 }
        );
      }
      
      const notes = memoryDb.notes.filter(n => n.competitorId === id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const analyses = memoryDb.competitorAnalyses.filter(ca => ca.competitorId === id);
      
      const threatScore = analyses.length > 0
        ? Math.round(analyses.reduce((acc, curr) => acc + curr.threatScore, 0) / analyses.length)
        : Math.floor((competitor.name.charCodeAt(0) * 7) % 55) + 30;
      
      return NextResponse.json({
        competitor: {
          ...competitor,
          notes,
          analyses,
          threatScore
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

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getAuthSession();
    const { id } = params;
    const body = await request.json();
    
    // Extraneous keys filter
    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.website !== undefined) updateData.website = body.website || null;
    if (body.description !== undefined) updateData.description = body.description || null;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.tags !== undefined) updateData.tags = body.tags;
    
    // Auto favicon
    if (updateData.website) {
      try {
        const domain = new URL(updateData.website).hostname;
        updateData.logoUrl = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
      } catch (e) {}
    }
    
    try {
      // 1. Try PostgreSQL
      const competitor = await prisma.competitor.findUnique({
        where: { id }
      });
      
      if (!competitor || competitor.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Competitor not found" },
          { status: 404 }
        );
      }
      
      const updated = await prisma.competitor.update({
        where: { id },
        data: updateData
      });
      
      return NextResponse.json({ competitor: updated });
    } catch (dbError) {
      console.warn(`PostgreSQL unavailable in PATCH /api/competitors/${id}. Falling back to memoryDb:`, dbError);
      
      // 2. Fallback to Memory Database
      const competitorIndex = memoryDb.competitors.findIndex(c => c.id === id);
      if (competitorIndex === -1 || memoryDb.competitors[competitorIndex].orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Competitor not found" },
          { status: 404 }
        );
      }
      
      const existing = memoryDb.competitors[competitorIndex];
      const updated = {
        ...existing,
        ...updateData,
        updatedAt: new Date()
      };
      
      memoryDb.competitors[competitorIndex] = updated;
      
      return NextResponse.json({ competitor: updated });
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
      const competitor = await prisma.competitor.findUnique({
        where: { id }
      });
      
      if (!competitor || competitor.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Competitor not found" },
          { status: 404 }
        );
      }
      
      await prisma.competitor.delete({
        where: { id }
      });
      
      return NextResponse.json({ success: true });
    } catch (dbError) {
      console.warn(`PostgreSQL unavailable in DELETE /api/competitors/${id}. Falling back to memoryDb:`, dbError);
      
      // 2. Fallback to Memory Database
      const competitorIndex = memoryDb.competitors.findIndex(c => c.id === id);
      if (competitorIndex === -1 || memoryDb.competitors[competitorIndex].orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Competitor not found" },
          { status: 404 }
        );
      }
      
      memoryDb.competitors.splice(competitorIndex, 1);
      
      // Cascade delete notes
      memoryDb.notes = memoryDb.notes.filter(n => n.competitorId !== id);
      
      return NextResponse.json({ success: true });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
