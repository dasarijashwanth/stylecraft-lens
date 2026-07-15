import { cn } from "@/lib/ui";

export type BadgeTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "status-active"
  | "status-monitoring"
  | "status-archived";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-surface-3 border border-border text-text-muted",
  accent: "bg-accent-bg border border-accent-border text-accent-text",
  success: "bg-success-bg border border-success/20 text-success",
  warning: "bg-warning-bg border border-warning/20 text-warning",
  danger: "bg-danger-bg border border-danger/20 text-danger",
  "status-active": "bg-status-active/10 border border-status-active/25 text-status-active",
  "status-monitoring": "bg-status-monitoring/10 border border-status-monitoring/25 text-status-monitoring",
  "status-archived": "bg-status-archived/10 border border-status-archived/25 text-status-archived",
};

const DOT_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-text-muted",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  "status-active": "bg-status-active",
  "status-monitoring": "bg-status-monitoring",
  "status-archived": "bg-status-archived",
};

interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  uppercase?: boolean;
  className?: string;
  title?: string;
  children: React.ReactNode;
}

// The single visual source of truth for status/source/tier chips — every
// tone maps only to existing CSS-var-backed tokens (tailwind.config.ts),
// never a raw palette color, so a chip can never silently drift from the
// app's design system the way ad hoc `bg-zinc-800`/`bg-indigo-950` spans did.
export function Badge({ tone = "neutral", dot = false, uppercase = false, className, title, children }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-bold",
        uppercase && "uppercase tracking-wider",
        TONE_CLASSES[tone],
        className
      )}
    >
      {dot && <span className={cn("w-1 h-1 rounded-full shrink-0", DOT_CLASSES[tone])} />}
      {children}
    </span>
  );
}
