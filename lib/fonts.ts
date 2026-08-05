// Central next/font/google config for the whole app — the ONLY place fonts
// are declared. next/font self-hosts these as real WOFF2 at build time (no
// runtime CDN request the way the old globals.css `@import` worked),
// handles font-display:swap and preloading automatically, and exposes each
// family as a CSS variable applied on <html> in app/layout.tsx. See
// app/globals.css's --font-display/--font-ui/--font-body-doc/--font-mono
// tokens for how these map to the app's 4 typography roles.
import { Jost, Montserrat, Roboto, JetBrains_Mono, Caveat } from "next/font/google";

export const jost = Jost({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-jost",
  display: "swap",
});

export const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-montserrat",
  display: "swap",
});

export const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
  display: "swap",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// Wordmark's brush-script "Lens" accent only (components/ui/Logo.tsx) — out
// of scope for the 4-role system, migrated here anyway so the old CDN
// @import can be removed entirely rather than left as a stray line for one
// font.
export const caveat = Caveat({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-caveat",
  display: "swap",
});

export const fontVariables = `${jost.variable} ${montserrat.variable} ${roboto.variable} ${jetbrainsMono.variable} ${caveat.variable}`;
