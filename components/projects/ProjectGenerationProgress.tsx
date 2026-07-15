"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, Loader2, AlertCircle } from "lucide-react";

// Resumable phase-continue driver for the project-creation pipeline
// (capture snapshot -> generate TDS -> generate GTM) — structurally the
// same pattern as components/analyze/ProgressPanel.tsx, including the
// retry-on-transient-failure logic: a single phase call occasionally runs
// long enough (slow scrape/AI call, a cold serverless start) to hit a
// network error before the platform's function timeout returns anything,
// even though the step may have persisted server-side. Retrying is safe
// because pipeline/continue always re-reads the current phase and only
// ever advances it by one.

const PHASE_LABELS = [
  "Capturing live product data",
  "Generating Technical Data Sheet",
  "Generating Go-To-Market sheet",
];

interface PhaseState {
  status: "waiting" | "running" | "complete" | "error";
  label: string;
  message: string;
}

interface Props {
  projectId: string;
  onDone: () => void;
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request to ${url} failed`);
  return data;
}

async function fetchJsonWithRetry(url: string, init: RequestInit | undefined, onRetry: (attempt: number) => void, retries = 2): Promise<any> {
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchJson(url, init);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        onRetry(attempt + 1);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

const PHASE_INDEX: Record<string, number> = { pending: 0, snapshot: 1, tds: 2, gtm: 3 };

export function ProjectGenerationProgress({ projectId, onDone }: Props) {
  const [phases, setPhases] = useState<PhaseState[]>(
    PHASE_LABELS.map((label) => ({ status: "waiting", label, message: "Waiting to start…" }))
  );
  const [failed, setFailed] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [runToken, setRunToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        while (!cancelled) {
          const { state } = await fetchJsonWithRetry(`/api/projects/${projectId}/pipeline/continue`, { method: "POST" }, () => {});
          if (cancelled) return;

          if (state.status === "failed") {
            throw new Error(state.error_message || "Generation failed");
          }

          const runningIdx = PHASE_INDEX[state.phase] ?? 0;
          setPhases((prev) => prev.map((p, i) => {
            if (i < runningIdx) return { ...p, status: "complete", message: "Complete" };
            if (i === runningIdx && state.status !== "complete") return { ...p, status: "running", message: "Running…" };
            return p;
          }));

          if (state.status === "complete") {
            setPhases((prev) => prev.map((p) => ({ ...p, status: "complete", message: "Complete" })));
            onDone();
            return;
          }
        }
      } catch (err: any) {
        if (cancelled) return;
        setPhases((prev) => prev.map((p) => (p.status === "running" ? { ...p, status: "error", message: err.message } : p)));
        setFailed(err.message || "Generation failed");
      }
    }

    run();
    return () => { cancelled = true; };
  }, [projectId, runToken]);

  async function handleRetry() {
    setRetrying(true);
    try {
      await fetchJson(`/api/projects/${projectId}/pipeline/retry`, { method: "POST" });
      setFailed(null);
      setPhases(PHASE_LABELS.map((label) => ({ status: "waiting", label, message: "Waiting to start…" })));
      setRunToken((t) => t + 1);
    } catch (err: any) {
      setFailed(err.message || "Retry failed");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden mb-4 bg-surface-2 shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 bg-surface-3/30 border-b border-border">
        <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
          Setting up this product
        </span>
        {!failed && <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />}
      </div>
      <div className="flex flex-col p-4 gap-3">
        {phases.map((phase, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <div className="w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">
              {phase.status === "complete" ? (
                <CheckCircle className="w-4 h-4 text-success" />
              ) : phase.status === "running" ? (
                <Loader2 className="w-4 h-4 text-accent animate-spin" />
              ) : phase.status === "error" ? (
                <AlertCircle className="w-4 h-4 text-danger" />
              ) : (
                <span className="w-4 h-4 rounded-full border border-border-strong text-[9px] font-bold text-text-muted flex items-center justify-center">{i + 1}</span>
              )}
            </div>
            <div className="text-[11px]">
              <div className={`font-semibold ${phase.status === "running" ? "text-accent" : phase.status === "complete" ? "text-success" : "text-text-primary"}`}>
                {phase.label}
              </div>
              {(phase.status === "running" || phase.status === "error") && (
                <div className="text-[10px] text-text-muted mt-0.5 italic">{phase.message}</div>
              )}
            </div>
          </div>
        ))}
        {failed && (
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-[10px] text-danger">{failed}</p>
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="px-2.5 py-1 bg-accent hover:bg-accent-hover text-white text-[10px] font-bold rounded-lg disabled:opacity-50 transition-colors shrink-0"
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
