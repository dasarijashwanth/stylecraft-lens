"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, Loader2, AlertCircle } from "lucide-react";

interface PhaseState {
  status: "waiting" | "running" | "complete" | "error";
  label: string;
  message: string;
  searches: number;
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

export function ProgressPanel({ analysisId, productName, onComplete, onError }: Props) {
  const [phases, setPhases] = useState<PhaseState[]>(
    PHASE_LABELS.map((label) => ({
      status: "waiting",
      label,
      message: "Waiting to start…",
      searches: 0,
    }))
  );
  const [totalSearches, setTotalSearches] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [results, setResults] = useState<any>({});
  const startTime = useRef(Date.now());
  const timerRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    startTime.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);

    const eventSource = new EventSource(`/api/analyses/${analysisId}/stream`);

    eventSource.onmessage = (e) => {
      const event = JSON.parse(e.data);

      switch (event.type) {
        case "phase_start":
          setPhases((prev) =>
            prev.map((p, i) =>
              i === event.phase - 1
                ? { ...p, status: "running", message: event.message || "Running..." }
                : i < event.phase - 1
                ? { ...p, status: "complete", message: "Complete" }
                : { ...p, status: "waiting", message: "Waiting to start…" }
            )
          );
          break;

        case "phase_progress":
          setPhases((prev) =>
            prev.map((p, i) =>
              i === event.phase - 1
                ? { ...p, status: "running", message: event.message }
                : p
            )
          );
          break;

        case "search_update":
          setTotalSearches(event.total_searches);
          break;

        case "phase_complete":
          setTotalSearches(event.total_searches);
          setPhases((prev) =>
            prev.map((p, i) =>
              i === event.phase - 1
                ? { ...p, status: "complete", message: "Complete" }
                : p
            )
          );
          setResults((prev: any) => {
            const nextResults = {
              ...prev,
              [`phase${event.phase}`]: event.result,
            };
            return nextResults;
          });
          break;

        case "analysis_complete":
          clearInterval(timerRef.current);
          eventSource.close();
          setTotalSearches(event.total_searches);
          
          setPhases((prev) =>
            prev.map((p) => ({ ...p, status: "complete", message: "Complete" }))
          );

          // Return aggregated results
          onComplete({
            phase1: results.phase1 || event.result?.phase1 || {},
            phase2: results.phase2 || event.result?.phase2 || {},
            phase3: event.result?.phase3 || event.result || {},
            productName,
            totalSearches: event.total_searches
          });
          break;

        case "error":
          clearInterval(timerRef.current);
          eventSource.close();
          setPhases((prev) =>
            prev.map((p) =>
              p.status === "running" ? { ...p, status: "error", message: event.message } : p
            )
          );
          onError(event.message);
          break;
      }
    };

    eventSource.onerror = () => {
      // Don't crash immediately on simple network flutter, but handle close
    };

    return () => {
      eventSource.close();
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
