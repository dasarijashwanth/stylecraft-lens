"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ShieldAlert, RefreshCw, Loader2, AlertCircle, Upload, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import type { DeckTemplateRow } from "@/lib/db/deck-templates";

export default function AdminDeckTemplatesPage() {
  const { user, loading: authLoading } = useAuth();
  const [templates, setTemplates] = useState<DeckTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/deck-templates");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load deck templates");
      setTemplates(data.templates || []);
    } catch (err: any) {
      setError(err.message || "Failed to load deck templates");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user && (user.role === "OWNER" || user.role === "ADMIN")) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", file.name.replace(/\.pptx$/i, ""));
      const res = await fetch("/api/admin/deck-templates", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      const unmapped = data.template?.placeholder_map?.unmapped_tokens?.length || 0;
      toast.success(unmapped > 0 ? `Uploaded — ${unmapped} token(s) need mapping` : "Uploaded — all tokens mapped");
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
      const res = await fetch(`/api/admin/deck-templates/${id}/activate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to activate");
      toast.success("Template is now active — new project decks will use it");
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
          <h1 className="text-display">Deck Templates</h1>
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
            <input ref={fileInputRef} type="file" accept=".pptx" className="hidden" disabled={uploading} onChange={handleUpload} />
          </label>
        </div>
      </div>
      <p className="text-xs text-text-muted -mt-4">
        The active template is used to generate every new project&apos;s Project Deck. Uploading parses every <code>{"{{token}}"}</code> in the file and maps it against known GTM/pricing/project fields automatically — unmapped tokens need a manual mapping before they&apos;ll resolve to real data.
      </p>

      <div className="border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1fr_90px_100px_120px_140px_100px] gap-3 px-4 py-2.5 bg-surface-3/30 border-b border-border text-[10px] font-bold text-text-muted uppercase tracking-wider">
          <span>Name</span>
          <span>Slides</span>
          <span>Unmapped</span>
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
          <div className="p-8 text-center text-text-muted text-xs">No templates uploaded yet — upload a .pptx to get started.</div>
        ) : (
          <div className="divide-y divide-border/60">
            {templates.map(t => {
              const unmappedCount = t.placeholder_map?.unmapped_tokens?.length || 0;
              return (
                <div key={t.id} className="grid grid-cols-[1fr_90px_100px_120px_140px_100px] gap-3 px-4 py-3 items-center text-xs">
                  <Link href={`/dashboard/admin/deck-templates/${t.id}`} className="font-semibold text-text-primary hover:text-accent truncate">
                    {t.name}
                  </Link>
                  <span className="text-text-secondary font-mono text-[11px]">{t.slide_count}</span>
                  <span>
                    {unmappedCount > 0 ? (
                      <Badge tone="warning" uppercase>{unmappedCount} token{unmappedCount === 1 ? "" : "s"}</Badge>
                    ) : (
                      <Badge tone="success" uppercase>All mapped</Badge>
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
