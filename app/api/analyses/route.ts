import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { memoryDb } from "@/lib/memoryDb";
import { startAnalysis } from "@/lib/analysisEngine";
import { AnalysisFormSchema } from "@/lib/validations";

export async function GET(request: Request) {
  try {
    const session = await getAuthSession();
    
    try {
      // 1. Try PostgreSQL
      const analyses = await prisma.analysis.findMany({
        where: { orgId: session.orgId },
        include: {
          project: true,
          competitors: true
        },
        orderBy: { createdAt: "desc" }
      });
      return NextResponse.json({ analyses });
    } catch (dbError) {
      console.warn("PostgreSQL unavailable in GET /api/analyses. Falling back to memoryDb:", dbError);
      
      // 2. Fallback to Memory Database
      const analyses = memoryDb.analyses
        .filter(a => a.orgId === session.orgId)
        .map(a => {
          const project = memoryDb.projects.find(p => p.id === a.projectId) || null;
          const competitors = memoryDb.competitorAnalyses.filter(ca => ca.analysisId === a.id);
          return {
            ...a,
            project,
            competitors
          };
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      
      return NextResponse.json({ analyses });
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
    const validation = AnalysisFormSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "Validation failed", details: validation.error.flatten() },
        { status: 400 }
      );
    }
    
    const data = validation.data;
    const { projectId } = body; // optional link to project
    
    const newAnalysisId = `an_${Date.now()}`;
    
    let dbAnalysis: any = null;
    let fallbackToMemory = false;
    
    try {
      // 1. Try PostgreSQL
      dbAnalysis = await prisma.analysis.create({
        data: {
          id: newAnalysisId,
          orgId: session.orgId,
          userId: session.userId,
          projectId: projectId || null,
          status: "PENDING",
          phase: 0,
        }
      });
    } catch (dbError) {
      console.warn("PostgreSQL unavailable in POST /api/analyses. Falling back to memoryDb:", dbError);
      fallbackToMemory = true;
      
      // 2. Fallback to Memory Database
      dbAnalysis = {
        id: newAnalysisId,
        orgId: session.orgId,
        userId: session.userId,
        projectId: projectId || null,
        status: "PENDING",
        phase: 0,
        phase1Result: null,
        phase2Result: null,
        phase3Result: null,
        errorMessage: null,
        durationMs: null,
        createdAt: new Date(),
        completedAt: null
      };
      
      memoryDb.analyses.push(dbAnalysis);
    }
    
    // Trigger background analysis execution
    const context = {
      id: newAnalysisId,
      orgId: session.orgId,
      userId: session.userId,
      projectId: projectId || null,
      industry: data.industry,
      targetMarket: data.targetMarket,
      productName: data.productName,
      description: data.description,
      category: data.category,
      companyContext: data.companyContext,
      motorTech: data.motorTech,
      keyDiff: data.keyDiff,
      pricePoint: data.pricePoint
    };
    
    await startAnalysis(context);
    
    // Return 202 Accepted (Runs asynchronously)
    return NextResponse.json(
      {
        analysisId: newAnalysisId,
        status: "PENDING",
        streamUrl: `/api/analyses/${newAnalysisId}/stream`
      },
      { status: 202 }
    );
    
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
