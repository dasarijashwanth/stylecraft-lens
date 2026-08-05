"use client";

import { create } from "zustand";
import { usePathname } from "next/navigation";
import { resolveRouteBackground, type BackgroundAssetKey } from "@/lib/background-stage-config";

interface BackgroundStageState {
  // Set by a route while it's in a temporary "waiting/generating" state
  // (ProgressPanel, ProjectGenerationProgress) — takes priority over the
  // route's own default asset for as long as that state is active, then
  // clears itself on unmount. Null means "use the route default."
  overrideAsset: BackgroundAssetKey | null;
  setOverride: (asset: BackgroundAssetKey) => void;
  clearOverride: () => void;
}

export const useBackgroundStageStore = create<BackgroundStageState>((set) => ({
  overrideAsset: null,
  setOverride: (asset) => set({ overrideAsset: asset }),
  clearOverride: () => set({ overrideAsset: null }),
}));

// Every existing MagicBentoCard/MagicBentoSection usage calls this to decide
// solid vs. glass rendering. Computed directly from the current route (not
// synchronized state written by BackgroundStage) so there's no one-tick lag
// or flash between a route changing and its cards knowing whether a
// background is behind them — admin routes (excluded from
// resolveRouteBackground) correctly stay solid.
export function useGlassMode(): boolean {
  const pathname = usePathname();
  return resolveRouteBackground(pathname) !== null;
}
