"use client";

import { useTheme } from "next-themes";
import { Toaster } from "sonner";

// Sonner's own theme prop only accepts "light" | "dark" | "system" — reads
// the app's actual active theme instead of the old hardcoded theme="dark",
// so toasts match whichever theme the user is on.
export function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster theme={(resolvedTheme as "light" | "dark") || "dark"} position="top-right" closeButton richColors />;
}
