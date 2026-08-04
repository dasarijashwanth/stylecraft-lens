"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Upload, Loader2, ChevronDown, ChevronRight, Pencil, Check, History } from "lucide-react";
import { toast } from "sonner";
import { uploadProjectSourceDoc } from "@/lib/upload-source-doc-client";

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

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request to ${url} failed`);
  return data;
}

export function SourceDocsTab({ projectId }: Props) {
  const [docs, setDocs] = useState<SourceDocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
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

  async function handleUpload(docType: string, file: File) {
    setUploadingType(docType);
    try {
      const result = await uploadProjectSourceDoc(projectId, docType, file);
      const carried = result.carriedForwardCount > 0 ? ` (${result.carriedForwardCount} of your prior corrections carried forward)` : "";
      toast.success(
        result.factsFound > 0
          ? `Uploaded — found ${result.factsFound} fact${result.factsFound === 1 ? "" : "s"}${carried}`
          : `Uploaded${carried || " — no structured facts recognized yet, review below"}`
      );
      await load();
      setExpandedDocId(result.document.id);
      await loadFacts(result.document.id);
    } catch (err: any) {
      toast.error(err.message || "Failed to upload document");
    } finally {
      setUploadingType(null);
      const input = fileInputRefs.current[docType];
      if (input) input.value = "";
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

      {DOC_TYPES.map(({ key, label, hint }) => {
        const versions = docs.filter(d => d.doc_type === key).sort((a, b) => b.version - a.version);
        const active = versions.find(d => d.is_active);
        const isUploading = uploadingType === key;

        return (
          <div key={key} className="border border-border rounded-xl p-4 space-y-2">
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
                  accept=".pdf,.xlsx,.xlsm,.docx"
                  className="hidden"
                  disabled={isUploading}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(key, f); }}
                />
              </label>
            </div>

            {active ? (
              <div className="text-[11px] border border-border/60 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-surface-3/30">
                  <div className="flex items-center gap-2 text-text-secondary">
                    <FileText className="w-3.5 h-3.5" />
                    <span className="font-semibold text-text-primary truncate max-w-[220px]">{active.file_name}</span>
                    <span className="text-text-muted">v{active.version}</span>
                    {versions.length > 1 && (
                      <span className="inline-flex items-center gap-0.5 text-text-muted"><History className="w-3 h-3" />{versions.length} versions</span>
                    )}
                  </div>
                  <button type="button" onClick={() => toggleExpand(active.id)} className="flex items-center gap-1 text-accent font-bold">
                    {expandedDocId === active.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    {active.extraction_status === "failed" ? "Extraction failed" : "Extracted facts"}
                  </button>
                </div>

                {expandedDocId === active.id && (
                  <div className="p-3 space-y-1.5 bg-surface-1">
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
              <p className="text-[11px] text-text-muted italic">No {label.toLowerCase()} uploaded yet.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
