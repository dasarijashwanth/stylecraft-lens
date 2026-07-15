// app/api/reports/route.ts
import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis } from "@/lib/db/analyses";
import { createReportFromAnalysis, getUserReports } from "@/lib/db/reports";

export async function GET(request: Request) {
  try {
    const session = await getAuthSession();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "ALL";

    let reports: any[] = await getUserReports(session.userId);

    // Apply filtering on the server if search/status are provided
    if (status && status !== "ALL") {
      reports = reports.filter((r: any) => r.status === status.toLowerCase());
    }
    if (search) {
      reports = reports.filter((r: any) => 
        r.title.toLowerCase().includes(search.toLowerCase())
      );
    }

    return NextResponse.json({ reports });
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
    const { projectId, analysisId, productName, industry, targetMarket, pricePoint } = body;

    if (!analysisId) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "Analysis ID is required to compile a report" },
        { status: 400 }
      );
    }

    // Fetch the analysis
    const analysisData = await getAnalysis(analysisId);
    if (!analysisData) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Analysis not found" },
        { status: 404 }
      );
    }

    // Call database compiler
    const report = await createReportFromAnalysis(
      session.userId,
      analysisId,
      projectId || analysisData.project_id || null,
      {
        phase1: analysisData.phase1_result,
        phase2: analysisData.phase2_result,
        phase3: analysisData.phase3_result,
        productName: productName || analysisData.projects?.product_name || "Product Analysis",
        industry: industry || analysisData.projects?.industry,
        targetMarket,
        pricePoint,
        identity: analysisData.phase0_result || undefined,
      },
      session.orgId
    );

    return NextResponse.json({ report }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
