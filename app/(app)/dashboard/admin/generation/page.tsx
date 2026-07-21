"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldAlert, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import type { GenerationJobRow } from "@/app/api/admin/generation-jobs/route";

function statusTone(status: string): BadgeTone {
  if (status === "complete") return "status-active";
  if (status === "failed") return "danger";
  if (status === "running") return "accent";
  return "status-archived"; // pending
}

export default function AdminGenerationPage() {
  const { user, loading: authLoading } = useAuth();
  const [jobs, setJobs] = useState<GenerationJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/generation-jobs");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load generation jobs");
      setJobs(data.jobs || []);
    } catch (err: any) {
      setError(err.message || "Failed to load generation jobs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user && (user.role === "OWNER" || user.role === "ADMIN")) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleRetry(projectId: string) {
    setRetryingId(projectId);
    try {
      const res = await fetch(`/api/projects/${projectId}/pipeline/retry`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Retry failed");
      toast.success("Pipeline retry started");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to retry pipeline");
    } finally {
      setRetryingId(null);
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
          <h1 className="text-display">Generation Health</h1>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-border hover:border-border-strong text-text-secondary text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>
      <p className="text-xs text-text-muted -mt-4">
        Last 20 projects touched by the TDS/GTM auto-generation pipeline, most recent first.
      </p>

      <div className="border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1fr_100px_100px_1fr_140px_80px] gap-3 px-4 py-2.5 bg-surface-3/30 border-b border-border text-[10px] font-bold text-text-muted uppercase tracking-wider">
          <span>Project</span>
          <span>Phase</span>
          <span>Status</span>
          <span>Error</span>
          <span>Last updated</span>
          <span></span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-text-muted text-xs">Loading…</div>
        ) : error ? (
          <div className="p-8 text-center text-danger text-xs flex items-center justify-center gap-1.5">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        ) : jobs.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-xs">No generation jobs recorded yet.</div>
        ) : (
          <div className="divide-y divide-border/60">
            {jobs.map(job => (
              <div key={job.projectId} className="grid grid-cols-[1fr_100px_100px_1fr_140px_80px] gap-3 px-4 py-3 items-center text-xs">
                <Link href={`/dashboard/projects/${job.projectId}`} className="font-semibold text-text-primary hover:text-accent truncate">
                  {job.projectName}
                </Link>
                <span className="text-text-secondary font-mono text-[11px]">{job.phase}</span>
                <Badge tone={statusTone(job.status)} uppercase>{job.status}</Badge>
                <span className="text-text-muted truncate" title={job.errorMessage || undefined}>{job.errorMessage || "—"}</span>
                <span className="text-text-muted text-[11px]">{new Date(job.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                {job.status === "failed" ? (
                  <button
                    type="button"
                    onClick={() => handleRetry(job.projectId)}
                    disabled={retryingId === job.projectId}
                    className="flex items-center gap-1 px-2 py-1 bg-accent hover:bg-accent-hover text-white text-[10px] font-bold rounded-md transition-colors disabled:opacity-50"
                  >
                    {retryingId === job.projectId ? <Loader2 className="w-3 h-3 animate-spin" /> : "Retry"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
