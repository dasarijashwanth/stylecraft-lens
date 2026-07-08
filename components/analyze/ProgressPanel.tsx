"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, Loader2, AlertCircle } from "lucide-react";

interface PhaseState {
  status: "waiting" | "running" | "complete" | "error";
  label: string;
  message: string;
}

const PHASE_LABELS = [
  "Researching large brand competitors",
  "Researching indie & emerging competitors",
  "Synthesizing market analysis & strategic recommendations",
];

interface Props {
  analysisId: string;
  productName: string;
  onComplete: (results: any) => void;
  onError: (msg: string) => void;
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Request to ${url} failed`);
  return data;
}

// A single phase step occasionally runs long enough (slow AI/Rainforest
// calls, a cold serverless start) to get killed by the platform's function
// timeout before it returns a response — the fetch() just fails with a
// network error, even though the step may have partially succeeded. Retrying
// is safe: /continue always re-reads the current persisted phase and only
// ever advances it by one, so a retry either resumes cleanly or repeats a
// no-op. Without this, a single transient timeout permanently stranded the
// analysis (confirmed happening in production — analyses stuck mid-phase
// with no error recorded, since the failure never reached the server).
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

export function ProgressPanel({ analysisId, productName, onComplete, onError }: Props) {
  const [phases, setPhases] = useState<PhaseState[]>(
    PHASE_LABELS.map((label) => ({
      status: "waiting",
      label,
      message: "Waiting to start…",
    }))
  );
  const [totalSearches, setTotalSearches] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startTime = useRef(Date.now());
  const timerRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    let cancelled = false;
    startTime.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);

    // The pipeline runs one phase per POST .../continue call — this loop
    // drives it phase by phase. Since every phase is persisted server-side
    // before this call returns, a page refresh mid-analysis just resumes
    // from whatever phase is saved, instead of losing progress.
    async function run() {
      const results: any = {};
      let searchesSoFar = 0;

      try {
        let { analysis } = await fetchJsonWithRetry(`/api/analyses/${analysisId}`, undefined, () => {});
        if (analysis.phase1_result && Object.keys(analysis.phase1_result).length) {
          results.phase1 = analysis.phase1_result;
          setPhases((prev) => prev.map((p, i) => (i === 0 ? { ...p, status: "complete", message: "Complete" } : p)));
        }
        if (analysis.phase2_result && Object.keys(analysis.phase2_result).length) {
          results.phase2 = analysis.phase2_result;
          setPhases((prev) => prev.map((p, i) => (i === 1 ? { ...p, status: "complete", message: "Complete" } : p)));
        }

        while (!cancelled) {
          if (analysis.status === "complete") {
            setPhases((prev) => prev.map((p) => ({ ...p, status: "complete", message: "Complete" })));
            onComplete({
              phase1: results.phase1 || {},
              phase2: results.phase2 || {},
              phase3: analysis.phase3_result || results.phase3 || {},
              productName,
              totalSearches: searchesSoFar,
              reportId: results.reportId,
            });
            return;
          }
          if (analysis.status === "failed") {
            throw new Error(analysis.error_message || "Analysis failed");
          }

          const runningIdx = analysis.phase; // 0, 1, or 2 — the phase about to run
          setPhases((prev) =>
            prev.map((p, i) => (i === runningIdx ? { ...p, status: "running", message: "Running…" } : p))
          );

          const { analysis: updated, step } = await fetchJsonWithRetry(
            `/api/analyses/${analysisId}/continue`,
            { method: "POST" },
            (attempt) =>
              setPhases((prev) =>
                prev.map((p, i) => (i === runningIdx ? { ...p, message: `Connection dropped — retrying (${attempt})…` } : p))
              )
          );
          if (cancelled) return;

          searchesSoFar += step.totalSearches || 0;
          setTotalSearches(searchesSoFar);

          if (step.status === "failed") {
            throw new Error(step.error || "Analysis failed");
          }

          if (step.phase === 1) results.phase1 = step.stepResult;
          if (step.phase === 2) results.phase2 = step.stepResult;
          if (step.phase === 4) {
            results.phase3 = step.stepResult;
            results.reportId = step.reportId;
          }

          const completedIdx = step.phase === 4 ? 2 : step.phase - 1;
          setPhases((prev) =>
            prev.map((p, i) => (i === completedIdx ? { ...p, status: "complete", message: "Complete" } : p))
          );

          analysis = updated;
        }
      } catch (err: any) {
        if (cancelled) return;
        clearInterval(timerRef.current);
        setPhases((prev) =>
          prev.map((p) => (p.status === "running" ? { ...p, status: "error", message: err.message } : p))
        );
        onError(err.message || "Analysis failed");
      }
    }

    run();

    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
    };
  }, [analysisId]);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}m ${s % 60}s`;

  return (
    <div className="analysis-progress-panel bg-surface-2 border border-border rounded-xl overflow-hidden mb-6 shadow-xl text-xs">
      {/* Top bar */}
      <div className="progress-topbar flex items-center justify-between px-5 py-3 border-b border-border bg-surface-3/30">
        <div className="progress-meta text-[11px] text-text-muted font-mono">
          <span className="product-label font-bold text-text-primary">{productName}</span>
          <span className="mx-1.5">·</span>
          <span className="search-count">{totalSearches} web searches</span>
          <span className="mx-1.5">·</span>
          <span className="elapsed">{formatTime(elapsedSeconds)}</span>
        </div>
        <div className="status-running flex items-center gap-1.5 text-[11px] text-accent font-semibold">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>Analyzing…</span>
        </div>
      </div>

      {/* Phase list */}
      <div className="phase-list flex flex-col p-5 gap-4">
        {phases.map((phase, i) => (
          <div
            key={i}
            className={`phase-row flex items-start gap-3 transition-opacity ${
              phase.status === "waiting" ? "opacity-40" : "opacity-100"
            }`}
          >
            {/* Phase icon */}
            <div className="phase-icon w-6 h-6 flex items-center justify-center shrink-0 mt-0.5">
              {phase.status === "complete" ? (
                <CheckCircle className="w-5 h-5 text-success" />
              ) : phase.status === "running" ? (
                <Loader2 className="w-5 h-5 text-accent animate-spin" />
              ) : phase.status === "error" ? (
                <AlertCircle className="w-5 h-5 text-danger" />
              ) : (
                <span className="phase-number w-5 h-5 rounded-full border border-border-strong text-[10px] font-bold text-text-muted flex items-center justify-center">
                  {i + 1}
                </span>
              )}
            </div>

            {/* Phase text */}
            <div className="phase-text text-xs leading-normal">
              <div className="phase-label">
                <span className="phase-counter font-semibold text-text-muted text-[10px] uppercase tracking-wider">
                  Phase {i + 1} of 3
                </span>
                <span className="mx-1.5 text-text-muted">—</span>
                <span
                  className={`phase-name font-bold ${
                    phase.status === "running"
                      ? "text-accent"
                      : phase.status === "complete"
                      ? "text-success"
                      : "text-text-primary"
                  }`}
                >
                  {phase.label}
                </span>
              </div>
              {phase.status === "running" && (
                <div className="phase-message text-[10px] text-text-muted mt-1 italic">
                  {phase.message}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
