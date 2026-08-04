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

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request to ${url} failed`);
  return data;
}

export async function uploadProjectSourceDoc(projectId: string, docType: string, file: File): Promise<UploadSourceDocResult> {
  const urlData = await fetchJson(`/api/projects/${projectId}/source-docs/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name }),
  });

  if (urlData.mode === "signed") {
    const { createSupabaseBrowserClient } = await import("@/lib/supabase-browser");
    const supabase = createSupabaseBrowserClient();
    const { error: uploadError } = await supabase.storage.from("project-source-docs").uploadToSignedUrl(urlData.path, urlData.token, file);
    if (uploadError) throw new Error(uploadError.message || "Upload to storage failed");

    return fetchJson(`/api/projects/${projectId}/source-docs/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: urlData.path, name: file.name, fileName: file.name, docType }),
    });
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("docType", docType);
  return fetchJson(`/api/projects/${projectId}/source-docs`, { method: "POST", body: formData });
}
