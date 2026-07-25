"use client";

import { useEffect, useState } from "react";
import { Presentation, Loader2, AlertCircle, Download, RefreshCw, Clock, CheckCircle2, History } from "lucide-react";
import { toast } from "sonner";
import { SaveToDriveButton } from "@/components/ui/SaveToDriveButton";

interface ProjectDeckRow {
  id: string;
  project_id: string;
  template_id: string | null;
  status: "pending" | "generating" | "complete" | "failed";
  file_name: string | null;
  file_size_bytes: number | null;
  slides_removed: number[];
  error_message: string | null;
  gtm_snapshot_at: string | null;
  generated_at: string | null;
  drive_url: string | null;
  created_at: string;
}

interface Props {
  projectId: string;
  pipelineStatus?: string;
  pipelinePhase?: string;
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return "never";
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  return `${diffDays} days ago`;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  return `${(bytes / 1024).toFixed(0)} KB`;
}

// Depends on pipelineStatus/pipelinePhase the same deliberate way
// TdsKnowledgeSection/ProductKnowledgeSection already do, so a
// freshly-completed deck appears without a manual reload.
export function ProjectDeckTab({ projectId, pipelineStatus, pipelinePhase }: Props) {
  const [decks, setDecks] = useState<ProjectDeckRow[]>([]);
  const [gtmLastEditedAt, setGtmLastEditedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function load() {
    try {
      const res = await fetch(`/api/projects/${projectId}/deck`);
      const data = await res.json();
      if (res.ok) {
        setDecks(data.decks || []);
        setGtmLastEditedAt(data.gtmLastEditedAt || null);
      }
    } catch (e) {
      console.error("Failed to load deck info:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (projectId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, pipelineStatus, pipelinePhase]);

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/deck/regenerate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to regenerate deck");
      toast.success("Deck regenerated");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to regenerate deck");
    } finally {
      setRegenerating(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/deck/download`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Download failed");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="(.+)"/);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] || "ProjectDeck.pptx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err.message || "Failed to download deck");
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-accent animate-spin mb-2" />
        <p className="text-xs text-text-muted">Loading Project Deck…</p>
      </div>
    );
  }

  const latest = decks[0] ?? null;
  // The engine's `phase` names the step just completed — "gtm"+"running" is
  // the real window deck generation is actively in flight (see
  // lib/project-generation-engine.ts); "deck" is terminal, reached whether
  // or not a deck actually rendered (e.g. no active template yet).
  const isDeckGenerating = pipelinePhase === "gtm" && pipelineStatus === "running";
  const isDeckPhaseDone = pipelinePhase === "deck";

  let state: "queued" | "generating" | "ready" | "failed" | "no-template";
  if (latest?.status === "generating" || latest?.status === "pending") state = "generating";
  else if (latest?.status === "complete") state = "ready";
  else if (latest?.status === "failed") state = "failed";
  else if (isDeckGenerating) state = "generating";
  else if (isDeckPhaseDone) state = "no-template";
  else state = "queued";

  const isStale = !!(
    latest?.status === "complete" &&
    gtmLastEditedAt &&
    latest.gtm_snapshot_at &&
    new Date(gtmLastEditedAt) > new Date(latest.gtm_snapshot_at)
  );

  return (
    <div className="space-y-6 text-xs">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
          <Presentation className="w-4 h-4 text-accent" />
          <span>Project Deck</span>
        </h3>
        <p className="text-text-muted leading-relaxed">
          An auto-generated PowerPoint deck built from this project&apos;s GTM sheet, pricing, and competitive data, rendered into your company&apos;s branded template.
        </p>
      </div>

      {state === "queued" && (
        <div className="flex flex-col items-center justify-center p-10 bg-surface-3/20 border border-border border-dashed rounded-xl text-center gap-2">
          <Clock className="w-6 h-6 text-text-muted" />
          <p className="font-semibold text-text-primary">Queued</p>
          <p className="text-[11px] text-text-muted max-w-sm">The deck will generate automatically once this project&apos;s Go-To-Market sheet finishes.</p>
        </div>
      )}

      {state === "generating" && (
        <div className="flex flex-col items-center justify-center p-10 bg-surface-3/20 border border-border rounded-xl text-center gap-2">
          <Loader2 className="w-6 h-6 text-accent animate-spin" />
          <p className="font-semibold text-text-primary">Generating…</p>
          <p className="text-[11px] text-text-muted max-w-sm">Building your deck from the latest GTM and pricing data.</p>
        </div>
      )}

      {state === "no-template" && (
        <div className="flex flex-col items-center justify-center p-10 bg-warning-bg border border-warning/20 rounded-xl text-center gap-2">
          <AlertCircle className="w-6 h-6 text-warning" />
          <p className="font-semibold text-text-primary">No deck template configured</p>
          <p className="text-[11px] text-text-muted max-w-sm">An admin needs to upload and activate a deck template at Deck Templates before decks can generate.</p>
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenerating}
            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 border border-border hover:border-border-strong text-text-secondary text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
          >
            {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span>Try again</span>
          </button>
        </div>
      )}

      {state === "failed" && latest && (
        <div className="flex flex-col items-center justify-center p-10 bg-danger-bg border border-danger/20 rounded-xl text-center gap-2">
          <AlertCircle className="w-6 h-6 text-danger" />
          <p className="font-semibold text-text-primary">Generation failed</p>
          <p className="text-[11px] text-danger max-w-md">{latest.error_message || "Unknown error"}</p>
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenerating}
            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
          >
            {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span>Retry</span>
          </button>
        </div>
      )}

      {state === "ready" && latest && (
        <div className="space-y-4">
          {isStale && (
            <div className="flex items-center justify-between gap-3 p-3 bg-warning-bg border border-warning/20 rounded-xl">
              <p className="text-[11px] text-warning">
                <strong>Deck is out of date</strong> — GTM was edited {formatRelativeTime(gtmLastEditedAt)}. Regenerate to include the latest data.
              </p>
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={regenerating}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-warning text-white text-[10px] font-bold rounded-lg disabled:opacity-50 shrink-0"
              >
                {regenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                <span>Regenerate</span>
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-surface-2 border border-border rounded-xl">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-success" />
              <div>
                <p className="font-semibold text-text-primary">{latest.file_name || "Project Deck"}</p>
                <p className="text-[10px] text-text-muted">
                  Generated {formatRelativeTime(latest.generated_at)}
                  {latest.file_size_bytes ? ` · ${formatBytes(latest.file_size_bytes)}` : ""}
                  {latest.slides_removed?.length ? ` · ${latest.slides_removed.length} empty slide${latest.slides_removed.length === 1 ? "" : "s"} hidden` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
              >
                {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>{downloading ? "Preparing…" : "Download PPTX"}</span>
              </button>
              <SaveToDriveButton docType="deck" id={projectId} initialDriveUrl={latest.drive_url} />
              {!isStale && (
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-border hover:border-border-strong text-text-secondary text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
                >
                  {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  <span>Regenerate</span>
                </button>
              )}
            </div>
          </div>

          {decks.length > 1 && (
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" />
                <span>Version History</span>
              </h4>
              <div className="divide-y divide-border/60 border border-border rounded-xl overflow-hidden">
                {decks.slice(1).map(d => (
                  <div key={d.id} className="flex items-center justify-between px-3.5 py-2.5">
                    <div>
                      <p className="text-[11px] font-semibold text-text-primary">{formatRelativeTime(d.created_at)}</p>
                      <p className="text-[10px] text-text-muted capitalize">{d.status}</p>
                    </div>
                    {d.status === "complete" && (
                      <a href={`/api/projects/${projectId}/deck/download?version=${d.id}`} className="text-[10px] font-bold text-accent hover:underline">
                        Download
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
