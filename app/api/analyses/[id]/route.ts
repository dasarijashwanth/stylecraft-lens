import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis, deleteAnalysis } from "@/lib/db/analyses";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getAuthSession();
    const { id } = params;

    const analysis = await getAnalysis(id);
    if (!analysis) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Analysis not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ analysis });
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

    const analysis = await getAnalysis(id);
    if (!analysis) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Analysis not found" },
        { status: 404 }
      );
    }

    await deleteAnalysis(id, session.userId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
