"use client";

import { useState } from "react";
import { HardDrive, CheckCircle, Loader2 } from "lucide-react";

interface Props {
  projectId: string;
  projectName: string;
  outputType: "Competitive Analysis" | "Sales Kit" | "TDS" | "Report";
  content: string;
  fileName: string;
}

export function SaveToDriveButton({ projectId, projectName, outputType, content, fileName }: Props) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [driveUrl, setDriveUrl] = useState<string | null>(null);

  async function save() {
    setState("saving");
    try {
      const res = await fetch("/api/drive/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, projectName, outputType, content, fileName }),
      });
      const data = await res.json();
      if (data.webViewLink) {
        setDriveUrl(data.webViewLink);
        setState("saved");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }

  if (state === "saved" && driveUrl) {
    return (
      <a
        href={driveUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold rounded-lg hover:bg-emerald-500/20 transition-all"
      >
        <CheckCircle className="w-3.5 h-3.5" />
        <span>Saved to Drive · Open ↗</span>
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={save}
      disabled={state === "saving"}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 text-text-primary border border-border text-[11px] font-semibold rounded-lg hover:bg-surface-3 transition-all disabled:opacity-50"
    >
      {state === "saving" ? (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
          <span>Saving to Drive…</span>
        </>
      ) : state === "error" ? (
        <>
          <HardDrive className="w-3.5 h-3.5 text-rose-500" />
          <span>Retry Drive Sync</span>
        </>
      ) : (
        <>
          <HardDrive className="w-3.5 h-3.5 text-accent" />
          <span>Save to Google Drive</span>
        </>
      )}
    </button>
  );
}
