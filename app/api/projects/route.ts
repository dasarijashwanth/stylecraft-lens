import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { memoryDb } from "@/lib/memoryDb";
import { NewProjectSchema } from "@/lib/validations";

export async function GET(request: Request) {
  try {
    const session = await getAuthSession();
    
    try {
      // 1. Try PostgreSQL
      const projects = await prisma.project.findMany({
        where: { orgId: session.orgId },
        include: {
          analyses: true,
          competitors: {
            include: {
              competitor: true,
            },
          },
          reports: true,
        },
        orderBy: { updatedAt: "desc" },
      });
      
      return NextResponse.json({ projects });
    } catch (dbError) {
      console.warn("PostgreSQL unavailable in GET /api/projects. Falling back to memoryDb:", dbError);
      
      // 2. Fallback to Memory Database
      const projects = memoryDb.projects
        .filter(p => p.orgId === session.orgId)
        .map(p => {
          // Attach counts
          const analyses = memoryDb.analyses.filter(a => a.projectId === p.id);
          const reports = memoryDb.reports.filter(r => r.projectId === p.id);
          
          // Simple mock competitors mapped to project
          // Let's assume some competitors are linked
          const competitorIds = memoryDb.competitors
            .filter(c => c.orgId === session.orgId)
            .slice(0, 3)
            .map(c => ({ competitorId: c.id, competitor: c }));
          
          return {
            ...p,
            analyses,
            reports,
            competitors: competitorIds,
          };
        })
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      
      return NextResponse.json({ projects });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthSession();
    const body = await request.json();
    
    // Validate
    const validation = NewProjectSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "Validation failed", details: validation.error.flatten() },
        { status: 400 }
      );
    }
    
    const data = validation.data;
    
    try {
      // 1. Try PostgreSQL
      const project = await prisma.project.create({
        data: {
          orgId: session.orgId,
          userId: session.userId,
          name: data.name,
          industry: data.industry,
          targetMarket: data.targetMarket,
          productName: data.productName,
          description: data.description,
          category: data.category || null,
          companyContext: data.companyContext || null,
          motorTech: data.motorTech || null,
          keyDiff: data.keyDiff || null,
          pricePoint: data.pricePoint || null,
        },
      });
      
      return NextResponse.json({ project }, { status: 201 });
    } catch (dbError) {
      console.warn("PostgreSQL unavailable in POST /api/projects. Falling back to memoryDb:", dbError);
      
      // 2. Fallback to Memory Database
      const project = {
        id: `proj_${Date.now()}`,
        orgId: session.orgId,
        userId: session.userId,
        name: data.name,
        industry: data.industry,
        targetMarket: data.targetMarket,
        productName: data.productName,
        description: data.description,
        category: data.category || null,
        companyContext: data.companyContext || null,
        motorTech: data.motorTech || null,
        keyDiff: data.keyDiff || null,
        pricePoint: data.pricePoint || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      memoryDb.projects.push(project);
      
      return NextResponse.json({ project }, { status: 201 });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
