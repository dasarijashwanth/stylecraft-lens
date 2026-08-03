"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldAlert, RefreshCw, Loader2, AlertCircle, Upload, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import type { GtmWorkbookTemplateRow } from "@/lib/db/gtm-workbook-templates";

export default function AdminGtmWorkbookTemplatesPage() {
  const { user, loading: authLoading } = useAuth();
  const [templates, setTemplates] = useState<GtmWorkbookTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/gtm-workbook-templates");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load GTM workbook templates");
      setTemplates(data.templates || []);
    } catch (err: any) {
      setError(err.message || "Failed to load GTM workbook templates");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user && (user.role === "OWNER" || user.role === "ADMIN")) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Same signed-upload-URL bypass as the Deck Templates admin page — a real
  // multi-tab .xlsx can exceed Vercel's ~4.5MB inbound body limit.
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name.replace(/\.xlsx$/i, "");
    setUploading(true);
    try {
      const urlRes = await fetch("/api/admin/gtm-workbook-templates/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || "Failed to prepare upload");

      if (urlData.mode === "signed") {
        const { createSupabaseBrowserClient } = await import("@/lib/supabase-browser");
        const supabase = createSupabaseBrowserClient();
        const { error: uploadError } = await supabase.storage
          .from("gtm-workbook-templates")
          .uploadToSignedUrl(urlData.path, urlData.token, file);
        if (uploadError) throw new Error(uploadError.message || "Upload to storage failed");

        const finalizeRes = await fetch("/api/admin/gtm-workbook-templates/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: urlData.path, name, fileName: file.name }),
        });
        const finalizeData = await finalizeRes.json();
        if (!finalizeRes.ok) throw new Error(finalizeData.error || "Failed to finalize upload");
        toast.success("Uploaded — Product Knowledge, BOX ONLY, and Product FAQ all found");
      } else {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("name", name);
        const res = await fetch("/api/admin/gtm-workbook-templates", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
        toast.success("Uploaded — Product Knowledge, BOX ONLY, and Product FAQ all found");
      }

      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to upload template");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleActivate(id: string) {
    setActivatingId(id);
    try {
      const res = await fetch(`/api/admin/gtm-workbook-templates/${id}/activate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to activate");
      toast.success("Template is now active — Download XLSX will use it");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to activate template");
    } finally {
      setActivatingId(null);
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Spinner size="lg" className="text-accent" />
      </div>
    );
  }

  if (!user || (user.role !== "OWNER" && user.role !== "ADMIN")) {
    return (
      <div className="max-w-md mx-auto mt-16 text-center space-y-3">
        <ShieldAlert className="w-8 h-8 mx-auto text-text-muted" />
        <h1 className="text-sm font-bold text-text-primary">Not authorized</h1>
        <p className="text-xs text-text-muted">This page is restricted to workspace owners/admins.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-accent" />
          <h1 className="text-display">GTM Workbook Templates</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border hover:border-border-strong text-text-secondary text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
          <label className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-50">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            <span>Upload template</span>
            <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" disabled={uploading} onChange={handleUpload} />
          </label>
        </div>
      </div>
      <p className="text-xs text-text-muted -mt-4">
        The active template is used every time a project&apos;s GTM tab renders &quot;Download XLSX&quot;. Product Knowledge, BOX ONLY, and Product FAQ get filled with real data — every other tab (Product, Marketing Direction, Final Copy, etc.) is exported byte-for-byte untouched.
      </p>

      <div className="border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1fr_140px_120px_140px_100px] gap-3 px-4 py-2.5 bg-surface-3/30 border-b border-border text-[10px] font-bold text-text-muted uppercase tracking-wider">
          <span>Name</span>
          <span>Sheets Found</span>
          <span>Status</span>
          <span>Uploaded</span>
          <span></span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-text-muted text-xs">Loading…</div>
        ) : error ? (
          <div className="p-8 text-center text-danger text-xs flex items-center justify-center gap-1.5">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        ) : templates.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-xs">No templates uploaded yet — upload the official .xlsx workbook to get started.</div>
        ) : (
          <div className="divide-y divide-border/60">
            {templates.map(t => {
              const sheetCount = t.sheet_summary?.sheetNames?.length || 0;
              const missing = t.sheet_summary?.missingRequiredSheets?.length || 0;
              return (
                <div key={t.id} className="grid grid-cols-[1fr_140px_120px_140px_100px] gap-3 px-4 py-3 items-center text-xs">
                  <span className="font-semibold text-text-primary truncate">{t.name}</span>
                  <span>
                    {missing > 0 ? (
                      <Badge tone="danger" uppercase>{missing} missing</Badge>
                    ) : (
                      <Badge tone="success" uppercase>{sheetCount} sheets</Badge>
                    )}
                  </span>
                  <span>
                    {t.is_active ? (
                      <span className="inline-flex items-center gap-1 text-success font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Active
                      </span>
                    ) : (
                      <span className="text-text-muted">Inactive</span>
                    )}
                  </span>
                  <span className="text-text-muted text-[11px]">{new Date(t.uploaded_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  {!t.is_active ? (
                    <button
                      type="button"
                      onClick={() => handleActivate(t.id)}
                      disabled={activatingId === t.id}
                      className="flex items-center gap-1 px-2 py-1 border border-border hover:border-border-strong text-text-secondary text-[10px] font-bold rounded-md transition-colors disabled:opacity-50"
                    >
                      {activatingId === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Activate"}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
