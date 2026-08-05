// Brand-icon-first, Lucide-fallback resolver. Callers pass the specific
// Lucide component they already import (preserves tree-shaking — this file
// deliberately never imports all of lucide-react by name-string lookup) as
// `fallback`; if a real brand SVG has been wired into BRAND_ICONS for this
// `name`, it renders instead. See assets/icons/README.md for how to add one.
//
// Currently BRAND_ICONS is empty — no brand SVGs have been supplied yet, so
// every <Icon> call renders its Lucide fallback. This is intentional
// swap-ready infrastructure, not dead code: adding a real icon later is a
// one-line map entry here, not a call-site change.
import Image, { type StaticImageData } from "next/image";
import type { LucideIcon } from "lucide-react";

const BRAND_ICONS: Record<string, StaticImageData> = {};

export type IconSize = 16 | 20 | 24;

interface IconProps {
  name: string;
  fallback: LucideIcon;
  size?: IconSize;
  className?: string;
}

export function Icon({ name, fallback: Fallback, size = 20, className }: IconProps) {
  const brandIcon = BRAND_ICONS[name];
  if (brandIcon) {
    return <Image src={brandIcon} alt="" width={size} height={size} className={className} />;
  }
  return <Fallback size={size} className={className} />;
}
