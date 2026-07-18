import type { HTMLAttributes, ReactNode } from "react";
import { cn, type InterfaceTone } from "@/lib/ui";

export function StatusBadge({
  tone = "neutral",
  dot = true,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: InterfaceTone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={cn("gc-badge", `gc-badge--${tone}`, className)} {...props}>
      {dot && <span className="gc-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

