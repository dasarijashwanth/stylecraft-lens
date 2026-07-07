import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { NewProjectSchema } from "@/lib/validations";
import { createProject, getUserProjects } from "@/lib/db/projects";

export async function GET(request: Request) {
  try {
    const session = await getAuthSession();
    const projects = await getUserProjects(session.orgId);
    return NextResponse.json({ projects });
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

    const validation = NewProjectSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "Validation failed", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const project = await createProject(session.userId, session.orgId, validation.data);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
