"use client";

import { AlertTriangle } from "lucide-react";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { cn } from "@/lib/ui";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "neutral";
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

// Replaces native window.confirm(...) across the app with a styled dialog
// that matches the dark theme — every destructive action (delete competitor,
// delete project, delete report, bulk delete) and the one non-destructive
// replace-vs-save-as-new choice (SaveToDriveButton) route through this.
export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} placement="center" size="sm">
      <div className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          {tone === "danger" && (
            <div className="shrink-0 w-9 h-9 rounded-full bg-danger-bg border border-danger/20 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-danger" />
            </div>
          )}
          <div className="space-y-1 pt-0.5">
            <h3 className="text-sm font-bold text-text-primary">{title}</h3>
            <p className="text-xs text-text-secondary leading-relaxed">{description}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-3.5 py-2 rounded-lg border border-border hover:bg-surface-3 text-xs font-semibold text-text-primary disabled:opacity-50 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "px-3.5 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-colors flex items-center gap-2",
              tone === "danger" ? "bg-danger hover:bg-danger/90" : "bg-accent hover:bg-accent-hover"
            )}
          >
            {loading && <Spinner size="xs" className="text-white" />}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
