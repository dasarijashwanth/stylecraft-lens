"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

const SEGMENT_LABELS: Record<string, string> = {
  dashboard:   "Dashboard",
  competitors: "Competitors",
  projects:    "Projects",
  analyze:     "Analyze",
  reports:     "Reports",
  settings:    "Settings",
  new:         "New",
  help:        "Help",
};

export function Breadcrumb() {
  const pathname = usePathname();

  const segments = pathname.split("/").filter(Boolean);

  const crumbs = segments.map((seg, i) => {
    const href  = "/" + segments.slice(0, i + 1).join("/");
    
    // Check if segment is a dynamic database ID
    let label = SEGMENT_LABELS[seg];
    if (!label) {
      if (
        seg.startsWith("comp_") || 
        seg.startsWith("an_") || 
        seg.startsWith("proj_") || 
        seg.startsWith("rep_") || 
        seg.startsWith("c_") || 
        seg.length > 15
      ) {
        label = "Detail";
      } else {
        label = seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " ");
      }
    }
    
    const isLast = i === segments.length - 1;
    return { href, label, isLast };
  });

  // Remove duplicate consecutive "Dashboard" segments if any
  const deduped = crumbs.filter((c, i) =>
    i === 0 || c.label !== crumbs[i - 1].label
  );

  if (deduped.length === 0) {
    return (
      <span className="text-text-muted hover:text-text-secondary cursor-pointer transition-colors">
        Dashboard
      </span>
    );
  }

  return (
    <nav className="flex items-center gap-1.5 text-xs text-text-muted font-medium" aria-label="Breadcrumb">
      <Link href="/dashboard" className="hover:text-text-secondary cursor-pointer transition-colors">
        Dashboard
      </Link>
      {deduped.map((c) => {
        // If the first segment is "Dashboard", we don't need to print it again since we printed it manually above
        if (c.label === "Dashboard") return null;

        return (
          <span key={c.href} className="flex items-center gap-1.5 font-sans">
            <ChevronRight className="w-3.5 h-3.5 text-text-muted/60" />
            {c.isLast ? (
              <span className="text-accent-text font-bold">{c.label}</span>
            ) : (
              <Link href={c.href} className="hover:text-text-secondary cursor-pointer transition-colors">
                {c.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
