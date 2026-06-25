import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { memoryDb } from "@/lib/memoryDb";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getAuthSession();
    const { id: competitorId } = params;
    const body = await request.json();
    const { content } = body;
    
    if (!content || typeof content !== "string" || content.trim() === "") {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "Note content cannot be empty" },
        { status: 400 }
      );
    }
    
    try {
      // 1. Try PostgreSQL
      const competitor = await prisma.competitor.findUnique({
        where: { id: competitorId }
      });
      
      if (!competitor || competitor.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Competitor not found" },
          { status: 404 }
        );
      }
      
      const note = await prisma.note.create({
        data: {
          competitorId,
          content
        }
      });
      
      return NextResponse.json({ note }, { status: 201 });
    } catch (dbError) {
      console.warn("PostgreSQL unavailable in POST /api/competitors/[id]/notes. Falling back to memoryDb:", dbError);
      
      // 2. Fallback to Memory Database
      const competitor = memoryDb.competitors.find(c => c.id === competitorId);
      if (!competitor || competitor.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Competitor not found" },
          { status: 404 }
        );
      }
      
      const newNote = {
        id: `note_${Date.now()}`,
        competitorId,
        content,
        createdAt: new Date(),
      };
      
      memoryDb.notes.push(newNote);
      
      return NextResponse.json({ note: newNote }, { status: 201 });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
