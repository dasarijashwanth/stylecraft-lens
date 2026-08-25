"use client";

import { Fragment, useState, useEffect } from "react";
import { HardDrive, CheckCircle, Loader2 } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";

export type DriveDocType = "sales-kit" | "tds" | "gtm" | "active-report" | "deck" | "gtm-xlsx";

interface Props {
  docType: DriveDocType;
  // Project id for sales-kit/tds/gtm/deck, report id for active-report,
  // GTM document id for gtm-xlsx — matches the addressing scheme used by
  // /api/documents/[type]/[id]/export-pdf (or, for gtm-xlsx, export-xlsx).
  id: string;
  initialDriveUrl?: string | null;
  // Shrinks padding/text/icon and shortens labels — for tight header
  // button rows (e.g. the GTM tab's export row) where the default size
  // pushes sibling buttons past the card's overflow-hidden edge.
  compact?: boolean;
}

export function SaveToDriveButton({ docType, id, initialDriveUrl, compact }: Props) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(initialDriveUrl ? "saved" : "idle");
  const [driveUrl, setDriveUrl] = useState<string | null>(initialDriveUrl ?? null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
      setConfirmOpen(true);
    } else {
      save(false);
    }
  }

  function handleReplace() {
    setConfirmOpen(false);
    save(true);
  }

  function handleSaveAsNew() {
    setConfirmOpen(false);
    save(false);
  }

  const confirmDialog = (
    <ConfirmDialog
      isOpen={confirmOpen}
      title="Already saved to Drive"
      description="This document was already saved to Google Drive. Replace the existing file, or save this as a new file?"
      confirmLabel="Replace existing"
      cancelLabel="Save as new"
      tone="neutral"
      onConfirm={handleReplace}
      onClose={handleSaveAsNew}
    />
  );

  const pad = compact ? "px-2 py-1" : "px-3 py-1.5";
  const text = compact ? "text-[10px]" : "text-[11px]";
  const icon = compact ? "w-3 h-3" : "w-3.5 h-3.5";

  if (state === "saved" && driveUrl) {
    return (
      <Fragment>
        <div className="inline-flex items-center gap-1.5">
          <a
            href={driveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 ${pad} bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 ${text} font-semibold rounded-lg hover:bg-emerald-500/20 transition-all`}
          >
            <CheckCircle className={icon} />
            <span>{compact ? "Drive ↗" : "Saved to Drive · Open ↗"}</span>
          </a>
          <button
            type="button"
            onClick={handleClick}
            className={`${compact ? "px-1 py-1 text-[10px]" : "px-2 py-1.5 text-[11px]"} font-semibold text-text-muted hover:text-text-primary transition-colors`}
          >
            {compact ? "Again" : "Save again"}
          </button>
        </div>
        {confirmDialog}
      </Fragment>
    );
  }

  return (
    <Fragment>
      <button
        type="button"
        onClick={handleClick}
        disabled={state === "saving"}
        className={`inline-flex items-center gap-1.5 ${pad} bg-surface-2 text-text-primary border border-border ${text} font-semibold rounded-lg hover:bg-surface-3 transition-all disabled:opacity-50`}
      >
        {state === "saving" ? (
          <>
            <Loader2 className={`${icon} animate-spin text-accent`} />
            <span>{compact ? "Saving…" : "Saving to Drive…"}</span>
          </>
        ) : state === "error" ? (
          <>
            <HardDrive className={`${icon} text-rose-500`} />
            <span>{compact ? "Retry Sync" : "Retry Drive Sync"}</span>
          </>
        ) : (
          <>
            <HardDrive className={`${icon} text-accent`} />
            <span>{compact ? "Save to Drive" : "Save to Google Drive"}</span>
          </>
        )}
      </button>
      {confirmDialog}
    </Fragment>
  );
}
