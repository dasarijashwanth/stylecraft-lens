"use client";

// Thin gold bar fixed to the top of the viewport, filling with overall page
// scroll fraction. Mounted once in Shell.tsx for every (app) page, and
// separately on the Login page (which has no Shell). Renders a plain static
// element under reduced motion — no animated fill at all.
import { useScrollScene, scrollProgressBar } from "@/lib/scroll-scenes";

export default function ScrollProgressBar() {
  const scopeRef = useScrollScene<HTMLDivElement>((ctx) => {
    scrollProgressBar(scopeRef.current, ctx);
  }, []);

  return <div ref={scopeRef} className="scroll-progress-bar" aria-hidden="true" />;
}
