"use client";

// The persistent, full-viewport cinematic background. Mounted ONCE inside
// Shell.tsx (components/layout/Shell.tsx is instantiated exactly once by
// app/(app)/layout.tsx and does not remount across (app) navigations — this
// is what lets a route change crossfade rather than hard-cut) and once
// more, independently, on the standalone Login page (which has no shared
// layout with the rest of the app).
//
// Renders nothing at all on routes resolveRouteBackground() excludes
// (admin/internal tooling) — those stay on the plain solid surface
// background. Every other route gets this fixed layer behind all content;
// see lib/background-stage-config.ts for the route->asset/scrim mapping and
// lib/background-stage-scenes.ts for the 3D depth rig itself.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { gsap } from "gsap";
import {
  BACKGROUND_ASSETS,
  resolveRouteBackground,
  scrimOpacityFor,
  type RouteBackgroundConfig,
} from "@/lib/background-stage-config";
import {
  buildDepthRig,
  attachMouseParallax,
  getDepthRigContext,
  DEFAULT_DEPTH_EFFECT,
} from "@/lib/background-stage-scenes";
import { useBackgroundStageStore } from "@/stores/backgroundStageStore";
import HeroVideo from "./HeroVideo";

const CROSSFADE_OUT_S = 0.25;
const CROSSFADE_IN_S = 0.25;

export default function BackgroundStage() {
  const pathname = usePathname();
  const overrideAsset = useBackgroundStageStore((s) => s.overrideAsset);

  const routeConfig = resolveRouteBackground(pathname);
  const targetConfig: RouteBackgroundConfig | null = !routeConfig
    ? null
    : overrideAsset
    ? { asset: overrideAsset, scrimIntensity: routeConfig.scrimIntensity }
    : routeConfig;

  const [activeConfig, setActiveConfig] = useState<RouteBackgroundConfig | null>(targetConfig);
  const bgLayerRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const cleanupRigRef = useRef<() => void>(() => {});
  const cleanupParallaxRef = useRef<() => void>(() => {});

  // Detects a target change (route nav or override set/cleared) and either
  // (a) just retunes the scrim if only its intensity changed (e.g.
  // Help->Settings, same "img-4" asset), or (b) runs the full crossfade —
  // kills the current depth rig/parallax, fades the current layer out, and
  // hands off to the fade-in effect below once React has re-rendered with
  // the new asset.
  useEffect(() => {
    const assetChanged = targetConfig?.asset !== activeConfig?.asset;
    const scrimChanged = targetConfig?.scrimIntensity !== activeConfig?.scrimIntensity;
    if (!assetChanged && !scrimChanged) return;

    const ctx = getDepthRigContext();

    if (!assetChanged) {
      if (scrimRef.current && targetConfig) {
        gsap.to(scrimRef.current, {
          opacity: scrimOpacityFor(targetConfig.scrimIntensity),
          duration: ctx.reducedMotion ? 0 : 0.4,
          ease: "power2.out",
        });
      }
      setActiveConfig(targetConfig);
      return;
    }

    const el = bgLayerRef.current;
    if (!el || ctx.reducedMotion) {
      cleanupRigRef.current();
      cleanupParallaxRef.current();
      setActiveConfig(targetConfig);
      return;
    }

    cleanupRigRef.current();
    cleanupParallaxRef.current();
    gsap.to(el, {
      opacity: 0,
      scale: DEFAULT_DEPTH_EFFECT.zoomFrom * 1.05,
      duration: CROSSFADE_OUT_S,
      ease: "power2.in",
      onComplete: () => setActiveConfig(targetConfig),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetConfig?.asset, targetConfig?.scrimIntensity]);

  // Runs whenever the RENDERED asset changes: fades the freshly-mounted
  // layer in, then attaches the depth rig + mouse parallax. Never overlaps
  // with the fade-out above — that one always finishes (and unmounts
  // nothing, just hides) before setActiveConfig causes this effect to fire.
  useEffect(() => {
    const el = bgLayerRef.current;
    if (!el || !activeConfig) return;
    const ctx = getDepthRigContext();
    const scrimOpacity = scrimOpacityFor(activeConfig.scrimIntensity);

    if (ctx.reducedMotion) {
      gsap.set(el, { opacity: 1, scale: DEFAULT_DEPTH_EFFECT.zoomFrom });
      cleanupRigRef.current = buildDepthRig(
        { bgLayer: el, scrimLayer: scrimRef.current },
        ctx,
        { scrimOpacity }
      );
      return () => cleanupRigRef.current();
    }

    gsap.set(el, { opacity: 0, scale: DEFAULT_DEPTH_EFFECT.zoomFrom * 1.1 });
    gsap.to(el, {
      opacity: 1,
      scale: DEFAULT_DEPTH_EFFECT.zoomFrom,
      duration: CROSSFADE_IN_S,
      ease: "power2.out",
      onComplete: () => {
        cleanupRigRef.current = buildDepthRig(
          { bgLayer: el, scrimLayer: scrimRef.current },
          ctx,
          { scrimOpacity }
        );
        cleanupParallaxRef.current = attachMouseParallax(el, ctx);
      },
    });

    return () => {
      cleanupRigRef.current();
      cleanupParallaxRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConfig?.asset]);

  if (!activeConfig) return null;

  const asset = BACKGROUND_ASSETS[activeConfig.asset];

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 0, perspective: 1200, overflow: "hidden" }}
      aria-hidden="true"
    >
      <div ref={bgLayerRef} style={{ position: "absolute", inset: 0 }}>
        {asset.kind === "video" ? (
          <HeroVideo
            key={activeConfig.asset}
            srcMp4={asset.mp4}
            srcWebm={asset.webm}
            poster={asset.poster}
            className="absolute inset-0"
            mediaClassName="w-full h-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={activeConfig.asset} src={asset.src} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}
      </div>
      <div ref={scrimRef} className="cinema-scrim" />
    </div>
  );
}
