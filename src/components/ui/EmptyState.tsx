import type { ReactNode } from "react";
import { cn } from "@/lib/ui";

export function EmptyState({
  title,
  description,
  icon,
  action,
  compact = false,
  className,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("gc-empty", compact && "gc-empty--compact", className)}>
      {icon && <div className="gc-empty__icon">{icon}</div>}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

