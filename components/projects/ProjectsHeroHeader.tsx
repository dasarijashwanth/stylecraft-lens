"use client";

// Wraps the Projects list's header row in a cinematic hero band that
// collapses (scale+fade) into a compact sticky bar as the user scrolls past
// it — the separate Toolbar Filter card and the projects grid below stay on
// the plain surface background, unaffected, per the redesign's
// "data-dense areas stay imagery-free" rule.
import { useRef } from "react";
import Image from "next/image";
import { gsap } from "gsap";
import { useScrollScene } from "@/lib/scroll-scenes";

const EXPANDED_PADDING = 48;
const COLLAPSED_PADDING = 12;
const COLLAPSE_RANGE_PX = 180;

export default function ProjectsHeroHeader({ children }: { children: React.ReactNode }) {
  const bgRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const scopeRef = useScrollScene<HTMLDivElement>((ctx) => {
    const container = scopeRef.current;
    if (!container) return;

    if (ctx.reducedMotion || ctx.mobile) {
      gsap.set(container, { paddingTop: COLLAPSED_PADDING, paddingBottom: COLLAPSED_PADDING });
      gsap.set(bgRef.current, { opacity: 0 });
      return;
    }

    gsap.set(container, { paddingTop: EXPANDED_PADDING, paddingBottom: EXPANDED_PADDING });

    gsap
      .timeline({
        scrollTrigger: {
          trigger: container,
          start: "top top",
          end: `+=${COLLAPSE_RANGE_PX}`,
          scrub: true,
        },
      })
      .to(container, { paddingTop: COLLAPSED_PADDING, paddingBottom: COLLAPSED_PADDING, ease: "none" }, 0)
      .to(bgRef.current, { opacity: 0, ease: "none" }, 0)
      .to(contentRef.current, { scale: 0.94, ease: "none" }, 0);
  }, []);

  return (
    <div
      ref={scopeRef}
      className="sticky top-0 z-20 relative px-4 md:px-6 rounded-2xl overflow-hidden bg-bg"
    >
      <div ref={bgRef} className="absolute inset-0">
        <Image src="/images/hero-2.jpg" alt="" fill sizes="100vw" className="object-cover" priority />
        <div className="cinema-scrim" style={{ "--scrim-opacity": 0.6 } as React.CSSProperties} />
      </div>
      <div ref={contentRef} className="relative origin-top">
        {children}
      </div>
    </div>
  );
}
