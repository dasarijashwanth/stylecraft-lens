"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

// Next.js App Router's per-segment error boundary convention — catches any
// render/data error thrown anywhere under app/(app)/** (every authenticated
// dashboard page) instead of the whole app crashing to a blank white
// screen. No error boundary existed anywhere in this codebase before this.
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Full detail server/console-side; nothing sensitive (stack traces,
    // internal messages) is ever shown to the user below.
    console.error("[dashboard error boundary]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="w-12 h-12 rounded-full bg-danger/10 border border-danger/25 flex items-center justify-center mb-4">
        <AlertTriangle className="w-6 h-6 text-danger" />
      </div>
      <h1 className="text-sm font-bold text-text-primary mb-1.5">Something went wrong</h1>
      <p className="text-xs text-text-muted max-w-sm mb-5">
        This part of the page hit an unexpected error. Your data is safe — try again, or head back to the dashboard.
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={reset}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Try again
        </button>
        <a
          href="/dashboard"
          className="px-3.5 py-2 border border-border bg-surface-2 hover:bg-surface-3 text-text-primary text-xs font-bold rounded-lg transition-colors"
        >
          Back to dashboard
        </a>
      </div>
      {error.digest && <p className="mt-4 text-[10px] text-text-muted font-mono">Error ref: {error.digest}</p>}
    </div>
  );
}
