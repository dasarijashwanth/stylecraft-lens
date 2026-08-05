import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui";

interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: LucideIcon;
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  // Table-cell / inline contexts (no card chrome, smaller icon, no big padding) —
  // the full variant matches app/(app)/dashboard/projects/page.tsx's reference pattern.
  compact?: boolean;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, compact = false, className }: EmptyStateProps) {
  const ActionIcon = action?.icon;
  const actionButtonClass = "inline-flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow shadow-accent/25";
  const actionContent = action && (
    <>
      {ActionIcon && <ActionIcon className="w-4 h-4" />}
      <span>{action.label}</span>
    </>
  );
  const actionButton = action && (
    action.href ? (
      <Link href={action.href} className={actionButtonClass}>{actionContent}</Link>
    ) : (
      <button type="button" onClick={action.onClick} className={actionButtonClass}>{actionContent}</button>
    )
  );

  if (compact) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-1.5 py-6 text-center", className)}>
        <Icon className="w-5 h-5 text-text-muted opacity-60" />
        <p className="text-xs font-semibold text-text-secondary">{title}</p>
        {description && <p className="text-[11px] text-text-muted max-w-[240px] leading-normal">{description}</p>}
        {actionButton}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-center justify-center p-16 bg-surface-2 border border-border rounded-xl text-center", className)}>
      <div className="p-4 rounded-full bg-surface-3 border border-border-strong text-text-secondary mb-4">
        <Icon className="w-10 h-10 opacity-70 animate-pulse" />
      </div>
      <h2 className="text-base font-bold text-text-primary mb-1">{title}</h2>
      {description && <p className="text-xs text-text-muted max-w-sm mb-6">{description}</p>}
      {actionButton}
    </div>
  );
}
