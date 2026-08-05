import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { supabaseAdmin } from "@/lib/supabase";
import { ingestSourceDocUpload, ALLOWED_SOURCE_DOC_TYPES } from "@/lib/tds-doc-ingest";
import { logCall } from "@/lib/obs";

export const maxDuration = 60;

const STORAGE_BUCKET = "project-source-docs";
// Matches exactly the shape .../upload-url/route.ts generates
// (`${projectId}/${Date.now()}-${sanitized filename}`) — rejects anything
// else, including a path containing "..", before ever calling storage.download.
const SOURCE_DOC_PATH_RE = /^[a-zA-Z0-9_-]+\/\d+-[a-zA-Z0-9._-]+$/;

// Completes the signed-upload-URL flow (see .../upload-url/route.ts) — the
// browser has already PUT the raw bytes straight into Storage; this
// downloads them back server-side to validate, extract, and register the
// document.
// Bounds the Storage download itself — previously completely unbounded,
// unlike every other step in this pipeline (content extraction has its own
// withDeadline via lib/tds-doc-ingest.ts). A slow/degraded download for a
// large file had no ceiling at all: if Supabase Storage itself was slow to
// serve the object, this single line could quietly consume most of the
// route's entire 60s budget with zero visibility, indistinguishable from
// the extraction-side timeouts already fixed. Rejects instead of falling
// back to a placeholder value (unlike lib/tds-doc-ingest.ts's withDeadline)
// since there's no sensible "fallback buffer" — a failed/slow download
// should surface as an honest, specific error, not proceed with no file.
const STORAGE_DOWNLOAD_TIMEOUT_MS = 20_000;
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(Object.assign(new Error(message), { status: 504 })), ms)),
  ]);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // Captured before auth/download/anything else — lib/tds-doc-ingest.ts's
  // shared wall-clock deadline is measured from here, not from whenever
  // ingestSourceDocUpload happens to start, so a slow Storage download for
  // a large file is correctly counted against the same budget instead of
  // being invisible overhead that could push the total past Vercel's 60s cap.
  const routeStartTime = Date.now();
  try {
    const session = await getAuthSession();
    const project = await getProject(params.id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { path, name, fileName, docType } = await req.json();
    if (!path || !SOURCE_DOC_PATH_RE.test(path) || !path.startsWith(`${params.id}/`)) {
      return NextResponse.json({ error: "Invalid storage path" }, { status: 400 });
    }
    if (!ALLOWED_SOURCE_DOC_TYPES.includes(docType)) {
      return NextResponse.json({ error: "Invalid doc type" }, { status: 400 });
    }

    const downloadStart = Date.now();
    // Time spent on auth/project-lookup/request-parsing BEFORE the download
    // even starts — logged separately so a future recurrence can show
    // whether THIS stage (not download, not extraction) is where time goes,
    // rather than assuming it's always one of the two already-hardened spots.
    logCall("source-doc-upload", { op: "pre-download", projectId: params.id, docType, outcome: "ok", elapsedMs: downloadStart - routeStartTime });
    const { data, error } = await withTimeout(
      supabaseAdmin.storage.from(STORAGE_BUCKET).download(path),
      STORAGE_DOWNLOAD_TIMEOUT_MS,
      "Storage download took too long — try again"
    );
    logCall("source-doc-upload", { op: "download", projectId: params.id, docType, outcome: error ? "error" : "ok", errorMessage: error?.message, elapsedMs: Date.now() - downloadStart });
    if (error) {
      logCall("source-doc-upload", { op: "finalize", projectId: params.id, docType, outcome: "error", errorMessage: error.message, elapsedMs: Date.now() - routeStartTime });
      throw error;
    }
    const buffer = Buffer.from(await data.arrayBuffer());

    const result = await ingestSourceDocUpload({
      projectId: params.id,
      docType,
      filePath: path,
      fileName: fileName || name || "source-doc",
      buffer,
      mimeType: data.type || "application/octet-stream",
      productName: project.productName,
      uploadedBy: session.email,
      routeStartTime,
    });

    logCall("source-doc-upload", { op: "finalize", projectId: params.id, docType, fileSizeBytes: buffer.length, outcome: "ok", elapsedMs: Date.now() - routeStartTime });
    return NextResponse.json({
      document: result.document,
      factsFound: result.factsFound,
      sampleFacts: result.sampleFacts,
      carriedForwardCount: result.carriedForwardCount,
    });
  } catch (err: any) {
    // A reference id (not a secret, just a correlation handle) lets a user
    // report "ref abc123" and the exact logCall line above be found
    // instantly in server logs — never expose the raw error internals for
    // an unexpected (non-validation) failure, only this id.
    const referenceId = Math.random().toString(36).slice(2, 10);
    // 504 (this route's own storage-download timeout, thrown deliberately
    // above with a specific, safe, actionable message) is grouped with the
    // 4xx validation errors here — it's not an unexpected crash whose raw
    // message might leak internals, it's a deliberate, honest "this step
    // took too long" message that should reach the user as-is.
    const isValidationError = typeof err.status === "number" && (err.status < 500 || err.status === 504);
    if (!isValidationError) {
      logCall("source-doc-upload", { op: "finalize", projectId: params.id, outcome: "error", errorMessage: err.message, errorClass: err.name, referenceId, elapsedMs: Date.now() - routeStartTime });
    }
    const message = isValidationError ? (err.message || "Failed to finalize source document upload") : `Upload failed on our side — support has been notified (ref ${referenceId})`;
    return NextResponse.json({ error: message }, { status: err.status || 500 });
  }
}
