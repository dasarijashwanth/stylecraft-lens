"use client";

import { useEffect, useRef, useState } from "react";

export interface TaskDetail {
  status: "pending" | "running" | "done" | "failed";
  error: string | null;
  errorClass: string | null;
  provider: string | null;
  attempts: number;
}

export interface AnalysisStatus {
  jobId: string;
  status: "running" | "partial_complete" | "complete" | "failed";
  phase: { current: number; total: number; label: string };
  tasks: { done: number; running: number; failed: number; pending: number };
  sections: Record<string, string>;
  taskDetails: Record<string, TaskDetail>;
  totalSearches: number;
  pendingQuestion: { question: string; foundSoFar?: string } | null;
}

const POLL_INTERVAL_MS = 3000;

// Single shared poll of GET /api/analysis/:jobId/status for the results
// page — components/analyze/ResultsPanel.tsx uses this to drive every
// CompetitorCard's four sections instead of each card fetching
// independently (the old lib/fetch-queue.ts client-side-only concurrency
// cap this replaces). Keeps polling even once the sequential phase0-3
// backbone is "complete" — phase4's per-competitor tasks can still be
// running, and stops only once status is a genuine terminal state.
export function useAnalysisStatus(jobId: string | null | undefined) {
  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const pollRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/analysis/${jobId}/status`);
        if (!res.ok || cancelled) return;
        const data: AnalysisStatus = await res.json();
        if (cancelled) return;
        setStatus(data);
        if (data.status === "complete" || data.status === "failed" || data.status === "partial_complete") {
          clearInterval(pollRef.current);
        }
      } catch {
        // a missed poll isn't an error worth surfacing — the job keeps
        // running server-side regardless; just try again next tick.
      }
    }

    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(pollRef.current);
    };
  }, [jobId]);

  async function retryTasks(taskKeys: string[]) {
    if (!jobId) return;
    await fetch(`/api/analysis/${jobId}/tasks/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskKeys }),
    }).catch(() => {});
    // Resume polling immediately in case it had stopped (job was
    // partial_complete/failed) — the retry just re-armed some tasks.
    if (!pollRef.current) return;
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/analysis/${jobId}/status`);
        if (res.ok) setStatus(await res.json());
      } catch {}
    }, POLL_INTERVAL_MS);
  }

  return { status, retryTasks };
}
