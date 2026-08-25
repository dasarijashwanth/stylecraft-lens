"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, Loader2, AlertCircle } from "lucide-react";
import { useBackgroundStageStore, useGlassMode } from "@/stores/backgroundStageStore";

// Resumable phase-continue driver for the project-creation pipeline
// (capture snapshot -> generate TDS -> generate GTM) — structurally the
// same pattern as components/analyze/ProgressPanel.tsx, including the
// retry-on-transient-failure logic: a single phase call occasionally runs
// long enough (slow scrape/AI call, a cold serverless start) to hit a
// network error before the platform's function timeout returns anything,
// even though the step may have persisted server-side. Retrying is safe
// because pipeline/continue always re-reads the current phase and only
// ever advances it by one.

// TDS generation is feature-flag-gated (lib/feature-flags.ts) — its phase
// SLOT always exists server-side (lib/project-generation-engine.ts skips
// the actual work but still transitions through phase:"tds"), so a
// disabled step is just collapsed out of what's SHOWN here rather than
// removed from the underlying state machine. Project Deck generation is
// PERMANENTLY disabled (lib/deck-generate.ts's generateProjectDeck always
// throws now, feature removed) — its phase slot still exists server-side
// too, but showing a "Generating Project Deck" row for a step that never
// does real work anymore was just a confusing, misleading wait — dropped
// unconditionally rather than kept flag-gated.
function buildPhaseConfig(tdsEnabled: boolean, marketingDirectionEnabled: boolean = true, contentFormEnabled: boolean = true): { labels: string[]; index: Record<string, number> } {
  const labels: string[] = ["Capturing live product data"];
  const index: Record<string, number> = { pending: 0, snapshot: 1 };

  if (tdsEnabled) {
    labels.push("Generating Technical Data Sheet");
    index.tds = labels.length - 1;
  } else {
    index.tds = 1; // collapses onto "Capturing live product data" — no dedicated row
  }

  labels.push("Generating Go-To-Market sheet");
  index.gtm = labels.length - 1;

  if (contentFormEnabled) {
    labels.push("Generating Content Form");
    index.content_form = labels.length - 1;
  } else {
    index.content_form = labels.length - 1; // collapses onto "Generating Go-To-Market sheet" — no dedicated row
  }

  labels.push("Generating Product FAQs");
  index.faqs = labels.length - 1;

  if (marketingDirectionEnabled) {
    labels.push("Generating Marketing Direction");
    index.marketing_direction = labels.length - 1;
  } else {
    index.marketing_direction = labels.length - 1; // collapses onto "Generating Product FAQs" — no dedicated row
  }

  // No dedicated row — the server-side state machine still transitions
  // through phase:"deck" (a fast no-op now), so this just needs to map to
  // SOME valid index rather than go out of bounds; collapses onto the last
  // real row, same idiom as every other permanently/currently-disabled step
  // above.
  index.deck = labels.length - 1;

  return { labels, index };
}

interface PhaseState {
  status: "waiting" | "running" | "complete" | "error";
  label: string;
  message: string;
}

interface Props {
  projectId: string;
  tdsEnabled: boolean;
  marketingDirectionEnabled?: boolean;
  contentFormEnabled?: boolean;
  onDone: () => void;
}

// A hard Vercel function kill (ran past its own maxDuration) returns a
// plain-text/HTML platform error page, not this route's own JSON — read
// the body as text first so that degrades to an honest message instead of
// crashing on the raw parse error (same pattern as CompetitorCard.tsx's
// safeJson() / ProgressPanel.tsx's fetchJson()).
async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(res.ok ? "Unexpected response from server" : "Server took too long to respond");
  }
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

export function ProjectGenerationProgress({ projectId, tdsEnabled, marketingDirectionEnabled = true, contentFormEnabled = true, onDone }: Props) {
  const { labels: PHASE_LABELS, index: PHASE_INDEX } = buildPhaseConfig(tdsEnabled, marketingDirectionEnabled, contentFormEnabled);
  const [phases, setPhases] = useState<PhaseState[]>(
    PHASE_LABELS.map((label) => ({ status: "waiting", label, message: "Waiting to start…" }))
  );
  const [failed, setFailed] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [runToken, setRunToken] = useState(0);
  const isGlass = useGlassMode();

  // While this generation screen is showing, the persistent BackgroundStage
  // (mounted in Shell.tsx) swaps to the "waiting/generating" GIF-2 video
  // instead of this route's own default background — cleared on unmount so
  // the route's normal background resumes once generation finishes.
  useEffect(() => {
    useBackgroundStageStore.getState().setOverride("gif-2");
    return () => useBackgroundStageStore.getState().clearOverride();
  }, []);

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
    <div className={`border border-border rounded-xl overflow-hidden mb-4 shadow-sm ${isGlass ? "cinema-glass" : "bg-surface-2"}`}>
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
