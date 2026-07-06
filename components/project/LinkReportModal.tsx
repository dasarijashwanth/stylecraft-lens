// components/project/LinkReportModal.tsx
"use client";

import { useEffect, useState } from "react";
import { X, FileText, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  isOpen: boolean;
  projectId: string;
  onLinked:  () => void;
  onClose:   () => void;
}

export function LinkReportModal({ isOpen, projectId, onLinked, onClose }: Props) {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState<string | null>(null);
  const [search,  setSearch]  = useState("");

  useEffect(() => {
    if (isOpen) {
      load();
    }
  }, [isOpen]);

  async function load() {
    try {
      setLoading(true);
      const res = await fetch("/api/reports");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setReports(data.reports || []);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load reports");
    } finally {
      setLoading(false);
    }
  }

  async function handleLink(reportId: string) {
    setLinking(reportId);
    try {
      const res = await fetch(`/api/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      if (!res.ok) throw new Error();
      toast.success("Report linked to project successfully");
      onLinked();
      onClose();
    } catch (err) {
      toast.error("Failed to link report");
    } finally {
      setLinking(null);
    }
  }

  if (!isOpen) return null;

  const filtered = reports.filter(r =>
    r.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-lg bg-surface-2 border border-border rounded-xl flex flex-col z-10 shadow-2xl overflow-hidden max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border bg-surface-3/30">
          <div>
            <h3 className="text-sm font-bold text-text-primary">Link an existing report</h3>
            <p className="text-[10px] text-text-muted mt-0.5">Select a competitive analysis to link to this project</p>
          </div>
          <button 
            onClick={onClose} 
            className="p-1 rounded-lg hover:bg-surface-3 text-text-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-border bg-surface-3/10">
          <input
            type="text"
            placeholder="Search reports by title…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-xs text-text-muted">
              <Loader2 className="w-6 h-6 animate-spin text-accent mb-2" />
              <span>Loading your reports…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FileText className="w-10 h-10 text-text-muted mb-3 opacity-40" />
              <p className="text-xs font-bold text-text-secondary">No reports found</p>
              <p className="text-[10px] text-text-muted max-w-[200px] mt-1 leading-normal">
                Run an analysis first to generate a competitive report.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map(r => (
                <button
                  key={r.id}
                  onClick={() => handleLink(r.id)}
                  disabled={linking !== null}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-border bg-surface-3/30 hover:bg-surface-3 text-left transition-colors disabled:opacity-50"
                >
                  <FileText className="w-4 h-4 text-accent shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-text-primary truncate">{r.title}</div>
                    <div className="text-[10px] text-text-muted mt-0.5 leading-none">
                      {r.projects?.name ? `Currently linked to: ${r.projects.name}` : "Unlinked"}
                      <span className="mx-1.5">·</span>
                      {new Date(r.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  {linking === r.id ? (
                    <span className="text-[10px] text-accent font-semibold animate-pulse">Linking…</span>
                  ) : (
                    <Check className="w-4 h-4 text-text-muted hover:text-success transition-colors" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-surface-3/30 flex justify-end">
          <button 
            onClick={onClose} 
            className="px-4 py-2 border border-border hover:bg-surface-3 text-xs font-semibold text-text-primary rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
