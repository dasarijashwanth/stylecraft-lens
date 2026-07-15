import { cn } from "@/lib/ui";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn("bg-surface-3 rounded animate-pulse", className)} />;
}

// Two-line placeholder rows — a headline bar over a shorter detail bar,
// repeated `count` times. Matches the shape of a resolved feature/review/
// news entry so the loading state doesn't jump in size once data arrives.
export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-1">
          <div className="h-3 bg-surface-3 rounded w-1/3" />
          <div className="h-2.5 bg-surface-3/60 rounded w-full" />
        </div>
      ))}
    </div>
  );
}
