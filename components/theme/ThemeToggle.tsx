"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";

// A single icon button that toggles light/dark — pins an explicit choice
// on click (persisted by next-themes via localStorage); until clicked, the
// app follows the OS's prefers-color-scheme (see app/layout.tsx's
// defaultTheme="system"/enableSystem).
export function ThemeToggle() {
  // resolvedTheme is undefined during SSR/pre-hydration (next-themes can't
  // know the real value until it reads localStorage/matchMedia client-side)
  // — rendering a fixed icon until mounted avoids a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="cursor-target p-1.5 rounded-lg hover:bg-surface-3 text-text-secondary transition-colors"
      title={mounted ? (isDark ? "Switch to light mode" : "Switch to dark mode") : "Toggle theme"}
      aria-label="Toggle light/dark theme"
    >
      {mounted && !isDark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
    </button>
  );
}
