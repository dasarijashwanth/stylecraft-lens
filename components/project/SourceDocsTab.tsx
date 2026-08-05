"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Upload, Loader2, ChevronDown, ChevronRight, Pencil, Check, History, X, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { uploadProjectSourceDoc } from "@/lib/upload-source-doc-client";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface SourceDocRow {
  id: string;
  project_id: string;
  doc_type: "tds" | "spec_sheet" | "sales_kit" | "other";
  file_name: string | null;
  file_size_bytes: number | null;
  version: number;
  is_active: boolean;
  extraction_status: "pending" | "complete" | "failed";
  uploaded_at: string;
}

interface ExtractedFactRow {
  id: string;
  field_id: string;
  value: string;
  raw_text: string | null;
  source_location: string | null;
  confirmed_by_user: boolean;
}

interface Props {
  projectId: string;
}

const DOC_TYPES: { key: SourceDocRow["doc_type"]; label: string; hint: string }[] = [
  { key: "tds", label: "Product TDS", hint: "Recommended for pre-launch products — the official Technical Data Sheet." },
  { key: "spec_sheet", label: "Spec Sheet", hint: "A standalone spec sheet, if separate from the TDS." },
  { key: "sales_kit", label: "Sales Kit", hint: "An existing sales kit or product one-pager." },
  { key: "other", label: "Other", hint: "Any other reference document worth grounding generation in." },
];

// Duplicated locally rather than imported from lib/tds-doc-ingest.ts — that
// module pulls in lib/tds-doc-extract.ts's server-only extraction
// dependencies (pdf-parse, the OpenAI/Gemini SDKs), which must never end up
// in a "use client" bundle. Kept in sync by hand, same "small helper
// duplicated per file" precedent this codebase already uses elsewhere.
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".xlsm", ".csv"];
const ACCEPTED_TYPES_LABEL = "PDF, DOC/DOCX, XLS/XLSX, or CSV";

interface SlotUploadState {
  status: "idle" | "uploading" | "error";
  progress: number; // 0-1
  error?: string;
  pendingFile?: File; // preserved so Retry doesn't require re-selecting the file
}

const IDLE_STATE: SlotUploadState = { status: "idle", progress: 0 };

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatUploadedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
    " at " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function fileExtensionOf(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx).toLowerCase() : "";
}

// Same defensive parsing as lib/upload-source-doc-client.ts's own
// fetchJson — a raw res.json() crashes with a cryptic "Unexpected token
// '<'" when the server returns an HTML error/platform page instead of JSON.
async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(res.ok ? "Unexpected response from server" : "Server took too long to respond — try again");
  }
  if (!res.ok) throw new Error(data.error || `Request to ${url} failed`);
  return data;
}

