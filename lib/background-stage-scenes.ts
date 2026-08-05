"use client";

// The 3D depth rig driving components/scroll/BackgroundStage.tsx — a
// persistent, full-viewport background, NOT scroll-bound content reveals
// (that's lib/scroll-scenes.ts's job). Reuses the same reducedMotion/mobile
// gate convention and gsap.context cleanup idiom as that module, but this is
// bespoke logic: a perspective depth rig (scroll-scrubbed zoom/tilt/pan/
// focus-blur), mouse micro-parallax (the same gsap.quickTo technique as
// app/(auth)/sign-in/page.tsx's useCardTilt), and a route-change crossfade
// (hand-rolled — Next.js 14.2.x has no View Transitions support at all,
// confirmed against the installed version).
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export interface DepthRigContext {
  reducedMotion: boolean;
  mobile: boolean;
}

const MOBILE_BREAKPOINT_PX = 768;

export function getDepthRigContext(): DepthRigContext {
  return {
    reducedMotion: typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    mobile: typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT_PX,
  };
}

export interface DepthRigLayers {
  bgLayer: HTMLElement | null;
  scrimLayer: HTMLElement | null;
}

export interface DepthRigEffectConfig {
  zoomFrom: number;
  zoomTo: number;
  tiltMaxDeg: number;
  panFromPct: number;
  panToPct: number;
  focusBlurPx: number;
  scrimOpacity: number;
}

export const DEFAULT_DEPTH_EFFECT: DepthRigEffectConfig = {
  zoomFrom: 1.35,
  zoomTo: 1.15,
  tiltMaxDeg: 2.5,
  panFromPct: -2,
  panToPct: 2,
  focusBlurPx: 6,
  scrimOpacity: 0.6,
};

// Builds the scroll-scrubbed depth timeline (scale/tilt/pan/focus-blur, one
// combined tween so nothing on `bgLayer` fights itself) plus the scrim's own
// darken-with-depth tween. Returns a cleanup function reverting everything
// GSAP touched — callers run this inside their own gsap.context so
// ScrollTrigger instances are also torn down automatically, but the
// explicit revert here keeps this function usable standalone too.
export function buildDepthRig(
  layers: DepthRigLayers,
  ctx: DepthRigContext,
  effect: Partial<DepthRigEffectConfig> = {}
): () => void {
  const cfg = { ...DEFAULT_DEPTH_EFFECT, ...effect };
  const { bgLayer, scrimLayer } = layers;
  if (!bgLayer) return () => {};

  if (ctx.reducedMotion) {
    // Full-viewport layer stays, fully static — no scroll-linked transform,
    // no tilt, no blur breathing. Reduced motion must never bring back a
    // band, it just means this one layer never moves.
    gsap.set(bgLayer, { scale: cfg.zoomFrom, rotateX: 0, xPercent: 0, filter: "blur(0px)" });
    if (scrimLayer) gsap.set(scrimLayer, { opacity: cfg.scrimOpacity });
    return () => {
      gsap.set(bgLayer, { clearProps: "all" });
      if (scrimLayer) gsap.set(scrimLayer, { clearProps: "all" });
    };
  }

  gsap.set(bgLayer, {
    scale: cfg.zoomFrom,
    rotateX: 0,
    xPercent: cfg.panFromPct,
    transformPerspective: 1200,
    filter: "blur(0px)",
  });
  if (scrimLayer) gsap.set(scrimLayer, { opacity: cfg.scrimOpacity * 0.6 });

  const tl = gsap.timeline({
    scrollTrigger: { start: "top top", end: "max", scrub: 0.8 },
  });

  tl.to(
    bgLayer,
    {
      scale: cfg.zoomTo,
      // Mobile: keep the depth zoom, drop tilt/pan per spec.
      rotateX: ctx.mobile ? 0 : cfg.tiltMaxDeg,
      xPercent: ctx.mobile ? cfg.panFromPct : cfg.panToPct,
      filter: `blur(${cfg.focusBlurPx}px)`,
      ease: "none",
    },
    0
  );
  if (scrimLayer) {
    tl.to(scrimLayer, { opacity: cfg.scrimOpacity, ease: "none" }, 0);
  }

  return () => {
    tl.scrollTrigger?.kill();
    tl.kill();
    gsap.set(bgLayer, { clearProps: "all" });
    if (scrimLayer) gsap.set(scrimLayer, { clearProps: "all" });
  };
}

const MOUSE_PARALLAX_MAX_PX = 12;

// Background counter-moves against cursor position, layered on top of the
// scroll timeline above (both animate transform properties GSAP composites
// independently — translate here, scale/rotateX/xPercent there — so they
// don't fight). Desktop only; skipped under reduced motion or mobile,
// matching the spec's own gating rules. Same quickTo pattern as the sign-in
// card tilt: persistent tweens reused across pointermove events rather than
// creating a new tween per event.
export function attachMouseParallax(bgLayer: HTMLElement | null, ctx: DepthRigContext): () => void {
  if (!bgLayer || ctx.reducedMotion || ctx.mobile) return () => {};

  const quickX = gsap.quickTo(bgLayer, "x", { duration: 0.6, ease: "power3.out" });
  const quickY = gsap.quickTo(bgLayer, "y", { duration: 0.6, ease: "power3.out" });

  function onPointerMove(e: PointerEvent) {
    const px = e.clientX / window.innerWidth - 0.5;
    const py = e.clientY / window.innerHeight - 0.5;
    // Counter-move: background drifts opposite the cursor, the classic
    // parallax-toward-viewer illusion.
    quickX(-px * MOUSE_PARALLAX_MAX_PX * 2);
    quickY(-py * MOUSE_PARALLAX_MAX_PX * 2);
  }
  function onPointerLeave() {
    quickX(0);
    quickY(0);
  }

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerleave", onPointerLeave);
  return () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerleave", onPointerLeave);
  };
}

// Route-change crossfade — implemented directly in BackgroundStage.tsx as
// two effects (fade-out-then-swap-state, then fade-in-then-attach-rig)
// rather than as a standalone function here: React's effect model already
// needs a "just attach the rig" path for the initial mount (no transition
// to animate), and reusing that same path for both mount and post-crossfade
// turned out simpler than threading a separate crossfade helper's onComplete
// through it. Hand-rolled at all because Next 14.2.x has no View Transitions
// support whatsoever (confirmed: not even the experimental flag exists
// pre-Next-15).
