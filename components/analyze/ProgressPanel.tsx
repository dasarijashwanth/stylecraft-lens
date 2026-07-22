"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, Loader2, AlertCircle, HelpCircle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

interface PhaseState {
  status: "waiting" | "running" | "complete" | "error";
  label: string;
  message: string;
}

// Phase 0 (Product Identification) runs before any competitor search —
// added so every downstream phase keys off a VERIFIED category instead
// of a hardcoded default (see lib/analysisEngine.ts / lib/product-identification.ts).
const PHASE_LABELS = [
  "Identifying the product",
  "Researching large brand competitors",
  "Researching indie & emerging competitors",
  "Synthesizing market analysis & strategic recommendations",
];

interface PendingQuestion {
  question: string;
  foundSoFar?: string;
  // Which context field the answer patches — "category" (Phase 0 product
  // identification, the original/default use of this pause mechanism) or
  // "pricePoint" (Phase 1's price-anchored discovery gate). Absent on old
  // paused questions that predate this field — treated as "category".
  field?: string;
  placeholder?: string;
}

interface Props {
  analysisId: string;
  productName: string;
  onComplete: (results: any) => void;
  onError: (msg: string) => void;
}

// A hard Vercel function kill (the route ran past its own maxDuration)
// returns a plain-text/HTML platform error page, not this route's own
// JSON — a raw res.json() call crashes on that with a confusing
// "Unexpected token 'A', "An error o"... is not valid JSON" surfaced
// straight to the user. Read the body as text first and parse it
// ourselves so a non-JSON response degrades to an honest, retryable
// message instead (same pattern as CompetitorCard.tsx's safeJson()).
async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(res.ok ? "Unexpected response from server" : "Server took too long to respond");
  }
  if (!res.ok) throw new Error(data.message || data.error || `Request to ${url} failed`);
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
  const [identity, setIdentity] = useState<any>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const [runToken, setRunToken] = useState(0);
  const startTime = useRef(Date.now());
  const timerRef = useRef<NodeJS.Timeout>();
  const resumeRef = useRef<(() => void) | null>(null);

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
        if (analysis.phase0_result && Object.keys(analysis.phase0_result).length) {
          results.identity = analysis.phase0_result;
          setIdentity(analysis.phase0_result);
          setPhases((prev) => prev.map((p, i) => (i === 0 ? { ...p, status: "complete", message: "Complete" } : p)));
        }
        if (analysis.phase1_result && Object.keys(analysis.phase1_result).length) {
          results.phase1 = analysis.phase1_result;
          setPhases((prev) => prev.map((p, i) => (i === 1 ? { ...p, status: "complete", message: "Complete" } : p)));
        }
        if (analysis.phase2_result && Object.keys(analysis.phase2_result).length) {
          results.phase2 = analysis.phase2_result;
          setPhases((prev) => prev.map((p, i) => (i === 2 ? { ...p, status: "complete", message: "Complete" } : p)));
        }

        while (!cancelled) {
          if (analysis.status === "complete") {
            setPhases((prev) => prev.map((p) => ({ ...p, status: "complete", message: "Complete" })));
            onComplete({
              identity: results.identity || identity,
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

          // The pipeline paused for a clarifying answer — either Phase 0
          // (product identity unclear) or Phase 1 (no target price
          // resolvable, see lib/analysisEngine.ts's resolveDiscoveryTargetPrice).
          // analysis.phase is whichever phase is actually paused (it's never
          // advanced past while a question is pending), so the "waiting"
          // highlight lands on the right step instead of always phase 0.
          if (analysis.pending_question) {
            setPhases((prev) => prev.map((p, i) => (i === analysis.phase ? { ...p, status: "running", message: "Waiting for your answer…" } : p)));
            await new Promise<void>((resolve) => { resumeRef.current = resolve; setPendingQuestion(analysis.pending_question); });
            if (cancelled) return;
            setPendingQuestion(null);
            const refreshed = await fetchJsonWithRetry(`/api/analyses/${analysisId}`, undefined, () => {});
            analysis = refreshed.analysis;
            continue;
          }

          const runningIdx = analysis.phase; // 0, 1, 2, or 3 — the phase about to run
          // Phase 1 (large brand) and Phase 2 (emerging) now run concurrently
          // as a single merged request (see lib/analysisEngine.ts) — both
          // rows show "running" together instead of implying they're still
          // sequential.
          const runningIndices = runningIdx === 1 ? [1, 2] : [runningIdx];
          setPhases((prev) =>
            prev.map((p, i) => (runningIndices.includes(i) ? { ...p, status: "running", message: "Running…" } : p))
          );

          const { analysis: updated, step } = await fetchJsonWithRetry(
            `/api/analyses/${analysisId}/continue`,
            { method: "POST" },
            (attempt) =>
              setPhases((prev) =>
                prev.map((p, i) => (runningIndices.includes(i) ? { ...p, message: `Connection dropped — retrying (${attempt})…` } : p))
              )
          );
          if (cancelled) return;

          searchesSoFar += step.totalSearches || 0;
          setTotalSearches(searchesSoFar);

          if (step.status === "failed") {
            throw new Error(step.error || "Analysis failed");
          }

          if (step.pendingQuestion) {
            analysis = updated;
            continue;
          }

          if (step.phase === 1) {
            results.identity = step.stepResult;
            setIdentity(step.stepResult);
          }
          // step.phase === 2 only happens for an analysis already mid-flight
          // from before Phase 1+2 were merged into one request — a brand-new
          // analysis goes straight from phase 1 to phase 3.
          if (step.phase === 2) results.phase1 = step.stepResult;
          const mergedPhase1And2 = step.phase === 3 && step.stepResult && step.stepResult.phase1 && step.stepResult.phase2;
          if (step.phase === 3) {
            if (mergedPhase1And2) {
              results.phase1 = step.stepResult.phase1;
              results.phase2 = step.stepResult.phase2;
            } else {
              // Legacy shape: this analysis was already at phase 2 before the
              // merge shipped, so this step is just the old phase-2-only result.
              results.phase2 = step.stepResult;
            }
          }
          if (step.phase === 5) {
            results.phase3 = step.stepResult;
            results.reportId = step.reportId;
          }

          if (mergedPhase1And2) {
            setPhases((prev) => prev.map((p, i) => (i === 1 || i === 2 ? { ...p, status: "complete", message: "Complete" } : p)));
          } else {
            const completedIdx = step.phase === 5 ? 3 : step.phase - 1;
            setPhases((prev) =>
              prev.map((p, i) => (i === completedIdx ? { ...p, status: "complete", message: "Complete" } : p))
            );
          }

          analysis = updated;
        }
      } catch (err: any) {
        if (cancelled) return;
        clearInterval(timerRef.current);
        setPhases((prev) =>
          prev.map((p) => (p.status === "running" ? { ...p, status: "error", message: err.message } : p))
        );
        // Stay mounted with a Retry affordance instead of immediately bouncing
        // back to the empty form — /continue always re-reads the persisted
        // phase and only advances it by one, so resuming from here is safe
        // (see fetchJsonWithRetry's comment above). onError is now only
        // invoked if the user explicitly chooses to give up (see the
        // "Start new analysis instead" button below).
        setFailedMessage(err.message || "Analysis failed");
      }
    }

    run();

    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
    };
  }, [analysisId, runToken]);

  function handleRetry() {
    setFailedMessage(null);
    setPhases(PHASE_LABELS.map((label) => ({ status: "waiting", label, message: "Waiting to start…" })));
    setRunToken((t) => t + 1);
  }

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
      resumeRef.current?.();
    } catch (err) {
      // Leave the question visible — the user can retry submitting.
    } finally {
      setSubmittingAnswer(false);
    }
  }

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}m ${s % 60}s`;

  const completedCount = phases.filter((p) => p.status === "complete").length;
  // "Running" for shimmer/pulse purposes — actively processing, not paused
  // waiting on the user and not yet finished.
  const isRunning = !failedMessage && !pendingQuestion && completedCount < PHASE_LABELS.length;

  return (
    <motion.div layout className="analysis-progress-panel bg-surface-2 border border-border rounded-xl overflow-hidden mb-6 shadow-xl text-xs">
      {/* Top bar */}
      <div className="progress-topbar flex items-center justify-between px-5 py-3 border-b border-border bg-surface-3/30">
        <div className="progress-meta text-[11px] text-text-muted font-mono">
          <span className="product-label font-bold text-text-primary">{productName}</span>
          <span className="mx-1.5">·</span>
          <span className="search-count">{totalSearches} web searches</span>
          <span className="mx-1.5">·</span>
          <span className="elapsed">{formatTime(elapsedSeconds)}</span>
        </div>
        {pendingQuestion ? (
          <div className="status-running flex items-center gap-1.5 text-[11px] text-warning font-semibold">
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Waiting for your input…</span>
          </div>
        ) : (
          <div className="status-running flex items-center gap-1.5 text-[11px] text-accent font-semibold">
            {isRunning && <span className="pulse-dot w-1.5 h-1.5 rounded-full bg-accent" />}
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Analyzing…</span>
          </div>
        )}
      </div>

      {/* Overall progress bar — derived from completed phase count.
          A shimmer sweeps across the filled portion only while actively
          running (never while paused for input or after completion). */}
      <div className="h-1 bg-surface-3">
        <div
          className="relative h-full bg-accent overflow-hidden transition-[width] duration-[250ms] ease-[var(--ease-out)]"
          style={{ width: `${(completedCount / PHASE_LABELS.length) * 100}%` }}
        >
          {isRunning && <div className="shimmer-sweep" />}
        </div>
      </div>

      {/* Product Identity Card — shown as soon as Stage 1 completes, so a
          wrong identification is visible immediately. */}
      <AnimatePresence initial={false}>
        {identity && (identity.category || identity.whatItIs) && (
          <motion.div
            key="identity-card"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mx-5 mt-4 overflow-hidden"
          >
            <div className="p-3 bg-surface-3/30 border border-border rounded-lg">
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pause-and-ask: identification couldn't confidently determine the
          category — never guess, ask the one question needed instead. */}
      <AnimatePresence initial={false}>
        {pendingQuestion && (
          <motion.div
            key="pending-question"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mx-5 mt-4 overflow-hidden"
          >
            <div className="p-3.5 bg-warning/5 border border-warning/25 rounded-lg space-y-2">
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
                  placeholder={pendingQuestion.placeholder || "e.g. beard trimmer"}
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
          </motion.div>
        )}
      </AnimatePresence>

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
              ) : phase.status === "error" ? (
                <AlertCircle className="w-5 h-5 text-danger" />
              ) : pendingQuestion && i === (pendingQuestion.field === "pricePoint" ? 1 : 0) ? (
                <HelpCircle className="w-5 h-5 text-warning" />
              ) : phase.status === "running" ? (
                <Loader2 className="w-5 h-5 text-accent animate-spin" />
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

      {/* Terminal failure — resumable in place instead of discarding progress
          back to the empty form; /continue is safe to call again (see the
          comment on fetchJsonWithRetry above). */}
      {failedMessage && (
        <div className="mx-5 mb-5 p-3.5 bg-danger-bg border border-danger/20 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2 text-danger">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{failedMessage}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRetry}
              className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg transition-colors"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => onError(failedMessage)}
              className="px-3 py-1.5 border border-border hover:bg-surface-3 text-text-primary text-[11px] font-semibold rounded-lg transition-colors"
            >
              Start new analysis instead
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
