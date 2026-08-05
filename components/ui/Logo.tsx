// Shared brand mark — was previously duplicated as inline SVG across
// app/page.tsx, components/layout/Sidebar.tsx, and app/(auth)/sign-in/page.tsx
// with inconsistent sizing at each site. One component, size variants.
//
// Renders a real supplied file (lib/logo-config.ts) when one exists,
// automatically inverted per its artwork tone vs. the current resolved
// theme; falls back to today's inline-SVG/text placeholder when it doesn't
// (true today — no real brand files have been supplied yet).
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { APP_LOGO, type LogoAsset } from "@/lib/logo-config";

const WRAPPER_SIZES = {
  sm: "w-8 h-8 rounded-lg",
  md: "w-10 h-10 rounded-xl",
  lg: "w-14 h-14 rounded-2xl",
  xl: "w-20 h-20 rounded-[28px]",
} as const;

const ICON_SIZES = {
  sm: "w-5 h-5",
  md: "w-6 h-6",
  lg: "w-8 h-8",
  xl: "w-11 h-11",
} as const;

export type LogoSize = keyof typeof WRAPPER_SIZES;

// A dark-artwork mark is invisible on a dark surface (needs inverting to
// read light); a light-artwork mark is invisible on a light surface (needs
// inverting to read dark). `resolvedTheme` is undefined pre-hydration —
// callers gate on `mounted` themselves to avoid a flash/mismatch.
function needsInvert(asset: LogoAsset, resolvedTheme: string | undefined): boolean {
  return (asset.artwork === "dark" && resolvedTheme === "dark") || (asset.artwork === "light" && resolvedTheme === "light");
}

export function LogoArtwork({ asset, className }: { asset: LogoAsset; className?: string }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <Image
      src={asset.file}
      alt="StyleCraft"
      width={128}
      height={128}
      className={className}
      style={mounted && needsInvert(asset, resolvedTheme) ? { filter: "invert(1)" } : undefined}
    />
  );
}

export function Logo({ size = "sm", className = "" }: { size?: LogoSize; className?: string }) {
  if (APP_LOGO) {
    return (
      <div className={`flex items-center justify-center shrink-0 ${WRAPPER_SIZES[size]} ${className}`}>
        <LogoArtwork asset={APP_LOGO} className={`${ICON_SIZES[size]} object-contain`} />
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-center shrink-0 text-white ${WRAPPER_SIZES[size]} ${className}`}
      style={{ backgroundColor: "var(--brand-pink)", boxShadow: "0 4px 14px var(--brand-pink-glow)" }}
    >
      <svg className={ICON_SIZES[size]} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <circle cx="12" cy="12" r="5" strokeWidth="2.5" />
        <path strokeLinecap="round" strokeWidth="2.5" d="M12 2v2M12 20v2M2 12h2M20 12h2" />
      </svg>
    </div>
  );
}

// Mirrors the real Stylecraft wordmark's own treatment (STYLECRAFT in wide-
// tracked caps, with one short word picked out in a magenta brush-script —
// "Art" on the parent brand, "Lens" here since it's this product's name).
// Unrelated to the supplied-file logo system above — no real wordmark file
// has been named for this specific "text" role, so this stays as-is.
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-baseline gap-1.5 font-black tracking-wider leading-none ${className}`}>
      <span>STYLECRAFT</span>
      <span
        className="text-[1.55em] font-normal tracking-normal relative top-[0.09em]"
        style={{ fontFamily: "var(--font-script)", color: "var(--brand-pink)" }}
      >
        Lens
      </span>
    </div>
  );
}
