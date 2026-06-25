import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { memoryDb } from "@/lib/memoryDb";

export async function GET(request: Request) {
  try {
    const session = await getAuthSession();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "ALL";
    const search = searchParams.get("search") || "";
    
    try {
      // 1. Try PostgreSQL
      let whereClause: any = { orgId: session.orgId };
      if (status && status !== "ALL") {
        whereClause.status = status;
      }
      if (search) {
        whereClause.title = { contains: search, mode: "insensitive" };
      }
      
      const reports = await prisma.report.findMany({
        where: whereClause,
        include: {
          project: true,
        },
        orderBy: { updatedAt: "desc" },
      });
      return NextResponse.json({ reports });
    } catch (dbError) {
      console.warn("PostgreSQL unavailable in GET /api/reports. Falling back to memoryDb:", dbError);
      
      // 2. Fallback to Memory Database
      let reports = memoryDb.reports.filter(r => r.orgId === session.orgId);
      
      if (status && status !== "ALL") {
        reports = reports.filter(r => r.status === status);
      }
      if (search) {
        reports = reports.filter(r => r.title.toLowerCase().includes(search.toLowerCase()));
      }
      
      const enrichedReports = reports.map(r => {
        const project = memoryDb.projects.find(p => p.id === r.projectId) || null;
        return {
          ...r,
          project,
        };
      }).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      
      return NextResponse.json({ reports: enrichedReports });
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
    const { title, projectId, analysisId, content } = body;
    
    if (!title || typeof title !== "string" || title.trim() === "") {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "Report title is required" },
        { status: 400 }
      );
    }

    // Default TipTap JSON document skeleton
    let documentContent = content || {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: title }]
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Start writing your strategic report here..." }]
        }
      ]
    };

    // If analysisId is provided, pre-populate the report with the analysis synthesis results
    if (analysisId && !content) {
      let analysis: any = null;
      try {
        analysis = await prisma.analysis.findUnique({ where: { id: analysisId } });
      } catch (e) {
        analysis = memoryDb.analyses.find(a => a.id === analysisId);
      }

      if (analysis && analysis.phase3Result) {
        const synth = analysis.phase3Result as any;
        const execSummary = synth.executive_summary || "";
        const positioning = synth.market_position || "";
        const opps = synth.opportunities || [];
        const threats = synth.threats || [];
        const recs = synth.recommendations || [];

        // Build a structured TipTap document
        const documentElements: any[] = [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: title }]
          },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Executive Summary" }]
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: execSummary }]
          },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Market Positioning" }]
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: positioning }]
          },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Key Market Opportunities" }]
          },
          {
            type: "bulletList",
            content: opps.map((o: string) => ({
              type: "listItem",
              content: [{
                type: "paragraph",
                content: [{ type: "text", text: o }]
              }]
            }))
          },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Identified Threat Vectors" }]
          },
          {
            type: "bulletList",
            content: threats.map((t: string) => ({
              type: "listItem",
              content: [{
                type: "paragraph",
                content: [{ type: "text", text: t }]
              }]
            }))
          },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Strategic Recommendations" }]
          }
        ];

        recs.forEach((r: any) => {
          documentElements.push(
            {
              type: "heading",
              attrs: { level: 3 },
              content: [{ type: "text", text: `${r.title} (${r.priority.toUpperCase()} PRIORITY)` }]
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: r.detail }]
            }
          );
        });

        documentContent = {
          type: "doc",
          content: documentElements
        };
      }
    }
    
    try {
      // 1. Try PostgreSQL
      const report = await prisma.report.create({
        data: {
          orgId: session.orgId,
          projectId: projectId || null,
          title,
          content: documentContent,
          status: "DRAFT",
        }
      });
      return NextResponse.json({ report }, { status: 201 });
    } catch (dbError) {
      console.warn("PostgreSQL unavailable in POST /api/reports. Falling back to memoryDb:", dbError);
      
      // 2. Fallback to Memory Database
      const newReportId = `rep_${Date.now()}`;
      const report = {
        id: newReportId,
        orgId: session.orgId,
        projectId: projectId || null,
        title,
        content: documentContent,
        status: "DRAFT" as const,
        fileUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      memoryDb.reports.push(report);
      return NextResponse.json({ report }, { status: 201 });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
