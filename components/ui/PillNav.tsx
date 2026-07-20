"use client";

// Adapted from React Bits' PillNav for this app's vertical sidebar and
// real Next.js routing, instead of the source demo's horizontal top bar +
// react-router-dom + own logo/hamburger/mobile-popover chrome (this app's
// Sidebar already renders its own logo header and mobile close button, so
// that part of the source component is dropped rather than duplicated).
//
// The hover-circle growth math (a circle that rises from the bottom-center
// of a pill and expands to cover it) is kept verbatim from source — it only
// depends on each item's own width/height ratio, which is still a wide/
// short rectangle stacked in a column, same shape as a horizontal row of
// pills. The one real behavioral addition: the ACTIVE (current-route) item
// keeps its circle permanently at full reveal (source only ever shows this
// as a transient hover state), so "you are here" reads clearly at rest,
// not just on mouseover.
import { useEffect, useRef } from "react";
import Link from "next/link";
import { gsap } from "gsap";
import type { LucideIcon } from "lucide-react";
import "./PillNav.css";

export interface PillNavItem {
  label: string;
  href: string;
  icon?: LucideIcon;
}

interface PillNavProps {
  items: PillNavItem[];
  activeIndex: number;
  onItemClick?: () => void;
  ease?: string;
  baseColor?: string;
  hoveredPillTextColor?: string;
  pillTextColor?: string;
}

export function PillNav({
  items,
  activeIndex,
  onItemClick,
  ease = "power3.out",
  baseColor = "#6366F1",
  hoveredPillTextColor = "#ffffff",
  pillTextColor,
}: PillNavProps) {
  const navRef = useRef<HTMLUListElement>(null);
  const circleRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const tlRefs = useRef<(gsap.core.Timeline | null)[]>([]);
  const activeTweenRefs = useRef<(gsap.core.Tween | null)[]>([]);
  const prevActiveIndexRef = useRef<number | null>(null);

  useEffect(() => {
    const layout = () => {
      circleRefs.current.forEach((circle, index) => {
        if (!circle?.parentElement) return;

        const pill = circle.parentElement;
        const rect = pill.getBoundingClientRect();
        const { width: w, height: h } = rect;
        if (!w || !h) return;
        const R = (w * w / 4 + h * h) / (2 * h);
        const D = Math.ceil(2 * R) + 2;
        const delta = Math.ceil(R - Math.sqrt(Math.max(0, R * R - (w * w) / 4))) + 1;
        const originY = D - delta;

        circle.style.width = `${D}px`;
        circle.style.height = `${D}px`;
        circle.style.bottom = `-${delta}px`;

        gsap.set(circle, { xPercent: -50, scale: 0, transformOrigin: `50% ${originY}px` });

        const label = pill.querySelector<HTMLElement>(".pill-label");
        const hoverLabel = pill.querySelector<HTMLElement>(".pill-label-hover");
        if (label) gsap.set(label, { y: 0 });
        if (hoverLabel) gsap.set(hoverLabel, { y: h + 12, opacity: 0 });

        tlRefs.current[index]?.kill();
        const tl = gsap.timeline({ paused: true });
        tl.to(circle, { scale: 1.2, xPercent: -50, duration: 2, ease, overwrite: "auto" }, 0);
        if (label) tl.to(label, { y: -(h + 8), duration: 2, ease, overwrite: "auto" }, 0);
        if (hoverLabel) {
          gsap.set(hoverLabel, { y: Math.ceil(h + 100), opacity: 0 });
          tl.to(hoverLabel, { y: 0, opacity: 1, duration: 2, ease, overwrite: "auto" }, 0);
        }
        tlRefs.current[index] = tl;
      });

      // Snap the active item straight to "revealed" on (re)layout — no
      // animated reveal on mount/resize, just on real activeIndex changes.
      const tl = tlRefs.current[activeIndex];
      if (tl) tl.progress(1);
      prevActiveIndexRef.current = activeIndex;
    };

    layout();
    window.addEventListener("resize", layout);
    document.fonts?.ready?.then(layout).catch(() => {});
    return () => window.removeEventListener("resize", layout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, ease]);

  // Keep the active pill's circle permanently revealed and smoothly retract
  // whichever pill was previously active — this is the persistent "current
  // tab" state; hover on non-active pills is handled separately below.
  useEffect(() => {
    const prev = prevActiveIndexRef.current;
    if (prev === activeIndex) return;

    const activeTl = tlRefs.current[activeIndex];
    if (activeTl) {
      activeTweenRefs.current[activeIndex]?.kill();
      activeTweenRefs.current[activeIndex] = activeTl.tweenTo(activeTl.duration(), { duration: 0.4, ease, overwrite: "auto" });
    }
    if (prev !== null) {
      const prevTl = tlRefs.current[prev];
      if (prevTl) {
        activeTweenRefs.current[prev]?.kill();
        activeTweenRefs.current[prev] = prevTl.tweenTo(0, { duration: 0.3, ease, overwrite: "auto" });
      }
    }
    prevActiveIndexRef.current = activeIndex;
  }, [activeIndex, ease]);

  const handleEnter = (i: number) => {
    if (i === activeIndex) return; // already permanently revealed
    const tl = tlRefs.current[i];
    if (!tl) return;
    activeTweenRefs.current[i]?.kill();
    activeTweenRefs.current[i] = tl.tweenTo(tl.duration(), { duration: 0.3, ease, overwrite: "auto" });
  };

  const handleLeave = (i: number) => {
    if (i === activeIndex) return; // stays revealed
    const tl = tlRefs.current[i];
    if (!tl) return;
    activeTweenRefs.current[i]?.kill();
    activeTweenRefs.current[i] = tl.tweenTo(0, { duration: 0.2, ease, overwrite: "auto" });
  };

  const cssVars = {
    ["--base" as string]: baseColor,
    ["--hover-text" as string]: hoveredPillTextColor,
    ...(pillTextColor ? { ["--pill-text" as string]: pillTextColor } : {}),
  } as React.CSSProperties;

  return (
    <nav className="pill-nav-vertical" aria-label="Primary" style={cssVars}>
      <ul className="pill-list" ref={navRef} role="menubar">
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <li key={item.href} role="none">
              <Link
                role="menuitem"
                href={item.href}
                className={`pill cursor-target${activeIndex === i ? " is-active" : ""}`}
                onMouseEnter={() => handleEnter(i)}
                onMouseLeave={() => handleLeave(i)}
                onClick={onItemClick}
              >
                <span
                  className="hover-circle"
                  aria-hidden="true"
                  ref={(el) => {
                    circleRefs.current[i] = el;
                  }}
                />
                {Icon && (
                  <span className="pill-icon">
                    <Icon className="w-4 h-4" />
                  </span>
                )}
                <span className="label-stack">
                  <span className="pill-label">{item.label}</span>
                  <span className="pill-label-hover" aria-hidden="true">
                    {item.label}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
