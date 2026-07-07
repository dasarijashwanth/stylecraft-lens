import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { startAnalysis } from "@/lib/analysisEngine";
import { AnalysisFormSchema } from "@/lib/validations";
import { createAnalysis, getUserAnalyses } from "@/lib/db/analyses";

export async function GET(request: Request) {
  try {
    const session = await getAuthSession();
    const analyses = await getUserAnalyses(session.userId);
    return NextResponse.json({ analyses });
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

    const created = await createAnalysis(session.userId, session.orgId, projectId || undefined);
    const newAnalysisId = created.id;

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
