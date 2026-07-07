import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
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

// Only creates the analysis record and persists its form context — it does
// NOT run any AI work itself. The client drives phase-by-phase execution via
// repeated POST /api/analyses/:id/continue calls (see that route). Running
// the full 3-phase pipeline inside this single request/background task
// routinely exceeded Vercel's serverless duration limit and silently
// orphaned the analysis at phase 0 — splitting it into steps keeps every
// invocation short regardless of plan/duration cap.
export async function POST(request: Request) {
  try {
    const session = await getAuthSession();
    const body = await request.json();

    const validation = AnalysisFormSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "Validation failed", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const data = validation.data;
    const { projectId } = body; // optional link to project

    const created = await createAnalysis(session.userId, session.orgId, projectId || undefined, data);

    return NextResponse.json(
      {
        analysisId: created.id,
        status: "pending",
        phase: 0,
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
