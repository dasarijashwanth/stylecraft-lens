import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { listVersionsForProjectDocType } from "@/lib/db/uploaded-source-docs";
import { ingestSourceDocUpload, ALLOWED_SOURCE_DOC_TYPES } from "@/lib/tds-doc-ingest";

export const maxDuration = 60;

// Every version, across all 4 doc types, for the project's Sources tab —
// grouped by doc_type client-side.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const project = await getProject(params.id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const results = await Promise.all(ALLOWED_SOURCE_DOC_TYPES.map(docType => listVersionsForProjectDocType(params.id, docType)));
    const docs = results.flat();
    return NextResponse.json({ docs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load source documents" }, { status: 500 });
  }
}

// Direct-upload path for local dev without Supabase configured (no real
// body-size limit there) — see .../upload-url + .../finalize for the
// signed-URL flow real deployments use instead.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const routeStartTime = Date.now();
  try {
    const session = await getAuthSession();
    const project = await getProject(params.id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const docType = formData.get("docType") as string;
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (!ALLOWED_SOURCE_DOC_TYPES.includes(docType as any)) {
      return NextResponse.json({ error: "Invalid doc type" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await ingestSourceDocUpload({
      projectId: params.id,
      docType: docType as any,
      filePath: `local-${Date.now()}`,
      fileName: file.name,
      buffer,
      mimeType: file.type || "application/octet-stream",
      productName: project.productName,
      uploadedBy: session.email,
      routeStartTime,
    });

    return NextResponse.json({
      document: result.document,
      factsFound: result.factsFound,
      sampleFacts: result.sampleFacts,
      carriedForwardCount: result.carriedForwardCount,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to upload source document" }, { status: err.status || 500 });
  }
}
