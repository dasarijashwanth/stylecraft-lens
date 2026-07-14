"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, Loader2, AlertCircle, HelpCircle } from "lucide-react";

interface PhaseState {
  status: "waiting" | "running" | "complete" | "error";
  label: string;
  message: string;
}

// Mirrors app/api/analysis/[jobId]/status/route.ts's own PHASE_LABELS —
// duplicated rather than imported since one lives in a client component and
// the other in a route handler; keep them in sync if either changes.
const PHASE_LABELS = [
  "Identifying the product",
  "Researching large brand competitors",
  "Researching indie & emerging competitors",
  "Synthesizing market analysis & strategic recommendations",
];

interface PendingQuestion {
  question: string;
  foundSoFar?: string;
}

interface Props {
  analysisId: string;
  productName: string;
  onComplete: (results: any) => void;
  onError: (msg: string) => void;
}

interface StatusResponse {
  jobId: string;
  status: "running" | "partial_complete" | "complete" | "failed";
  phase: { current: number; total: number; label: string };
  tasks: { done: number; running: number; failed: number; pending: number };
  sections: Record<string, string>;
  totalSearches: number;
  pendingQuestion: PendingQuestion | null;
}

const POLL_INTERVAL_MS = 2500;

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Request to ${url} failed`);
  return data;
}

// Replaces the old fetchJsonWithRetry client-side retry loop and the
// "Connection dropped — retrying (N)…" message it produced — the job now
// runs entirely in Inngest's own durable infrastructure, immune to any one
// HTTP request timing out. This component only ever reads state back from
// the DB (via GET /api/analysis/:jobId/status); a dropped poll is silently
// retried on the next interval tick, and the analysis itself is never
// affected by whether anyone is watching.
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
  const [identity, setIdentity] = useState<any>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const startTime = useRef(Date.now());
  const timerRef = useRef<NodeJS.Timeout>();
  const pollRef = useRef<NodeJS.Timeout>();
  const identityFetchedRef = useRef(false);
  const settledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    startTime.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);

    async function fetchIdentityIfNeeded() {
      if (identityFetchedRef.current) return;
      try {
        const { analysis } = await fetchJson(`/api/analyses/${analysisId}`);
        if (analysis?.phase0_result && Object.keys(analysis.phase0_result).length) {
          identityFetchedRef.current = true;
          setIdentity(analysis.phase0_result);
        }
      } catch {
        // non-fatal — the identity card is a nice-to-have during the run,
        // it isn't needed for the pipeline itself to keep progressing.
      }
    }

    async function settle(status: StatusResponse) {
      if (settledRef.current) return;
      settledRef.current = true;
      clearInterval(timerRef.current);
      clearInterval(pollRef.current);

      try {
        const { analysis } = await fetchJson(`/api/analyses/${analysisId}`);
        if (status.status === "failed") {
          setPhases((prev) => prev.map((p) => (p.status === "running" ? { ...p, status: "error", message: analysis.error_message || "Analysis failed" } : p)));
          onError(analysis.error_message || "Analysis failed");
          return;
        }
        setPhases((prev) => prev.map((p) => ({ ...p, status: "complete", message: "Complete" })));
        onComplete({
          identity: analysis.phase0_result || identity || {},
          phase1: analysis.phase1_result || {},
          phase2: analysis.phase2_result || {},
          phase3: analysis.phase3_result || {},
          productName,
          totalSearches: status.totalSearches,
        });
      } catch (err: any) {
        onError(err.message || "Analysis failed");
      }
    }

    async function poll() {
      if (cancelled || settledRef.current) return;
      try {
        const status: StatusResponse = await fetchJson(`/api/analysis/${analysisId}/status`);
        if (cancelled) return;

        setTotalSearches(status.totalSearches);
        setPendingQuestion(status.pendingQuestion);

        // Driven directly from each phase's own task_key rather than the
        // single coarse phase.current pointer — established-competitor and
        // emerging-competitor discovery now run concurrently in one
        // backend step (lib/analysisEngine.ts), so `analysis.phase` jumps
        // straight from 1 to 3 and never passes through an intermediate
        // "2" a single running index could represent. Reading each row's
        // real task status instead means both rows correctly show
        // running/complete together, matching what's actually happening.
        const TASK_KEYS = [
          "phase:0:identify_product",
          "phase:1:discover_established",
          "phase:2:discover_emerging",
          "phase:3:synthesize",
        ];
        setPhases((prev) =>
          prev.map((p, i) => {
            const taskStatus = status.sections[TASK_KEYS[i]];
            if (taskStatus === "failed") return { ...p, status: "error", message: "Analysis failed" };
            if (taskStatus === "done") return { ...p, status: "complete", message: "Complete" };
            if (taskStatus === "running") {
              return { ...p, status: "running", message: status.pendingQuestion ? "Waiting for your answer…" : "Running…" };
            }
            return p;
          })
        );

        // Phase 0 finished — fetch its result once so the identity card can
        // render mid-run, same UX the old continue-loop gave for free by
        // returning stepResult directly (the new status payload deliberately
        // stays lightweight, so this is a one-time follow-up read instead).
        if (status.sections["phase:0:identify_product"] === "done") {
          fetchIdentityIfNeeded();
        }

        if (status.status === "complete" || status.status === "partial_complete" || status.status === "failed") {
          await settle(status);
        }
      } catch {
        // A single missed poll is not an error worth surfacing — the job
        // keeps running server-side regardless; just try again next tick.
      }
    }

    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
      clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisId]);

  async function submitAnswer() {
    if (!answerText.trim() || submittingAnswer) return;
    setSubmittingAnswer(true);
    try {
      const res = await fetch(`/api/analyses/${analysisId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: answerText.trim() }),
      });
      if (!res.ok) throw new Error("Failed to submit answer");
      setAnswerText("");
      setPendingQuestion(null);
    } catch (err) {
      // Leave the question visible — the user can retry submitting.
    } finally {
      setSubmittingAnswer(false);
    }
  }

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

      {/* Product Identity Card — shown as soon as Stage 1 completes, so a
          wrong identification is visible immediately. */}
      {identity && (identity.category || identity.whatItIs) && (
        <div className="mx-5 mt-4 p-3 bg-surface-3/30 border border-border rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Identified Product</span>
            {identity.confidence && (
              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                identity.confidence === "high" ? "bg-success/10 border-success/30 text-success" :
                identity.confidence === "medium" ? "bg-warning/10 border-warning/25 text-warning" :
                "bg-danger/10 border-danger/30 text-danger"
              }`}>{identity.confidence} confidence</span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-text-primary font-semibold">
            {identity.category}{identity.subcategory && identity.subcategory !== identity.category ? ` / ${identity.subcategory}` : ""}
          </div>
          {identity.whatItIs && <p className="mt-1 text-[10px] text-text-secondary leading-relaxed">{identity.whatItIs}</p>}
          {Array.isArray(identity.evidence) && identity.evidence.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {identity.evidence.slice(0, 3).map((e: any, i: number) => (
                e.url ? (
                  <a key={i} href={e.url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-accent hover:underline">
                    source {i + 1}
                  </a>
                ) : null
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pause-and-ask: identification couldn't confidently determine the
          category — never guess, ask the one question needed instead. This
          is now a durable server-side pause (step.waitForEvent) — closing
          the tab and coming back still shows the same question. */}
      {pendingQuestion && (
        <div className="mx-5 mt-4 p-3.5 bg-warning/5 border border-warning/25 rounded-lg space-y-2">
          <div className="flex items-center gap-1.5 text-warning font-bold text-[11px]">
            <HelpCircle className="w-3.5 h-3.5" />
            <span>{pendingQuestion.question}</span>
          </div>
          {pendingQuestion.foundSoFar && (
            <p className="text-[10px] text-text-muted italic">What we found so far: {pendingQuestion.foundSoFar}</p>
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitAnswer()}
              placeholder="e.g. beard trimmer"
              className="flex-1 px-2.5 py-1.5 border border-border rounded-lg bg-surface-1 text-text-primary text-[11px] outline-none focus:border-accent"
              autoFocus
            />
            <button
              onClick={submitAnswer}
              disabled={!answerText.trim() || submittingAnswer}
              className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg disabled:opacity-50 transition-colors"
            >
              {submittingAnswer ? "Saving…" : "Continue"}
            </button>
          </div>
        </div>
      )}

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
                  Phase {i + 1} of {PHASE_LABELS.length}
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
