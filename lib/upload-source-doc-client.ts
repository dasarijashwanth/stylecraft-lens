// lib/upload-source-doc-client.ts
// Shared client-side upload flow for Uploaded TDS Ingestion — used by both
// the project creation form (optional TDS upload) and the project page's
// Sources tab (upload/replace by doc type). Mirrors the exact signed-URL-
// with-direct-fallback pattern already established for GTM workbook
// templates/deck templates, just project-scoped instead of admin-only.
export interface UploadSourceDocResult {
  document: any;
  factsFound: number;
  sampleFacts: { field_id: string; value: string; source_location: string | null }[];
  carriedForwardCount: number;
}

// A hard Vercel function kill (the route ran past its own maxDuration) or
// any other infra-level failure returns a plain-text/HTML platform error
// page, not this route's own JSON — a raw res.json() call crashes on that
// with a confusing "Unexpected token '<', \"<!DOCTYPE \"... is not valid
// JSON" surfaced straight to the user (confirmed live: every TDS upload
// that needed the OCR fallback hit exactly this). Read the body as text
// first and parse it ourselves so a non-JSON response degrades to an
// honest, readable message instead — same pattern as
// components/analyze/ProgressPanel.tsx's fetchJson().
async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(res.ok ? "Unexpected response from server" : "Server took too long to respond — try a smaller file or try again");
  }
  if (!res.ok) throw new Error(data.error || `Request to ${url} failed`);
  return data;
}

// Fact extraction is now a SEPARATE request from the upload/finalize call
// (see lib/tds-doc-ingest.ts's deriveFactsForDoc header comment) — content
// extraction's own OCR vision call can alone take up to ~57s worst-case, so
// stacking a second AI call (structured fact extraction) in the SAME
// request risked exceeding Vercel's 60s hard cap. Called automatically
// right after a successful upload so the RETURNED shape/behavior for every
// caller of uploadProjectSourceDoc is unchanged — best-effort: if this call
// fails/times out, the document itself is still saved and viewable, it
// just comes back with factsFound: 0 rather than the whole upload failing.
async function deriveFacts(projectId: string, documentId: string): Promise<{ factsFound: number; sampleFacts: { field_id: string; value: string; source_location: string | null }[] }> {
  try {
    return await fetchJson(`/api/projects/${projectId}/source-docs/${documentId}/facts`, { method: "POST" });
  } catch (err) {
    console.warn("Fact extraction failed (document itself is already saved):", err);
    return { factsFound: 0, sampleFacts: [] };
  }
}

export async function uploadProjectSourceDoc(projectId: string, docType: string, file: File): Promise<UploadSourceDocResult> {
  const urlData = await fetchJson(`/api/projects/${projectId}/source-docs/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name }),
  });

  let uploadResult: UploadSourceDocResult;
  if (urlData.mode === "signed") {
    const { createSupabaseBrowserClient } = await import("@/lib/supabase-browser");
    const supabase = createSupabaseBrowserClient();
    const { error: uploadError } = await supabase.storage.from("project-source-docs").uploadToSignedUrl(urlData.path, urlData.token, file);
    if (uploadError) throw new Error(uploadError.message || "Upload to storage failed");

    uploadResult = await fetchJson(`/api/projects/${projectId}/source-docs/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: urlData.path, name: file.name, fileName: file.name, docType }),
    });
  } else {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("docType", docType);
    uploadResult = await fetchJson(`/api/projects/${projectId}/source-docs`, { method: "POST", body: formData });
  }

  const { factsFound, sampleFacts } = await deriveFacts(projectId, uploadResult.document.id);
  return { ...uploadResult, factsFound, sampleFacts };
}
