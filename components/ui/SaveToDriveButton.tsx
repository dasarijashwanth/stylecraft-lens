"use client";

import { useState, useEffect } from "react";
import { HardDrive, CheckCircle, Loader2 } from "lucide-react";

export type DriveDocType = "sales-kit" | "tds" | "gtm" | "active-report";

interface Props {
  docType: DriveDocType;
  // Project id for sales-kit/tds/gtm, report id for active-report — matches
  // the addressing scheme used by /api/documents/[type]/[id]/export-pdf.
  id: string;
  initialDriveUrl?: string | null;
}

export function SaveToDriveButton({ docType, id, initialDriveUrl }: Props) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(initialDriveUrl ? "saved" : "idle");
  const [driveUrl, setDriveUrl] = useState<string | null>(initialDriveUrl ?? null);

  // initialDriveUrl usually arrives asynchronously, after this component has
  // already mounted with it undefined (useState's initial value only runs
  // once) — sync it in when it shows up, but don't clobber a save already in
  // progress or completed this session.
  useEffect(() => {
    if (initialDriveUrl && state === "idle") {
      setDriveUrl(initialDriveUrl);
      setState("saved");
    }
  }, [initialDriveUrl]);

  async function save(replace: boolean) {
    setState("saving");
    try {
      const res = await fetch("/api/drive/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType, id, replace }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Drive save failed");
      setDriveUrl(data.webViewLink);
      setState("saved");
    } catch {
      setState("error");
    }
  }

  function handleClick() {
    if (driveUrl) {
      const replace = window.confirm(
        "This document was already saved to Drive.\n\nOK = Replace the existing file\nCancel = Save as a new file"
      );
      save(replace);
    } else {
      save(false);
    }
  }

  if (state === "saved" && driveUrl) {
    return (
      <div className="inline-flex items-center gap-1.5">
        <a
          href={driveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold rounded-lg hover:bg-emerald-500/20 transition-all"
        >
          <CheckCircle className="w-3.5 h-3.5" />
          <span>Saved to Drive · Open ↗</span>
        </a>
        <button
          type="button"
          onClick={handleClick}
          className="px-2 py-1.5 text-[11px] font-semibold text-text-muted hover:text-text-primary transition-colors"
        >
          Save again
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
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
