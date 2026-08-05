"use client";

// Scroll-driven cinematic redesign — the ONE central module every new scroll
// scene (Login hero, Dashboard hero band, Projects collapsing header,
// Analysis pinned intro, Help hero, loading-screen backdrops) is built from.
// No component should register its own scattered ScrollTrigger/scroll
// listener — always go through useScrollScene + these primitives, so
// reduced-motion/mobile handling and cleanup-on-unmount are correct
// everywhere for free.
//
// Pairs with app/globals.css's existing motion-token system (--ease-out,
// --dur-*) the same way lib/motion.ts's usePrefersReducedMotion/useCountUp
// already do for the realtime (non-scroll) side of that system — this file
// is the scroll-linked half.
import { useEffect, useRef, type DependencyList, type RefObject } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export interface SceneContext {
  reducedMotion: boolean;
  mobile: boolean;
}

// Matches this codebase's own mobile breakpoint precedent
// (components/ui/MagicBento.tsx's useMobileDetection, ≤768px).
const MOBILE_BREAKPOINT_PX = 768;

// The one hook every scene component calls. Wraps GSAP's own official
// React-integration pattern (gsap.context(fn, scope) -> ctx.revert() on
// cleanup) so every tween/ScrollTrigger created inside `setup` is torn down
// automatically on unmount or route change — required in the App Router,
// where these client components mount/unmount on navigation and a leaked
// ScrollTrigger would keep firing against a detached DOM node.
export function useScrollScene<T extends HTMLElement = HTMLDivElement>(
  setup: (ctx: SceneContext) => void,
  deps: DependencyList = []
): RefObject<T> {
  const scopeRef = useRef<T>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile = window.innerWidth < MOBILE_BREAKPOINT_PX;

    const ctx = gsap.context(() => {
      setup({ reducedMotion, mobile });
    }, scopeRef as any);

    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return scopeRef;
}

// ---- Primitives — all pure, all reduced-motion/mobile-aware, all called
// from inside a useScrollScene `setup` callback ----

// Background layer drifts at `speed` (0.3-0.5 per spec) relative to
// midground (0.8x)/foreground (1x) content — depth without dizziness.
// Transform-only (yPercent), never background-attachment:fixed (banned per
// spec — janky on mobile). Dampened to speed*0.7 on mobile; skipped
// entirely (static) under reduced motion.
export function parallaxLayer(
  el: Element | null,
  ctx: SceneContext,
  opts: { speed: number } = { speed: 0.4 }
): void {
  if (!el || ctx.reducedMotion) return;
  const speed = ctx.mobile ? opts.speed * 0.7 : opts.speed;
  gsap.to(el, {
    yPercent: 20 * speed,
    ease: "none",
    scrollTrigger: {
      trigger: el.parentElement || el,
      start: "top bottom",
      end: "bottom top",
      scrub: true,
    },
  });
}

// A section pins while scroll progress drives a timeline the caller
// populates (image scale, gradient shift, word-by-word reveal), then
// releases. Never pins on mobile or under reduced motion — instead builds
// the same timeline and jumps straight to its end state, so the "reveal"
// content is still fully visible, just not scroll-scrubbed.
export function pinnedScrubScene(
  trigger: Element | null,
  buildTimeline: (tl: gsap.core.Timeline) => void,
  ctx: SceneContext,
  opts: { end?: string } = {}
): void {
  if (!trigger) return;
  if (ctx.reducedMotion || ctx.mobile) {
    const tl = gsap.timeline({ paused: true });
    buildTimeline(tl);
    tl.progress(1);
    return;
  }
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger,
      start: "top top",
      end: opts.end || "+=100%",
      pin: true,
      scrub: true,
    },
  });
  buildTimeline(tl);
}

// Scroll-scrubbed opacity/scale crossfade between two consecutive
// background assets (Dashboard hero -> content, Projects header -> list).
export function crossfade(
  elA: Element | null,
  elB: Element | null,
  trigger: Element | null,
  ctx: SceneContext
): void {
  if (!elA || !elB || !trigger) return;
  if (ctx.reducedMotion) {
    gsap.set(elA, { opacity: 0 });
    gsap.set(elB, { opacity: 1 });
    return;
  }
  gsap
    .timeline({ scrollTrigger: { trigger, start: "top center", end: "bottom center", scrub: true } })
    .to(elA, { opacity: 0, scale: 1.05, ease: "none" }, 0)
    .fromTo(elB, { opacity: 0, scale: 0.98 }, { opacity: 1, scale: 1, ease: "none" }, 0);
}

// Content blocks rise 24px + fade over 500ms with a 60ms stagger, once,
// when scrolled into view. Under reduced motion: final state instantly,
// no transform/opacity animation at all.
export function revealOnEnter(
  els: Element[] | NodeListOf<Element>,
  ctx: SceneContext,
  opts: { stagger?: number } = {}
): void {
  const list = Array.from(els);
  if (list.length === 0) return;
  if (ctx.reducedMotion) {
    gsap.set(list, { opacity: 1, y: 0 });
    return;
  }
  gsap.fromTo(
    list,
    { opacity: 0, y: 24 },
    {
      opacity: 1,
      y: 0,
      duration: 0.5,
      ease: "power2.out",
      stagger: opts.stagger ?? 0.06,
      scrollTrigger: { trigger: list[0], start: "top 85%", once: true },
    }
  );
}

// A thin progress bar (the gold accent, per the cinematic-surfaces-only
// palette decision) that fills as the WHOLE page scrolls, plus optional
// section markers that fill as their scene passes. Under reduced motion,
// left un-animated entirely (the bar element itself can still render
// statically via CSS if a caller wants a fixed indicator).
export function scrollProgressBar(el: Element | null, ctx: SceneContext): void {
  if (!el || ctx.reducedMotion) return;
  gsap.set(el, { scaleX: 0, transformOrigin: "left center" });
  gsap.to(el, {
    scaleX: 1,
    ease: "none",
    scrollTrigger: { start: "top top", end: "max", scrub: true },
  });
}
