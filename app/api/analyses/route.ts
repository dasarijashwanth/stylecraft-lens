import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getAuthSession } from "@/lib/auth";
import { runAnalysisInBackground } from "@/lib/analysisEngine";
import { AnalysisFormSchema } from "@/lib/validations";
import { createAnalysis, getUserAnalyses } from "@/lib/db/analyses";

// The 3-phase Gemini/Anthropic pipeline can take well over Vercel's default
// serverless timeout, especially when falling back between providers. Without
// this, Vercel freezes the instance right after the 202 response is sent,
// silently killing the background work partway through.
export const maxDuration = 60;

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

    // Keep the background analysis alive past the response using Vercel's
    // waitUntil() — without this, Vercel may freeze the instance immediately
    // once the 202 response below is sent, silently killing the analysis
    // partway through (confirmed happening in production before this fix).
    waitUntil(
      runAnalysisInBackground(context).catch(err => {
        console.error(`Background analysis error for ${newAnalysisId}:`, err);
      })
    );

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