export function SourceDocsTab({ projectId }: Props) {
  const [docs, setDocs] = useState<SourceDocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadState, setUploadState] = useState<Record<string, SlotUploadState>>({});
  const [dragOverType, setDragOverType] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ docId: string; docType: string; label: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [facts, setFacts] = useState<Record<string, ExtractedFactRow[]>>({});
  const [editingFactId, setEditingFactId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function load() {
    setLoading(true);
    try {
      const data = await fetchJson(`/api/projects/${projectId}/source-docs`);
      setDocs(data.docs || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load source documents");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (projectId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function loadFacts(docId: string) {
    try {
      const data = await fetchJson(`/api/projects/${projectId}/source-docs/${docId}/facts`);
      setFacts(prev => ({ ...prev, [docId]: data.facts || [] }));
    } catch (err: any) {
      toast.error(err.message || "Failed to load extracted facts");
    }
  }

  function toggleExpand(docId: string) {
    if (expandedDocId === docId) {
      setExpandedDocId(null);
      return;
    }
    setExpandedDocId(docId);
    if (!facts[docId]) loadFacts(docId);
  }

  // Validates client-side BEFORE any network call — instant, friendly
  // rejection for the two most common mistakes (wrong type, too large)
  // rather than a round-trip just to find out. Server-side (upload-url +
  // finalize) independently re-validates both — this is a UX nicety, not
  // the actual security boundary.
  function validateFile(file: File): string | null {
    const ext = fileExtensionOf(file.name);
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return `File type ${ext || "(unknown)"} not accepted — upload ${ACCEPTED_TYPES_LABEL}`;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const actualMb = (file.size / 1024 / 1024).toFixed(1);
      const maxMb = MAX_FILE_SIZE_BYTES / 1024 / 1024;
      return `File is ${actualMb} MB — max is ${maxMb} MB`;
    }
    return null;
  }

  async function handleUpload(docType: string, file: File) {
    const validationError = validateFile(file);
    if (validationError) {
      setUploadState(prev => ({ ...prev, [docType]: { status: "error", progress: 0, error: validationError, pendingFile: file } }));
      toast.error(validationError);
      return;
    }

    setUploadState(prev => ({ ...prev, [docType]: { status: "uploading", progress: 0 } }));
    try {
      const result = await uploadProjectSourceDoc(projectId, docType, file, (fraction) => {
        setUploadState(prev => (prev[docType]?.status === "uploading" ? { ...prev, [docType]: { ...prev[docType], progress: fraction } } : prev));
      });
      const carried = result.carriedForwardCount > 0 ? ` (${result.carriedForwardCount} of your prior corrections carried forward)` : "";
      toast.success(
        result.factsFound > 0
          ? `Uploaded — found ${result.factsFound} fact${result.factsFound === 1 ? "" : "s"}${carried}`
          : `Uploaded${carried || " — no structured facts recognized yet, review below"}`
      );
      setUploadState(prev => ({ ...prev, [docType]: IDLE_STATE }));
      await load();
      setExpandedDocId(result.document.id);
      await loadFacts(result.document.id);
    } catch (err: any) {
      // Distinguishes a network-level failure (fetch/XHR itself never
      // completed) from an honest server-side rejection/error, matching
      // the spec's own two distinct message templates — putToSignedUrl
      // and fetchJson both already throw exactly these two message shapes.
      const message = err.message || "Upload failed — try again";
      setUploadState(prev => ({ ...prev, [docType]: { status: "error", progress: 0, error: message, pendingFile: file } }));
      toast.error(message);
    } finally {
      const input = fileInputRefs.current[docType];
      if (input) input.value = "";
    }
  }

  function handleRetry(docType: string) {
    const pending = uploadState[docType]?.pendingFile;
    if (pending) handleUpload(docType, pending);
  }

  function handleDismissError(docType: string) {
    setUploadState(prev => ({ ...prev, [docType]: IDLE_STATE }));
  }

  function handleDragOver(e: React.DragEvent, docType: string) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverType(docType);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverType(null);
  }

  function handleDrop(e: React.DragEvent, docType: string) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverType(null);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(docType, file);
  }

  async function handleConfirmRemove() {
    if (!confirmRemove) return;
    setRemoving(true);
    try {
      await fetchJson(`/api/projects/${projectId}/source-docs/${confirmRemove.docId}`, { method: "DELETE" });
      toast.success(`${confirmRemove.label} removed`);
      setConfirmRemove(null);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to remove document");
    } finally {
      setRemoving(false);
    }
  }

  async function saveCorrection(docId: string, fieldId: string, value: string) {
    try {
      const data = await fetchJson(`/api/projects/${projectId}/source-docs/${docId}/facts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldId, value }),
      });
      setFacts(prev => ({ ...prev, [docId]: data.facts || [] }));
      setEditingFactId(null);
      toast.success("Correction saved — this now overrides the extracted value everywhere");
    } catch (err: any) {
      toast.error(err.message || "Failed to save correction");
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-text-muted text-xs">Loading…</div>;
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-text-muted">
        Upload the product&apos;s real source documents (TDS/spec sheet/sales kit) — for pre-launch or custom products with no live web presence, these become the top-priority grounded source for Go-To-Market generation. Spec fields fill verbatim with a citation; narrative fields are written from these facts only.
      </p>
      <p className="text-[10px] text-text-muted">
        Accepted: PDF, DOC, DOCX, XLS, XLSX, CSV — up to 15 MB. Drag a file onto a slot, or click Upload.
      </p>

      {DOC_TYPES.map(({ key, label, hint }) => {
        const versions = docs.filter(d => d.doc_type === key).sort((a, b) => b.version - a.version);
        const active = versions.find(d => d.is_active);
        const slot = uploadState[key] || IDLE_STATE;
        const isUploading = slot.status === "uploading";
        const isDragOver = dragOverType === key;

        return (
          <div
            key={key}
            onDragOver={e => handleDragOver(e, key)}
            onDragLeave={handleDragLeave}
            onDrop={e => handleDrop(e, key)}
            className={`border rounded-xl p-4 space-y-2 transition-colors ${isDragOver ? "border-accent bg-accent-bg/30" : "border-border"}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold text-text-primary">{label}</h3>
                <p className="text-[10px] text-text-muted">{hint}</p>
              </div>
              <label className="flex items-center gap-1.5 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[10px] font-bold rounded-lg cursor-pointer transition-colors shrink-0">
                {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                <span>{active ? "Replace" : "Upload"}</span>
                <input
                  ref={el => { fileInputRefs.current[key] = el; }}
                  type="file"
                  accept={ACCEPTED_EXTENSIONS.join(",")}
                  className="hidden"
                  disabled={isUploading}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(key, f); }}
                />
              </label>
            </div>

            {isDragOver && (
              <div className="text-[10px] text-accent font-semibold text-center py-2 border border-dashed border-accent rounded-lg">
                Drop to upload
              </div>
            )}

            {isUploading && (
              <div className="space-y-1">
                <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
                  <div className="h-full bg-accent transition-all duration-150" style={{ width: `${Math.round(slot.progress * 100)}%` }} />
                </div>
                <p className="text-[10px] text-text-muted">Uploading… {Math.round(slot.progress * 100)}%</p>
              </div>
            )}

            {slot.status === "error" && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-danger-bg border border-danger/25 rounded-lg text-[11px]">
                <span className="text-danger font-semibold">{slot.error}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {slot.pendingFile && (
                    <button type="button" onClick={() => handleRetry(key)} className="flex items-center gap-1 px-2 py-1 text-danger hover:bg-danger/10 rounded font-bold">
                      <RotateCw className="w-3 h-3" /> Retry
                    </button>
                  )}
                  <button type="button" onClick={() => handleDismissError(key)} className="p-1 text-text-muted hover:text-text-primary rounded">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}

            {active ? (
              <div className="text-[11px] border border-border/60 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-surface-3/30">
                  <div className="flex items-center gap-2 text-text-secondary min-w-0">
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-semibold text-text-primary truncate max-w-[200px]">{active.file_name}</span>
                    <span className="text-text-muted shrink-0">v{active.version}</span>
                    {active.file_size_bytes ? <span className="text-text-muted shrink-0">{formatFileSize(active.file_size_bytes)}</span> : null}
                    {versions.length > 1 && (
                      <span className="inline-flex items-center gap-0.5 text-text-muted shrink-0"><History className="w-3 h-3" />{versions.length}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setConfirmRemove({ docId: active.id, docType: key, label })}
                      title="Remove"
                      className="text-text-muted hover:text-danger transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => toggleExpand(active.id)} className="flex items-center gap-1 text-accent font-bold">
                      {expandedDocId === active.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      {active.extraction_status === "failed" ? "Extraction failed" : "Extracted facts"}
                    </button>
                  </div>
                </div>
                <div className="px-3 py-1 bg-surface-1 text-[10px] text-text-muted">
                  Uploaded {formatUploadedAt(active.uploaded_at)}
                </div>

                {expandedDocId === active.id && (
                  <div className="p-3 space-y-1.5 bg-surface-1 border-t border-border/40">
                    {(facts[active.id] || []).length === 0 ? (
                      <p className="text-text-muted italic">No structured facts recognized yet — you can add one below.</p>
                    ) : (
                      (facts[active.id] || []).map(f => (
                        <div key={f.id} className="flex items-center justify-between gap-2 py-1 border-b border-border/40 last:border-0">
                          <div className="min-w-0 flex-1">
                            <span className="font-mono text-text-muted">{f.field_id}</span>
                            {editingFactId === f.id ? (
                              <input
                                autoFocus
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") saveCorrection(active.id, f.field_id, editValue); if (e.key === "Escape") setEditingFactId(null); }}
                                className="ml-2 px-1.5 py-0.5 border border-accent rounded bg-surface-2 text-text-primary w-56"
                              />
                            ) : (
                              <span className="ml-2 text-text-primary">{f.value}</span>
                            )}
                            {f.source_location && <span className="ml-2 text-text-muted">({f.source_location})</span>}
                            {f.confirmed_by_user && <span className="ml-2 text-success font-semibold">confirmed</span>}
                          </div>
                          {editingFactId === f.id ? (
                            <button type="button" onClick={() => saveCorrection(active.id, f.field_id, editValue)} className="shrink-0 text-success">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button type="button" onClick={() => { setEditingFactId(f.id); setEditValue(f.value); }} className="shrink-0 text-text-muted hover:text-accent">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : (
              !isUploading && slot.status !== "error" && <p className="text-[11px] text-text-muted italic">No {label.toLowerCase()} uploaded yet.</p>
            )}
          </div>
        );
      })}

      <ConfirmDialog
        isOpen={!!confirmRemove}
        title={`Remove ${confirmRemove?.label}?`}
        description="This removes it from the project (it stops being used for generation). Prior versions and extracted facts are kept, and you can upload a new one anytime."
        confirmLabel="Remove"
        tone="danger"
        loading={removing}
        onConfirm={handleConfirmRemove}
        onClose={() => setConfirmRemove(null)}
      />
    </div>
  );
}
