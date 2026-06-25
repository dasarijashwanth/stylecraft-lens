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
      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          analyses: { orderBy: { createdAt: "desc" } },
          competitors: {
            include: {
              competitor: true,
            },
          },
          reports: { orderBy: { createdAt: "desc" } },
        },
      });
      
      if (!project || project.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Project not found" },
          { status: 404 }
        );
      }
      
      return NextResponse.json({ project });
    } catch (dbError) {
      console.warn(`PostgreSQL unavailable in GET /api/projects/${id}. Falling back to memoryDb:`, dbError);
      
      // 2. Fallback to Memory Database
      const project = memoryDb.projects.find(p => p.id === id);
      if (!project || project.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Project not found" },
          { status: 404 }
        );
      }
      
      const analyses = memoryDb.analyses
        .filter(a => a.projectId === id)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      
      const reports = memoryDb.reports
        .filter(r => r.projectId === id)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      
      // Seed some linked competitors for the mock project detail if not present
      const competitors = memoryDb.competitors
        .filter(c => c.orgId === session.orgId)
        .slice(0, 3)
        .map(c => ({
          projectId: id,
          competitorId: c.id,
          competitor: c,
        }));
      
      return NextResponse.json({
        project: {
          ...project,
          analyses,
          reports,
          competitors,
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
    
    // Filter allowed fields
    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.industry !== undefined) updateData.industry = body.industry;
    if (body.targetMarket !== undefined) updateData.targetMarket = body.targetMarket;
    if (body.productName !== undefined) updateData.productName = body.productName;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.category !== undefined) updateData.category = body.category || null;
    if (body.companyContext !== undefined) updateData.companyContext = body.companyContext || null;
    if (body.motorTech !== undefined) updateData.motorTech = body.motorTech || null;
    if (body.keyDiff !== undefined) updateData.keyDiff = body.keyDiff || null;
    if (body.pricePoint !== undefined) updateData.pricePoint = body.pricePoint || null;
    
    try {
      // 1. Try PostgreSQL
      const project = await prisma.project.findUnique({
        where: { id }
      });
      
      if (!project || project.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Project not found" },
          { status: 404 }
        );
      }
      
      const updated = await prisma.project.update({
        where: { id },
        data: updateData
      });
      
      return NextResponse.json({ project: updated });
    } catch (dbError) {
      console.warn(`PostgreSQL unavailable in PATCH /api/projects/${id}. Falling back to memoryDb:`, dbError);
      
      // 2. Fallback to Memory Database
      const projectIndex = memoryDb.projects.findIndex(p => p.id === id);
      if (projectIndex === -1 || memoryDb.projects[projectIndex].orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Project not found" },
          { status: 404 }
        );
      }
      
      const existing = memoryDb.projects[projectIndex];
      const updated = {
        ...existing,
        ...updateData,
        updatedAt: new Date()
      };
      
      memoryDb.projects[projectIndex] = updated;
      
      return NextResponse.json({ project: updated });
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
      const project = await prisma.project.findUnique({
        where: { id }
      });
      
      if (!project || project.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Project not found" },
          { status: 404 }
        );
      }
      
      await prisma.project.delete({
        where: { id }
      });
      
      return NextResponse.json({ success: true });
    } catch (dbError) {
      console.warn(`PostgreSQL unavailable in DELETE /api/projects/${id}. Falling back to memoryDb:`, dbError);
      
      // 2. Fallback to Memory Database
      const projectIndex = memoryDb.projects.findIndex(p => p.id === id);
      if (projectIndex === -1 || memoryDb.projects[projectIndex].orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Project not found" },
          { status: 404 }
        );
      }
      
      memoryDb.projects.splice(projectIndex, 1);
      
      // Cascade delete analyses and reports associated with this project
      memoryDb.analyses = memoryDb.analyses.filter(a => a.projectId !== id);
      memoryDb.reports = memoryDb.reports.filter(r => r.projectId !== id);
      
      return NextResponse.json({ success: true });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
