"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { cn } from "@/lib/ui";

export type ModalPlacement = "center" | "right" | "top";
export type ModalSize = "sm" | "md" | "lg" | "xl";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  placement?: ModalPlacement;
  size?: ModalSize;
  className?: string;
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
};

const CONTAINER_CLASSES: Record<ModalPlacement, string> = {
  center: "items-center justify-center p-4",
  right: "items-center justify-end",
  top: "items-start justify-center pt-[15vh] px-4",
};

const PANEL_VARIANTS: Record<ModalPlacement, Variants> = {
  center: { initial: { opacity: 0, scale: 0.96, y: 8 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.96, y: 8 } },
  top: { initial: { opacity: 0, y: -8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } },
  right: { initial: { x: "100%" }, animate: { x: 0 }, exit: { x: "100%" } },
};

// The single shared overlay shell — owns backdrop-click-to-close, Escape-key
// handling, and entrance/exit animation, so individual modals (AddCompetitorModal,
// LinkReportModal, Shell's command palette) only need to supply their own
// header/body/footer content. Consumers must render <Modal isOpen={isOpen}>
// unconditionally (no `if (!isOpen) return null` above it) — AnimatePresence
// needs to stay mounted through the exit transition.
export function Modal({ isOpen, onClose, children, placement = "center", size = "md", className }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className={cn("fixed inset-0 z-50 flex", CONTAINER_CLASSES[placement])}>
          <motion.div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
          <motion.div
            className={cn(
              "relative z-10 w-full shadow-2xl",
              placement === "right"
                ? "h-screen bg-surface-2 border-l border-border flex flex-col"
                : "bg-surface-2 border border-border rounded-xl flex flex-col",
              SIZE_CLASSES[size],
              className
            )}
            variants={PANEL_VARIANTS[placement]}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
